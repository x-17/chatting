// groupchat/services/enhanced-group-message-router.ts

import { groupE2eeService } from './group-e2ee-service';
import { groupManagementService } from './group-management-service';
import { WebSocketManager } from '../../signal/services/websocket-manager';
import { GroupMessagePersistenceService } from './group-message-persistence.service';
import { GroupApiService } from './group-api.service';
import { GroupMessageSyncService } from './group-message-sync.service';
import { fileEncryptionService } from '../../utils/file-encryption.service';
import { createAuthenticatedApiClient } from '../../utils/api-client';
import axios from 'axios';
import type { GroupMessage, PersistedGroupMessage } from '../types/group-message.types';
import type { ISenderKeyDistributionMessage } from '../protocol/types';
import type { EncryptedFilePackage } from '../../utils/file-encryption.service';

export interface IGroupRouterResponse {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        operation?: string;
        timing?: number;
    };
}

/**
 * 增强版群组消息路由器 - 完整的在线/离线消息支持 + 文件传输
 */
export class EnhancedGroupMessageRouter {
    private myUserId: string;
    private wsManager: WebSocketManager;
    private persistence: GroupMessagePersistenceService;
    private apiService: GroupApiService;
    private syncService: GroupMessageSyncService;
    private fileApiClient = createAuthenticatedApiClient();

    private messageHandlers: Array<(message: GroupMessage) => void> = [];
    private statusChangeCallbacks: Array<(status: string) => void> = [];
    private myGroups = new Set<string>();
    private uploadProgressCallbacks = new Map<string, (progress: any) => void>();
    private downloadProgressCallbacks = new Map<string, (progress: number, total: number) => void>();

    constructor(userId: string) {
        this.myUserId = userId;
        this.wsManager = new WebSocketManager(userId);
        this.persistence = new GroupMessagePersistenceService(userId);
        this.apiService = new GroupApiService();
        this.syncService = new GroupMessageSyncService(userId);

        this.setupWebSocketHandlers();
        this.setupConnectionMonitor();
    }

    /**
     * 初始化路由器
     */
    async init(orderIds: string[] = []): Promise<void> {
        console.log(`[GroupRouter] Initializing for user: ${this.myUserId}`);

        await this.persistence.init();
        await this.syncService.init();

        orderIds.forEach(id => this.myGroups.add(id));

        // 🆕 为每个群组同步历史密钥
        for (const groupId of orderIds) {
            await this.syncGroupKeys(groupId);
        }

        this.wsManager.connect();

        console.log(`[GroupRouter] Initialization complete, groups: ${orderIds.join(', ')}`);
    }

    /**
     * 创建群组
     */
    async createGroup(orderId: string, memberIds: string[]): Promise<IGroupRouterResponse> {
        const startTime = Date.now();

        try {
            console.log(`[GroupRouter] Creating group ${orderId} with members: ${memberIds.join(', ')}`);

            await groupManagementService.createGroup(orderId, this.myUserId, memberIds);

            await this.apiService.createGroup(orderId, [this.myUserId, ...memberIds]);

            const distMessage = await groupE2eeService.createGroupSession(this.myUserId, orderId);

            await this.apiService.distributeGroupKey({
                id: this.generateMessageId(),
                orderId: orderId,
                senderId: this.myUserId,
                distributionMessage: JSON.stringify(distMessage),
                timestamp: Date.now()
            });

            if (this.wsManager.isConnected()) {
                this.wsManager.send({
                    type: 'group_created',
                    data: {
                        orderId,
                        adminId: this.myUserId,
                        memberIds: [this.myUserId, ...memberIds],
                        distributionMessage: distMessage
                    }
                });
            }

            this.myGroups.add(orderId);

            return {
                success: true,
                data: { orderId, memberIds },
                metadata: {
                    operation: 'CREATE_GROUP',
                    timing: Date.now() - startTime
                }
            };

        } catch (error) {
            console.error(`[GroupRouter] Create group failed:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 发送群组消息
     */
    async sendGroupMessage(orderId: string, content: string, type: GroupMessage['type'] = 'text'): Promise<IGroupRouterResponse> {
        const startTime = Date.now();
        const messageId = this.generateMessageId();

        try {
            console.log(`[GroupRouter] Sending ${type} message to group ${orderId}`);

            const plaintextBytes = new TextEncoder().encode(content);
            const encryptedData = await groupE2eeService.encryptGroupMessage(
                this.myUserId,
                orderId,
                plaintextBytes
            );

            const message: GroupMessage = {
                id: messageId,
                type: type,
                orderId: orderId,
                senderId: this.myUserId,
                content: content,
                encryptedContent: encryptedData,
                timestamp: Date.now(),
                status: 'pending'
            };

            await this.persistence.saveMessage(message);

            if (this.wsManager.isConnected()) {
                const sent = this.wsManager.send({
                    type: 'group_message',
                    data: {
                        id: messageId,
                        groupId: orderId,
                        encryptedContent: JSON.stringify(encryptedData),
                        messageType: type,
                        timestamp: message.timestamp
                    }
                });

                if (sent) {
                    await this.persistence.updateMessageStatus(messageId, 'sent');

                    console.log(`[GroupRouter] Message sent via WebSocket`);

                    return {
                        success: true,
                        data: {
                            messageId,
                            method: 'websocket',
                            status: 'sent'
                        },
                        metadata: { timing: Date.now() - startTime }
                    };
                }
            }

            console.log(`[GroupRouter] WebSocket unavailable, using HTTP API`);

            const serverMessage: PersistedGroupMessage = {
                id: messageId,
                orderId: orderId,
                senderId: this.myUserId,
                encryptedContent: JSON.stringify(encryptedData),
                messageType: type,
                timestamp: message.timestamp,
                status: 'sent'
            };

            const result = await this.apiService.sendGroupMessage(serverMessage);
            await this.persistence.updateMessageStatus(messageId, 'sent');

            console.log(`[GroupRouter] Message sent via HTTP API`);

            return {
                success: true,
                data: {
                    messageId: result.messageId,
                    method: 'http',
                    status: 'sent',
                    serverTimestamp: result.serverTimestamp
                },
                metadata: { timing: Date.now() - startTime }
            };

        } catch (error) {
            console.error(`[GroupRouter] Send message failed:`, error);

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 发送群组文件
     */
    async sendGroupFile(orderId: string, file: File): Promise<IGroupRouterResponse> {
        const startTime = Date.now();
        const fileId = this.generateFileId();

        try {
            console.log(`[GroupRouter] Sending file ${file.name} to group ${orderId}`);

            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            // 1. 加密文件（返回明文元数据）
            const encryptedPackage = await fileEncryptionService.encryptFileForGroup(
                file,
                this.myUserId,
                orderId,
                progressCallback
            );
            // ✅ encryptedPackage.metadata 现在是明文对象

            // 2. 上传加密文件到服务器
            const uploadUrl = await this.uploadFileToServer(
                encryptedPackage.encryptedContent,
                fileId
            );

            // 3. ✅ 构建文件消息（包含明文元数据对象）
            const fileMessageContent = JSON.stringify({
                fileId: encryptedPackage.fileId,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type,
                uploadUrl: uploadUrl,
                metadata: encryptedPackage.metadata,  // ✅ 明文元数据对象
                signature: encryptedPackage.signature
            });

            // 4. ✅ 只加密一次：使用 Sender Key 加密整个文件消息
            const plaintextBytes = new TextEncoder().encode(fileMessageContent);
            const encryptedData = await groupE2eeService.encryptGroupMessage(
                this.myUserId,
                orderId,
                plaintextBytes
            );
            // 棘轮只推进 1次 ⬆️

            // 5. 构建消息对象
            const message: GroupMessage = {
                id: this.generateMessageId(),
                type: 'file',
                orderId: orderId,
                senderId: this.myUserId,
                content: fileMessageContent,
                encryptedContent: encryptedData,
                timestamp: Date.now(),
                status: 'pending',
                metadata: {
                    fileId: encryptedPackage.fileId,
                    fileName: file.name,
                    fileSize: file.size,
                    mimeType: file.type
                }
            };

            // 6. 保存到本地
            await this.persistence.saveMessage(message);

            // 7. 发送消息（WebSocket 优先）
            if (this.wsManager.isConnected()) {
                const sent = this.wsManager.send({
                    type: 'group_message',
                    data: {
                        id: message.id,
                        orderId: orderId,
                        encryptedContent: JSON.stringify(encryptedData),
                        messageType: 'file',
                        timestamp: message.timestamp,
                        metadata: message.metadata
                    }
                });

                if (sent) {
                    await this.persistence.updateMessageStatus(message.id, 'sent');
                    console.log(`[GroupRouter] File message sent via WebSocket`);

                    return {
                        success: true,
                        data: {
                            messageId: message.id,
                            fileId: encryptedPackage.fileId,
                            method: 'websocket',
                            status: 'sent'
                        },
                        metadata: { timing: Date.now() - startTime }
                    };
                }
            }

            // 8. WebSocket 不可用，使用 HTTP API
            console.log(`[GroupRouter] Using HTTP API for file message`);

            const serverMessage: PersistedGroupMessage = {
                id: message.id,
                orderId: orderId,
                senderId: this.myUserId,
                encryptedContent: JSON.stringify(encryptedData),
                messageType: 'file',
                timestamp: message.timestamp,
                status: 'sent',
                metadata: message.metadata
            };

            const result = await this.apiService.sendGroupMessage(serverMessage);
            await this.persistence.updateMessageStatus(message.id, 'sent');

            console.log(`[GroupRouter] File message sent via HTTP API`);

            return {
                success: true,
                data: {
                    messageId: result.messageId,
                    fileId: encryptedPackage.fileId,
                    method: 'http',
                    status: 'sent',
                    serverTimestamp: result.serverTimestamp
                },
                metadata: { timing: Date.now() - startTime }
            };

        } catch (error) {
            console.error(`[GroupRouter] Send file failed:`, error);

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 下载群组文件
     */
    async downloadGroupFile(message: GroupMessage): Promise<IGroupRouterResponse> {
        const startTime = Date.now();

        try {
            if (message.type !== 'file' || !message.metadata?.fileId) {
                throw new Error('Invalid file message');
            }

            console.log(`[GroupRouter] Downloading file: ${message.metadata.fileName}`);

            // 1. 解析文件消息（已通过 Sender Key 解密）
            const fileMessageData = JSON.parse(message.content);
            // ✅ fileMessageData.metadata 现在是明文对象

            // 2. 下载加密文件内容
            const progressCallback = this.downloadProgressCallbacks.get(fileMessageData.fileId);
            const encryptedContent = await this.downloadFileFromServer(
                fileMessageData.uploadUrl,
                fileMessageData.fileId,
                progressCallback
            );

            // 3. ✅ 重建加密包（包含明文元数据对象）
            const encryptedPackage: EncryptedFilePackage = {
                fileId: fileMessageData.fileId,
                metadata: fileMessageData.metadata,  // ✅ 明文对象
                encryptedContent: encryptedContent,
                signature: fileMessageData.signature
            };

            // 4. ✅ 解密文件（内部直接使用明文元数据中的密钥）
            const decryptionResult = await fileEncryptionService.decryptGroupFile(
                encryptedPackage,
                this.myUserId,
                message.orderId,
                message.senderId
            );

            // 5. 创建本地下载链接
            const downloadUrl = fileEncryptionService.createDownloadUrl(
                decryptionResult.content,
                decryptionResult.originalName,
                decryptionResult.mimeType
            );

            console.log(`[GroupRouter] File decrypted successfully`);

            return {
                success: true,
                data: {
                    fileId: fileMessageData.fileId,
                    fileName: decryptionResult.originalName,
                    mimeType: decryptionResult.mimeType,
                    size: decryptionResult.size,
                    downloadUrl: downloadUrl,
                    isVerified: decryptionResult.isVerified
                },
                metadata: { timing: Date.now() - startTime }
            };

        } catch (error) {
            console.error(`[GroupRouter] Download file failed:`, error);

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 接收并处理群组消息
     */
    private async handleIncomingGroupMessage(data: any): Promise<void> {
        try {
            console.log(`[GroupRouter] Handling incoming message from ${data.senderId} in group ${data.orderId}`);

            const encryptedData = JSON.parse(data.encryptedContent);
            const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                this.myUserId,
                encryptedData
            );
            const plaintext = new TextDecoder().decode(plaintextBytes);

            const message: GroupMessage = {
                id: data.id,
                type: data.messageType || 'text',
                orderId: data.orderId,
                senderId: data.senderId,
                content: plaintext,
                encryptedContent: encryptedData,
                timestamp: data.timestamp,
                serverTimestamp: data.serverTimestamp,
                status: 'delivered',
                metadata: data.metadata
            };

            await this.persistence.saveMessage(message);

            this.triggerMessageHandlers(message);

            console.log(`[GroupRouter] Message ${data.id} processed successfully`);

        } catch (error) {
            console.error('[GroupRouter] Handle incoming message failed:', error);
        }
    }

    /**
     * 处理密钥分发消息
     */
    private async handleKeyDistribution(data: any): Promise<void> {
        try {
            console.log(`[GroupRouter] Handling key distribution from ${data.senderId} for group ${data.orderId}`);

            const distMessage: ISenderKeyDistributionMessage = JSON.parse(data.distributionMessage);

            await groupE2eeService.processGroupKeyDistribution(
                this.myUserId,
                data.senderId,
                distMessage
            );

            console.log(`[GroupRouter] Key distribution processed successfully`);

        } catch (error) {
            console.error('[GroupRouter] Handle key distribution failed:', error);
        }
    }

    /**
     * 添加成员到群组
     */
    async addMember(orderId: string, newMemberId: string): Promise<IGroupRouterResponse> {
        const startTime = Date.now();

        try {
            console.log(`[GroupRouter] Adding member ${newMemberId} to group ${orderId}`);

            await this.apiService.addGroupMember(orderId, newMemberId);

            await groupManagementService.addMemberToGroup(orderId, this.myUserId, newMemberId);

            // 🔄 如果新成员是自己，获取并处理历史密钥
            if (newMemberId === this.myUserId) {
                const distributions = await this.apiService.getGroupKeyDistributions(orderId);

                console.log(`[GroupRouter] Retrieved ${distributions.length} key distributions for new member`);

                // 🆕 处理这些分发消息
                for (const dist of distributions) {
                    await this.handleKeyDistribution({
                        groupId: dist.orderId,
                        senderId: dist.senderId,
                        distributionMessage: dist.distributionMessage
                    });
                }

                console.log(`[GroupRouter] Processed all key distributions for new member`);
            }

            return {
                success: true,
                data: { orderId, newMemberId },
                metadata: {
                    operation: 'ADD_MEMBER',
                    timing: Date.now() - startTime
                }
            };

        } catch (error) {
            console.error(`[GroupRouter] Add member failed:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 从群组移除成员
     */
    async removeMember(orderId: string, memberIdToRemove: string): Promise<IGroupRouterResponse> {
        const startTime = Date.now();

        try {
            console.log(`[GroupRouter] Removing member ${memberIdToRemove} from group ${orderId}`);

            await this.apiService.removeGroupMember(orderId, memberIdToRemove);

            await groupManagementService.removeMemberFromGroup(orderId, this.myUserId, memberIdToRemove);

            const newDistMessage = await groupE2eeService.createGroupSession(this.myUserId, orderId);

            await this.apiService.distributeGroupKey({
                id: this.generateMessageId(),
                orderId: orderId,
                senderId: this.myUserId,
                distributionMessage: JSON.stringify(newDistMessage),
                timestamp: Date.now()
            });

            return {
                success: true,
                data: { orderId, memberIdToRemove },
                metadata: {
                    operation: 'REMOVE_MEMBER',
                    timing: Date.now() - startTime
                }
            };

        } catch (error) {
            console.error(`[GroupRouter] Remove member failed:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 同步所有群组的离线消息
     */
    async syncAllOfflineMessages(): Promise<{ success: boolean; totalNewMessages: number }> {
        console.log('[GroupRouter] Syncing offline messages for all groups');

        const orderIds = Array.from(this.myGroups);
        const result = await this.syncService.syncAllGroupsOfflineMessages(orderIds);

        if (result.success && result.totalNewMessages > 0) {
            this.triggerStatusChange('offline_messages_synced');
        }

        return {
            success: result.success,
            totalNewMessages: result.totalNewMessages
        };
    }

    /**
     * 同步指定群组的离线消息
     */
    async syncGroupOfflineMessages(orderId: string): Promise<{ success: boolean; newMessages: number }> {
        return await this.syncService.syncGroupOfflineMessages(orderId);
    }

    /**
     * 重试发送失败的消息
     */
    async retryPendingMessages(): Promise<{ success: boolean; sentCount: number }> {
        console.log('[GroupRouter] Retrying pending messages');
        return await this.syncService.retrySendingPendingMessages();
    }

    /**
     * 获取群组历史消息
     */
    async getGroupHistory(orderId: string, limit: number = 50): Promise<GroupMessage[]> {
        return await this.persistence.getGroupMessages(orderId, limit);
    }

    /**
     * 注册消息处理器
     */
    onMessage(callback: (message: GroupMessage) => void): void {
        this.messageHandlers.push(callback);
    }

    /**
     * 注册状态变化回调
     */
    onStatusChange(callback: (status: string) => void): void {
        this.statusChangeCallbacks.push(callback);
    }

    /**
     * 注册文件上传进度回调
     */
    onFileUploadProgress(fileId: string, callback: (progress: any) => void): void {
        this.uploadProgressCallbacks.set(fileId, callback);
    }

    /**
     * 注册文件下载进度回调
     */
    onFileDownloadProgress(fileId: string, callback: (progress: number, total: number) => void): void {
        this.downloadProgressCallbacks.set(fileId, callback);
    }

    /**
     * 获取连接状态
     */
    getConnectionStatus(): string {
        return this.wsManager.getStatus();
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        this.wsManager.disconnect();
    }

    /**
     * 清理资源
     */
    cleanup(): void {
        this.wsManager.disconnect();
        this.syncService.cleanup();
        this.messageHandlers = [];
        this.statusChangeCallbacks = [];
        this.myGroups.clear();
        this.uploadProgressCallbacks.clear();
        this.downloadProgressCallbacks.clear();
    }

    // ========== 私有方法 ==========

    /**
     * 🆕 同步群组的历史密钥分发
     */
    private async syncGroupKeys(orderId: string): Promise<void> {
        try {
            console.log(`[GroupRouter] Syncing keys for group: ${orderId}`);

            const distributions = await this.apiService.getGroupKeyDistributions(orderId);

            console.log(`[GroupRouter] Retrieved ${distributions.length} key distributions`);

            // 处理每个分发消息
            for (const dist of distributions) {
                await this.handleKeyDistribution({
                    orderId: dist.orderId,
                    senderId: dist.senderId,
                    distributionMessage: dist.distributionMessage
                });
            }

            console.log(`[GroupRouter] Keys synced for group: ${orderId}`);
        } catch (error) {
            console.error(`[GroupRouter] Failed to sync keys for group ${orderId}:`, error);
            // 不抛出错误，允许继续初始化
        }
    }

    private setupWebSocketHandlers(): void {
        this.wsManager.on('group_message', (data) => {
            this.handleIncomingGroupMessage(data);
        });

        this.wsManager.on('key_distribution', (data) => {
            this.handleKeyDistribution(data);
        });

        this.wsManager.on('group_created', (data) => {
            console.log(`[GroupRouter] Group created: ${data.orderId}`);
            this.myGroups.add(data.orderId);
            if (data.distributionMessage) {
                this.handleKeyDistribution({
                    orderId: data.orderId,
                    senderId: data.adminId,
                    distributionMessage: JSON.stringify(data.distributionMessage)
                });
            }
        });

        this.wsManager.onStatusChange((status) => {
            console.log(`[GroupRouter] Connection status: ${status}`);
            this.triggerStatusChange(status);
        });
    }

    private setupConnectionMonitor(): void {
        this.wsManager.onStatusChange(async (status) => {
            if (status === 'connected') {
                console.log('[GroupRouter] Connected, syncing offline messages');

                await this.syncAllOfflineMessages();
                await this.retryPendingMessages();
            }
        });
    }

    private triggerMessageHandlers(message: GroupMessage): void {
        this.messageHandlers.forEach(handler => {
            try {
                handler(message);
            } catch (error) {
                console.error('[GroupRouter] Message handler error:', error);
            }
        });
    }

    private triggerStatusChange(status: string): void {
        this.statusChangeCallbacks.forEach(callback => {
            try {
                callback(status);
            } catch (error) {
                console.error('[GroupRouter] Status callback error:', error);
            }
        });
    }

    /**
     * 上传文件到服务器（使用 axios）
     */
    private async uploadFileToServer(content: ArrayBuffer, fileId: string): Promise<string> {
        const progressCallback = this.uploadProgressCallbacks.get(fileId);

        try {
            const formData = new FormData();
            formData.append('file', new Blob([content]), `${fileId}.encrypted`);
            formData.append('fileId', fileId);
            formData.append('userId', this.myUserId);

            console.log(`[GroupRouter] Uploading file to server: ${fileId}`);

            const response = await this.fileApiClient.post<{
                success: boolean;
                downloadUrl: string;
                fileId: string;
            }>('/api/files/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                },
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total && progressCallback) {
                        const percentCompleted = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );

                        progressCallback({
                            fileId,
                            loaded: progressEvent.loaded,
                            total: progressEvent.total,
                            percent: percentCompleted,
                            stage: 'uploading'
                        });

                        console.log(`[GroupRouter] Upload progress: ${percentCompleted}%`);
                    }
                },
                timeout: 300000
            });

            if (!response.data.success) {
                throw new Error('Upload failed: Server returned unsuccessful response');
            }

            console.log(`[GroupRouter] Upload success: ${response.data.downloadUrl}`);
            return response.data.downloadUrl;

        } catch (error) {
            console.error('[GroupRouter] Upload error:', error);

            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    throw new Error('文件上传超时，请检查网络连接后重试');
                } else if (error.response?.status === 413) {
                    throw new Error('文件过大，超出服务器限制');
                } else if (error.response?.status === 401) {
                    throw new Error('身份验证失败，请重新登录');
                } else if (error.response?.status === 500) {
                    throw new Error('服务器错误，请稍后重试');
                }
            }

            throw new Error('文件上传失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * 从服务器下载文件（使用 axios）
     */
    private async downloadFileFromServer(
        url: string,
        _fileId: string,
        progressCallback?: (loaded: number, total: number) => void
    ): Promise<ArrayBuffer> {
        try {
            console.log(`[GroupRouter] Downloading from: ${url}`);

            const response = await this.fileApiClient.get<ArrayBuffer>(url, {
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    if (progressEvent.total && progressCallback) {
                        const percentCompleted = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );

                        progressCallback(progressEvent.loaded, progressEvent.total);
                        console.log(`[GroupRouter] Download progress: ${percentCompleted}%`);
                    }
                },
                timeout: 300000
            });

            console.log(`[GroupRouter] Download success: ${response.data.byteLength} bytes`);
            return response.data;

        } catch (error) {
            console.error('[GroupRouter] Download error:', error);

            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    throw new Error('文件下载超时，请检查网络连接后重试');
                } else if (error.response?.status === 404) {
                    throw new Error('文件不存在或已过期');
                } else if (error.response?.status === 401) {
                    throw new Error('身份验证失败，请重新登录');
                } else if (error.response?.status === 500) {
                    throw new Error('服务器错误，请稍后重试');
                }
            }

            throw new Error('文件下载失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    private generateFileId(): string {
        return `file_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
}

// 工厂函数
const groupRouterInstances = new Map<string, EnhancedGroupMessageRouter>();

export function getEnhancedGroupRouter(userId: string): EnhancedGroupMessageRouter {
    if (!groupRouterInstances.has(userId)) {
        groupRouterInstances.set(userId, new EnhancedGroupMessageRouter(userId));
    }
    return groupRouterInstances.get(userId)!;
}

export function clearAllGroupRouters(): void {
    groupRouterInstances.forEach(router => router.cleanup());
    groupRouterInstances.clear();
}