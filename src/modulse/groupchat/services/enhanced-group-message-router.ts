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
        // this.setupWebSocketListeners(); // ✅ 启用监听 (由 Dispatcher 统一接管)
        this.injectMessageSender();
        this.setupReconnectionHandler();
        this.setupP2PKeyDistribution(); // ✅ 新增：设置 P2P 密钥分发监听

        // ✅ 上线时同步所有群组 - 移至 syncGroups() 中手动调用，确保 WS 已连接
        // await groupManagementService.syncAllGroupsOnLogin(this.myUserId);

        this.isInitialized = true;
        console.log(`[GroupRouter] Initialized for user ${this.myUserId}`);
    }

    /**
     * ✅ 手动同步群组信息 (需在 WebSocket 连接后调用)
     */
    async syncGroups(): Promise<void> {
        if (!this.isInitialized) {
            console.warn('[GroupRouter] Cannot sync groups: not initialized');
            return;
        }
        await groupManagementService.syncAllGroupsOnLogin(this.myUserId);
    }

    /**
     * 等待 WebSocket 连接就绪
     */
    /**
     * 等待 WebSocket 连接就绪
     */
    private async waitForConnection(timeoutMs: number = 5000): Promise<boolean> {
        if (this.wsManager.isConnected()) return true;

        // 如果处于断开状态，主动发起连接
        if (this.wsManager.getStatus() === 'disconnected' || this.wsManager.getStatus() === 'error') {
            console.warn('[GroupRouter] WebSocket is disconnected, attempting to reconnect...');
            this.wsManager.connect();
        }

        return new Promise<boolean>((resolve) => {
            let timeoutId: number;
            let resolved = false;

            const checkConnection = (status: string) => {
                if (resolved) return;

                if (status === 'connected') {
                    console.log('[GroupRouter] WebSocket connected successfully during wait');
                    clearTimeout(timeoutId);
                    resolved = true;
                    resolve(true);
                }
            };

            // 注册临时的状态监听
            // 注意: 目前 WebSocketManager 没有提供 removeListener，这会造成轻微的监听器泄露
            // 但考虑到 waitForConnection 不会频繁调用 (仅在断线重连时)，暂时可以接受
            this.wsManager.onStatusChange(checkConnection);

            timeoutId = window.setTimeout(() => {
                if (resolved) return;
                resolved = true;
                console.warn(`[GroupRouter] Connection wait timed out after ${timeoutMs}ms. Current status: ${this.wsManager.getStatus()}`);
                resolve(false);
            }, timeoutMs);
        });
    }

    /**
     * ✅ 注入消息发送器（使用 P2P Router 的密钥分发方法）
     */
    private injectMessageSender() {
        const p2pRouter = getEnhancedP2PRouter(this.myUserId);

        const senderImplementation: IMessageSender = {
            // ✅ P2P 密钥请求
            sendKeyRequest: async (targetUserId: string, orderId: string) => {
                try {
                    await p2pRouter.sendKeyRequest(targetUserId, orderId);
                    console.log(`[GroupRouter] Key request sent to ${targetUserId} for order ${orderId}`);
                } catch (error) {
                    console.error(`[GroupRouter] Failed to send key request to ${targetUserId}:`, error);
                }
            },

            // ✅ P2P 密钥分发：走 P2P Router 的专用方法
            sendKeyToUser: async (targetUserId: string, distMsg: any, orderId: string) => {
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

        // ✅ Register for key updates to retry decryption
        groupManagementService.onKeyUpdated((orderId) => {
            console.log(`[GroupRouter] Key updated for ${orderId}, retrying pending decryption...`);
            this.retryPendingDecryption(orderId);
        });
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

                // ✅ Retry decrypting pending messages
                await this.retryPendingDecryption(orderId);
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

            // ✅ 尝试连接但不阻塞（如果未连接，将在后台重连，消息保持 pending 状态）
            if (!this.wsManager.isConnected()) {
                console.log('[GroupRouter] WebSocket not connected, triggering reconnect...');
                this.wsManager.connect();
                // 不抛出错误，继续尝试发送（wsManager内有缓冲或将在重连后处理）
                // 或者在这里决定是否直接返回 pending 消息

                // 为了避免 UI 报错，这里我们等待一小会儿，如果连不上就让它 pending
                try {
                    await this.waitForConnection(2000);
                } catch (e) {
                    console.warn('[GroupRouter] Wait connection timeout, message will remain pending');
                }
            }

            // 发送
            await this.wsManager.send({
                id: messageId,
                messageType: type,
                orderId: orderId,
                encryptedContent: JSON.stringify(encryptedPackage), // ✅ 改为 encryptedContent
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
     * 处理业务消息
     */
    public async handleIncomingBusinessMessage(data: any) {
        try {
            const { orderId, senderId, encryptedContent, id, timestamp, messageType } = data;

            let encryptedPackage: ISenderKeyMessage;
            if (typeof encryptedContent === 'string') {
                encryptedPackage = JSON.parse(encryptedContent);
            } else {
                encryptedPackage = encryptedContent;
            }

            // ✅ 修复：将 JSON 反序列化后的 Object 转换为 Uint8Array
            // WebSocket 接收到的二进制数据往往会被转换为 {0: 1, 1: 2...} 格式的对象
            if (encryptedPackage.ciphertext && !(encryptedPackage.ciphertext instanceof Uint8Array)) {
                // 处理可能为 Array 或 Object 的情况
                const values = Object.values(encryptedPackage.ciphertext);
                encryptedPackage.ciphertext = new Uint8Array(values as number[]);
            }
            if (encryptedPackage.signature && !(encryptedPackage.signature instanceof Uint8Array)) {
                const values = Object.values(encryptedPackage.signature);
                encryptedPackage.signature = new Uint8Array(values as number[]);
            }

            const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                this.myUserId,
                encryptedPackage
            );
            const decryptedContent = new TextDecoder().decode(plaintextBytes);

            const message: GroupMessage = {
                id: id || `recv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

            // ✅ Save as failed message for later retry
            try {
                const { orderId, senderId, id, timestamp, messageType, encryptedContent } = data;

                // Ensure we have the package structure to save
                let encryptedPackage: ISenderKeyMessage = typeof encryptedContent === 'string'
                    ? JSON.parse(encryptedContent)
                    : encryptedContent;

                const failedMessage: GroupMessage = {
                    id: id || `recv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: messageType,
                    orderId: orderId,
                    senderId: senderId,
                    content: '[Message pending decryption]',
                    encryptedContent: encryptedPackage,
                    timestamp: timestamp || Date.now(),
                    status: 'failed'
                };

                await this.persistence.saveMessage(failedMessage);
                this.notifyUI(failedMessage); // Optional: show placeholder in UI

                // ✅ Auto-request key from sender
                console.log(`[GroupRouter] Decryption failed. Asking sender ${senderId} for key...`);
                // 防止无限循环：最好加个简单的检查，或者就在这里发，P2P层通常能处理
                groupManagementService.askForKey(this.myUserId, orderId, senderId);

            } catch (saveError) {
                console.error('[GroupRouter] Failed to save failed message:', saveError);
            }
        }
    }

    /**
     * 重试解密待处理消息
     */
    public async retryPendingDecryption(orderId: string): Promise<number> {
        // ✅ Add delay to allow failed messages to be persisted
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`[GroupRouter] Retrying decryption for order ${orderId}...`);
        try {
            const messages = await this.persistence.getGroupMessages(orderId, 50);
            const failedMessages = messages.filter(m => m.status === 'failed');

            if (failedMessages.length === 0) return 0;

            console.log(`[GroupRouter] Found ${failedMessages.length} failed messages to retry`);
            let recoveredCount = 0;

            for (const msg of failedMessages) {
                if (!msg.encryptedContent) continue;

                try {
                    const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                        this.myUserId,
                        msg.encryptedContent
                    );

                    const plaintext = new TextDecoder().decode(plaintextBytes);

                    msg.content = plaintext;
                    msg.status = 'delivered';

                    await this.persistence.saveMessage(msg);
                    this.notifyUI(msg);
                    recoveredCount++;
                } catch (e) {
                    // Still failing
                }
            }

            if (recoveredCount > 0) {
                console.log(`[GroupRouter] Successfully recovered ${recoveredCount} messages`);
                // Notify UI to refresh? For now, user might need to switch chats or scroll. 
                // Ideally we should emit an event or re-notify.
            }
            return recoveredCount;

        } catch (error) {
            console.error('[GroupRouter] Retry decryption failed:', error);
            return 0;
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

    public async getHistory(orderId: string, limit?: number, beforeTimestamp?: number): Promise<GroupMessage[]> {
        const messages = await this.persistence.getGroupMessages(orderId, limit, beforeTimestamp);

        // ✅ Active Decryption (Verbose Debugging)
        console.log(`[GroupRouter] getHistory loaded ${messages.length} msgs. Checking for failed...`);

        // Loosen filter: include 'failed' OR content placeholder, ignore encryptedContent presence for logging
        const failedMessages = messages.filter(m => m.status === 'failed' || m.content.includes('pending decryption'));

        if (failedMessages.length > 0) {
            console.log(`[GroupRouter] Found ${failedMessages.length} potential failed messages.`);
            let retryableCount = 0;

            failedMessages.forEach(m => {
                const hasEnc = !!m.encryptedContent;
                if (hasEnc) retryableCount++;
                else console.warn(`[GroupRouter] Message ${m.id} is failed but missing 'encryptedContent'. Cannot retry.`);
            });

            const retryable = failedMessages.filter(m => m.encryptedContent);
            if (retryable.length > 0) {
                console.log(`[GroupRouter] Retrying decryption for ${retryable.length} messages...`);
                this.retrySpecificMessages(retryable).catch(e => console.error('[GroupRouter] Retry failed:', e));
            }
        }

        return messages;
    }

    /**
     * 重试解密特定消息列表
     */
    public async retrySpecificMessages(messages: GroupMessage[]): Promise<number> {
        if (messages.length === 0) return 0;
        let recoveredCount = 0;
        console.log(`[GroupRouter] retrySpecificMessages started for IDs: ${messages.map(m => m.id).join(', ')}`);

        for (const msg of messages) {
            if (!msg.encryptedContent) continue;

            try {
                // Ensure Uint8Array (IndexedDB can sometimes degrade them to Objects)
                let encContent = msg.encryptedContent;
                if (encContent.ciphertext && !(encContent.ciphertext instanceof Uint8Array)) {
                    encContent.ciphertext = new Uint8Array(Object.values(encContent.ciphertext));
                }
                if (encContent.signature && !(encContent.signature instanceof Uint8Array)) {
                    encContent.signature = new Uint8Array(Object.values(encContent.signature));
                }

                const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                    this.myUserId,
                    encContent
                );

                const plaintext = new TextDecoder().decode(plaintextBytes);

                // Update message content
                msg.content = plaintext;
                msg.status = 'delivered';

                // Persist updates
                await this.persistence.saveMessage(msg);

                // Notify UI
                this.notifyUI(msg);
                recoveredCount++;
                console.log(`[GroupRouter] Successfully recovered message ${msg.id}`);
            } catch (e) {
                // Determine if we should log verbose errors
                console.error(`[GroupRouter] Decrypt retry failed for ${msg.id}:`, e);
            }
        }

        return recoveredCount;
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