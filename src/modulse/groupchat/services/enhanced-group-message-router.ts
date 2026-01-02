// src/e2ee/services/group-message-router.ts

import { groupE2eeService } from './group-e2ee-service';
import { groupManagementService, type IMessageSender } from './group-management-service';
import { GroupMessagePersistenceService } from './group-message-persistence.service';
import { getWebSocketManager, WebSocketManager } from '../../signal/services/websocket-manager';
import { getEnhancedP2PRouter } from '../../signal/services/p2p-message-router.enhanced';
import { fileEncryptionService, type EncryptedFilePackage } from '../../utils/file-encryption.service';
import { groupApiService } from './group-api.service';

import type { GroupMessage } from '../types/group-message.types';
import type { ISenderKeyMessage } from '../protocol/types';

export class GroupMessageRouter {
    private wsManager: WebSocketManager;
    private persistence: GroupMessagePersistenceService;
    private messageHandlers: Array<(msg: GroupMessage) => void> = [];
    private myUserId: string;
    private isInitialized = false;

    constructor(userId: string) {
        this.myUserId = userId;
        this.wsManager = getWebSocketManager(userId);
        this.persistence = new GroupMessagePersistenceService(userId);
    }

    /**
     * ✅ 初始化路由（用户登录后调用）
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log('[GroupRouter] Already initialized');
            return;
        }

        await this.persistence.init();
        //this.setupWebSocketListeners();
        this.injectMessageSender();
        this.setupReconnectionHandler();
        this.setupP2PKeyDistribution(); // ✅ 新增：设置 P2P 密钥分发监听

        // ✅ 上线时同步所有群组
        await groupManagementService.syncAllGroupsOnLogin(this.myUserId);

        this.isInitialized = true;
        console.log(`[GroupRouter] Initialized for user ${this.myUserId}`);
    }

    /**
     * ✅ 注入消息发送器（使用 P2P Router 的密钥分发方法）
     */
    private injectMessageSender() {
        const p2pRouter = getEnhancedP2PRouter(this.myUserId);

        const senderImplementation: IMessageSender = {
            // ✅ P2P 密钥分发：走 P2P Router 的专用方法
            sendKeyToUser: async (targetUserId: string, orderId: string, distMsg: any) => {
                try {
                    const result = await p2pRouter.sendKeyDistribution(
                        targetUserId,
                        distMsg,
                        orderId
                    );

                    if (!result.success) {
                        throw new Error(result.error || '密钥分发失败');
                    }

                    console.log(`[GroupRouter] Key sent to ${targetUserId} for order ${orderId}`);
                } catch (error) {
                    console.error(`[GroupRouter] Failed to send key to ${targetUserId}:`, error);
                    throw error;
                }
            },

            // 群广播（系统信令，不加密，预留的）
            sendToGroup: async (orderId: string, message: any) => {
                await this.wsManager.send({
                    id: this._generateMessageId(),
                    messageType: 'system',
                    orderId: orderId,
                    content: JSON.stringify(message),
                    timestamp: Date.now()
                });
            }
        };

        groupManagementService.setMessageSender(senderImplementation);
    }

    /**
     * ✅ 设置 P2P 密钥分发监听
     */
    private setupP2PKeyDistribution() {
        const p2pRouter = getEnhancedP2PRouter(this.myUserId);

        // ✅ 监听来自 P2P Router 的密钥分发消息
        p2pRouter.onKeyDistribution(async ({ orderId, senderId, keyDistributionMessage }) => {
            console.log(
                `[GroupRouter] Received key distribution from ${senderId} for order ${orderId}`
            );

            try {
                await groupManagementService.handleKeyDistributionSignal(
                    this.myUserId,
                    keyDistributionMessage
                );
            } catch (error) {
                console.error('[GroupRouter] Failed to process key distribution:', error);
            }
        });
    }

    /**
     * ✅ 监听重连事件
     */
    private setupReconnectionHandler() {
        this.wsManager.onStatusChange(async (status) => {
            if (status === 'connected') {
                console.log('[GroupRouter] WebSocket reconnected');
                await groupManagementService.onReconnected(this.myUserId);
            }
        });
    }

    /**
     * 发送群组文本消息
     */
    public async sendGroupTextMessage(orderId: string, text: string): Promise<GroupMessage> {
        return this._sendGenericMessage(orderId, 'text', text);
    }

    /**
     * 发送群组文件消息
     */
    public async sendGroupFileMessage(orderId: string, file: File): Promise<GroupMessage> {
        const messageId = this._generateMessageId();
        const timestamp = Date.now();

        try {
            // 1. 加密文件
            const encryptedPackage = await fileEncryptionService.encryptFileForGroup(
                file,
                this.myUserId,
                orderId
            );

            // 2. 上传
            const blob = new Blob([encryptedPackage.encryptedContent]);
            const serverFileId = await groupApiService.uploadFile(blob, orderId);

            // 3. 构建元数据
            const fileMessageContent = JSON.stringify({
                fileId: serverFileId,
                localFileId: encryptedPackage.fileId,
                metadata: encryptedPackage.metadata,
                signature: encryptedPackage.signature
            });

            // 4. 发送
            const sentMessage = await this._sendGenericMessage(orderId, 'file', fileMessageContent, {
                fileName: file.name,
                fileSize: file.size,
                fileId: serverFileId
            });

            return sentMessage;

        } catch (error) {
            console.error('[GroupRouter] Send file failed:', error);
            throw error;
        }
    }

    /**
     * 下载并解密群组文件
     */
    public async downloadGroupFile(message: GroupMessage): Promise<string> {
        try {
            if (message.type !== 'file') throw new Error('Not a file message');

            const fileInfo = JSON.parse(message.content);
            const { fileId, metadata, signature } = fileInfo;

            const encryptedBuffer = await groupApiService.downloadFile(fileId);

            const packageToDecrypt: EncryptedFilePackage = {
                fileId: fileInfo.localFileId,
                metadata: metadata,
                encryptedContent: encryptedBuffer,
                signature: signature
            };

            const result = await fileEncryptionService.decryptGroupFile(
                packageToDecrypt,
                this.myUserId,
                message.orderId,
                message.senderId
            );

            return fileEncryptionService.createDownloadUrl(
                result.content,
                result.originalName,
                result.mimeType
            );

        } catch (error) {
            console.error('[GroupRouter] Download file failed:', error);
            throw error;
        }
    }

    /**
     * 通用发送逻辑
     */
    private async _sendGenericMessage(
        orderId: string,
        type: 'text' | 'file',
        contentString: string,
        extraMetadata: any = {}
    ): Promise<GroupMessage> {
        const messageId = this._generateMessageId();
        const timestamp = Date.now();

        const localMessage: GroupMessage = {
            id: messageId,
            type: type,
            orderId: orderId,
            senderId: this.myUserId,
            content: contentString,
            timestamp: timestamp,
            status: 'pending',
            metadata: extraMetadata
        };
        await this.persistence.saveMessage(localMessage);
        this.notifyUI(localMessage);

        try {
            // SenderKey 加密
            const encoder = new TextEncoder();
            const encryptedPackage = await groupE2eeService.encryptGroupMessage(
                this.myUserId,
                orderId,
                encoder.encode(contentString)
            );

            // 发送
            await this.wsManager.send({
                id: messageId,
                messageType: type,
                orderId: orderId,
                content: JSON.stringify(encryptedPackage),
                timestamp: timestamp
            }, { requireAck: true });

            // 更新状态
            await this.persistence.updateMessageStatus(messageId, 'sent');
            localMessage.status = 'sent';
            this.notifyUI(localMessage);

            return localMessage;
        } catch (error) {
            console.error(`[GroupRouter] Send ${type} failed:`, error);
            await this.persistence.updateMessageStatus(messageId, 'failed');
            throw error;
        }
    }

    /**
     * ✅ 设置 WebSocket 监听
     */
    // private setupWebSocketListeners() {
    //     // 1. 监听业务消息 (text/file)
    //     ['text', 'file'].forEach(type => {
    //         this.wsManager.on(type, async (data: any) => {
    //             if (data.orderId && !data.recipientId && data.content) {
    //                 await this.handleIncomingBusinessMessage(data);
    //             }
    //         });
    //     });
    //
    //     // 2. ✅ 监听服务器广播：成员加入 (userIn)
    //     this.wsManager.on('userIn', async (data: any) => {
    //         if (data.orderId && data.encryptedContent) {
    //             await this.handleUserInMessage(data);
    //         }
    //     });
    //
    //     // 3. ✅ 监听服务器广播：成员退出 (userOut)
    //     this.wsManager.on('userOut', async (data: any) => {
    //         if (data.orderId && data.encryptedContent) {
    //             await this.handleUserOutMessage(data);
    //         }
    //     });
    //
    //     // 4. 监听系统消息（预留）
    //     this.wsManager.on('system', async (data: any) => {
    //         if (data.orderId && data.content) {
    //             await this.handleSystemMessage(data);
    //         }
    //     });
    // }

    /**
     * 处理业务消息
     */
    public async handleIncomingBusinessMessage(data: any) {
        try {
            const { orderId, senderId, content, id, timestamp, messageType } = data;

            const encryptedPackage: ISenderKeyMessage = JSON.parse(content);
            const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                this.myUserId,
                encryptedPackage
            );
            const decryptedContent = new TextDecoder().decode(plaintextBytes);

            const message: GroupMessage = {
                id: id || `recv_${Date.now()}`,
                type: messageType,
                orderId: orderId,
                senderId: senderId,
                content: decryptedContent,
                timestamp: timestamp || Date.now(),
                status: 'delivered'
            };

            await this.persistence.saveMessage(message);
            this.notifyUI(message);

        } catch (error) {
            console.error('[GroupRouter] Decrypt business message failed:', error);
        }
    }

    /**
     * ✅ 处理 userIn 广播
     */
    public async handleUserInMessage(data: any) {
        try {
            const { orderId, encryptedContent } = data;
            const payload = JSON.parse(encryptedContent);

            console.log(`[GroupRouter] Received userIn for order ${orderId}:`, payload);

            await groupManagementService.handleUserInSignal(this.myUserId, payload);

        } catch (error) {
            console.error('[GroupRouter] Failed to handle userIn:', error);
        }
    }

    /**
     * ✅ 处理 userOut 广播
     */
    public async handleUserOutMessage(data: any) {
        try {
            const { orderId, encryptedContent } = data;
            const payload = JSON.parse(encryptedContent);

            console.log(`[GroupRouter] Received userOut for order ${orderId}:`, payload);

            await groupManagementService.handleUserOutSignal(this.myUserId, payload);

        } catch (error) {
            console.error('[GroupRouter] Failed to handle userOut:', error);
        }
    }

    /**
     * 处理系统消息（预留）
     */
    public async handleSystemMessage(data: any) {
        try {
            const { content } = data;
            const signal = JSON.parse(content);

            // 预留给未来的系统消息
            console.debug('[GroupRouter] System message:', signal);
        } catch (e) {
            console.debug('[GroupRouter] Not a system signal:', e);
        }
    }

    // ========== 公共方法 ==========

    public onMessage(handler: (msg: GroupMessage) => void) {
        this.messageHandlers.push(handler);
    }

    public async getHistory(orderId: string, limit?: number) {
        return this.persistence.getGroupMessages(orderId, limit);
    }

    // ========== 辅助方法 ==========

    private _generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    private notifyUI(msg: GroupMessage) {
        this.messageHandlers.forEach(h => h(msg));
    }
}

// 工厂函数
const routerInstances = new Map<string, GroupMessageRouter>();

export function getGroupMessageRouter(userId: string): GroupMessageRouter {
    if (!routerInstances.has(userId)) {
        routerInstances.set(userId, new GroupMessageRouter(userId));
    }
    return routerInstances.get(userId)!;
}