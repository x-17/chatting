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

    constructor(userId: string) {
        this.myUserId = userId;
        this.wsManager = getWebSocketManager(userId);
        this.persistence = new GroupMessagePersistenceService(userId);
        this.init();
    }

    private async init() {
        await this.persistence.init();
        this.setupWebSocketListeners();
        this.injectMessageSender();
        console.log(`[GroupRouter] Initialized for user ${this.myUserId}`);
    }

    private injectMessageSender() {
        const senderImplementation: IMessageSender = {
            // P2P 密钥分发：走 P2P 路由，使用 system 类型隐藏
            sendToUser: async (targetUserId: string, message: any) => {
                const p2pRouter = getEnhancedP2PRouter(this.myUserId);
                await p2pRouter.sendMessage(
                    'system_key_distribution',
                    JSON.stringify(message),
                    'system',
                    targetUserId
                );
            },

            // 群信令 (Member Joined/Removed)：走 WS，使用 'system' 类型
            sendToGroup: async (orderId: string, message: any) => {
                // message 结构: { type: 'MEMBER_JOINED', payload: {...} }
                // 我们把它序列化放入 content，并标记 type 为 system
                await this.wsManager.send({
                    id: `sig_${Date.now()}_${Math.random()}`,
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
     * 发送群组文本消息
     */
    public async sendGroupTextMessage(orderId: string, text: string): Promise<GroupMessage> {
        return this._sendGenericMessage(orderId, 'text', text);
    }

    /**
     * ✅ 发送群组文件消息
     * 1. 加密文件 (Group模式)
     * 2. 上传到服务器
     * 3. 发送包含文件元数据的加密消息
     */
    public async sendGroupFileMessage(orderId: string, file: File): Promise<GroupMessage> {
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const timestamp = Date.now();

        try {
            // 1. 加密文件
            // 使用 fileEncryptionService.encryptFileForGroup
            const encryptedPackage = await fileEncryptionService.encryptFileForGroup(
                file,
                this.myUserId,
                orderId
            );

            // 2. 上传加密内容
            // 这里的 encryptedPackage.encryptedContent 是 ArrayBuffer
            const blob = new Blob([encryptedPackage.encryptedContent]);
            const serverFileId = await groupApiService.uploadFile(blob, orderId);

            // 3. 构建消息内容 (Metadata)

            const fileMessageContent = JSON.stringify({
                fileId: serverFileId,           // 服务器返回的 ID
                localFileId: encryptedPackage.fileId, // 前端生成的 ID
                metadata: encryptedPackage.metadata,
                signature: encryptedPackage.signature
            });

            // 4. 发送加密后的 Metadata 消息
            // 这里复用 _sendGenericMessage，它会负责把 fileMessageContent 进行 SenderKey 加密
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
     * ✅ 下载并解密群组文件
     */
    public async downloadGroupFile(message: GroupMessage): Promise<string> {
        try {
            if (message.type !== 'file') throw new Error('Not a file message');

            // 1. 解析消息内容 (这是解密后的明文 JSON)
            const fileInfo = JSON.parse(message.content);
            const { fileId, metadata, signature } = fileInfo;

            // 2. 下载加密文件流
            const encryptedBuffer = await groupApiService.downloadFile(fileId);

            // 3. 组装成 EncryptedFilePackage 供解密服务使用
            const packageToDecrypt: EncryptedFilePackage = {
                fileId: fileInfo.localFileId,
                metadata: metadata,
                encryptedContent: encryptedBuffer,
                signature: signature
            };

            // 4. 解密
            // 使用 fileEncryptionService.decryptGroupFile
            const result = await fileEncryptionService.decryptGroupFile(
                packageToDecrypt,
                this.myUserId,
                message.orderId,
                message.senderId
            );

            // 5. 生成 Blob URL
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
     * 通用发送逻辑 (文本/文件元数据)
     */
    private async _sendGenericMessage(
        orderId: string,
        type: 'text' | 'file',
        contentString: string,
        extraMetadata: any = {}
    ): Promise<GroupMessage> {
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const timestamp = Date.now();

        // 1. 构建本地消息
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
            // 2. 加密内容 (Sender Key Ratchet)
            const encoder = new TextEncoder();
            const encryptedPackage = await groupE2eeService.encryptGroupMessage(
                this.myUserId,
                orderId,
                encoder.encode(contentString)
            );

            // 3. 通过 WebSocket 发送
            // ✅ 使用标准 WebSocketMessage 结构，不新增字段
            await this.wsManager.send({
                id: this.wsManager['generateMessageId'] ? this.wsManager['generateMessageId']() : messageId,
                messageType: type, // 'text' 或 'file'
                orderId: orderId,
                encryptedContent: JSON.stringify(encryptedPackage), // 只有加密后的内容上链
                timestamp: timestamp
            }, { requireAck: true });

            // 4. 更新状态
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

    private setupWebSocketListeners() {
        // 监听通用业务消息 (text/file)
        const businessTypes = ['text', 'file'];
        businessTypes.forEach(type => {
            this.wsManager.on(type, async (data: any) => {
                // 只有带有 orderId 且 encryptedContent 不为空的才可能是群消息
                // 注意：P2P 消息也是 text/file，如何区分？
                // 策略：如果 P2P 消息使用 recipientId，而群消息不使用 (或使用 orderId 查找群组)
                // 这里假设 wsManager 转发过来的 data 包含 orderId。
                // *关键*: 我们尝试用 Group Session 解密，如果成功就是群消息；
                // 或者我们可以约定 WebSocket 层面 P2P 消息必须有 recipientId，群消息没有。
                if (data.orderId && !data.recipientId) {
                    await this.handleIncomingGroupMessage(data);
                }
            });
        });

        // 监听信令 (system)
        this.wsManager.on('system', async (data: any) => {
            if (data.orderId && data.content) {
                // 尝试解析是否为群信令
                try {
                    const payload = JSON.parse(data.content);
                    // 检查 payload 是否包含群信令特征
                    if (['MEMBER_JOINED', 'MEMBER_REMOVED', 'KEY_DISTRIBUTION'].includes(payload.type)) {
                        await this.handleIncomingGroupSignal(data.orderId, payload);
                    }
                } catch (e) {
                    // 不是 JSON 或不是群信令，忽略
                }
            }
        });
    }

    private async handleIncomingGroupMessage(data: any) {
        try {
            const { orderId, senderId, encryptedContent, id, timestamp, messageType } = data;

            // 1. SenderKey 解密
            const encryptedPackage = JSON.parse(encryptedContent);
            const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                this.myUserId,
                encryptedPackage
            );
            const content = new TextDecoder().decode(plaintextBytes);

            // 2. 构建消息
            const message: GroupMessage = {
                id: id || `recv_${Date.now()}`,
                type: messageType, // 'text' or 'file'
                orderId: orderId,
                senderId: senderId,
                content: content, // 文件消息这里是 JSON 元数据
                timestamp: timestamp || Date.now(),
                status: 'delivered'
            };

            await this.persistence.saveMessage(message);
            this.notifyUI(message);

        } catch (error) {
            // 解密失败可能是因为这不是群消息，或者密钥缺失
            // 静默失败或记录日志，避免干扰 P2P 逻辑
            // console.debug('[GroupRouter] Decrypt attempt failed:', error);
        }
    }

    private async handleIncomingGroupSignal(orderId: string, signal: any) {
        console.log(`[GroupRouter] Signal: ${signal.type} for ${orderId}`);
        switch (signal.type) {
            case 'MEMBER_JOINED':
                await groupManagementService.handleMemberJoinedSignal(this.myUserId, signal.payload);
                break;
            case 'MEMBER_REMOVED':
                await groupManagementService.handleMemberRemovedSignal(this.myUserId, signal.payload);
                break;
            case 'KEY_DISTRIBUTION':
                await groupManagementService.handleKeyDistributionSignal(this.myUserId, signal.payload);
                break;
        }
    }

    public onMessage(handler: (msg: GroupMessage) => void) {
        this.messageHandlers.push(handler);
    }

    private notifyUI(msg: GroupMessage) {
        this.messageHandlers.forEach(h => h(msg));
    }

    public async getHistory(orderId: string, limit?: number) {
        return this.persistence.getGroupMessages(orderId, limit);
    }
}