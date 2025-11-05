// signal/services/p2p-message-router.enhanced.ts

import { e2eeService } from './e2ee.service';
import { WebSocketManager } from './websocket-manager';
import { MessagePersistenceService } from './message-persistence.service';
import { P2PApiService } from './p2p-api.service';
import { MessageSyncService } from './message-sync.service';
import { fileEncryptionService } from '../../utils/file-encryption.service';
import { createAuthenticatedApiClient } from '../../utils/api-client';
import { getOrderParticipants } from './users.api';
import axios from 'axios';
import type { SessionStateInfo } from './signal.store';
import type { P2PMessage, PersistedP2PMessage, OrderSessionInfo } from '../types/message.types';
import type { EncryptedFilePackage } from '../../utils/file-encryption.service';

export interface IP2PRouterResponse {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        messageType?: string;
        sessionInfo?: SessionStateInfo;
        timing?: number;
    };
}

/**
 * 增强版 P2P 消息路由器 - 完整的基于订单的在线/离线消息支持 + 文件传输
 */
export class EnhancedP2PMessageRouter {
    private myUserId: string;
    private wsManager: WebSocketManager;
    private persistence: MessagePersistenceService;
    private apiService: P2PApiService;
    private syncService: MessageSyncService;
    private fileApiClient = createAuthenticatedApiClient();

    private sessionStateCallbacks: Array<(stateInfo: SessionStateInfo) => void> = [];
    private messageHandlers: Array<(message: P2PMessage) => void> = [];
    private statusChangeCallbacks: Array<(status: string) => void> = [];
    private orderSessionCallbacks: Array<(session: OrderSessionInfo) => void> = [];
    private uploadProgressCallbacks = new Map<string, (progress: any) => void>();
    private downloadProgressCallbacks = new Map<string, (progress: number, total: number) => void>();

    constructor(userId: string) {
        this.myUserId = userId;
        this.wsManager = new WebSocketManager(userId);
        this.persistence = new MessagePersistenceService(userId);
        this.apiService = new P2PApiService();
        this.syncService = new MessageSyncService(userId);

        this.setupWebSocketHandlers();
        this.setupConnectionMonitor();
    }

    /**
     * 初始化路由器
     */
    async init(): Promise<void> {
        console.log(`[P2PRouter] Initializing for user: ${this.myUserId}`);

        await this.persistence.init();
        await this.syncService.init();

        this.wsManager.connect();

        console.log(`[P2PRouter] Initialization complete`);
    }

    /**
     * 发送文本消息（基于订单）
     */
    async sendMessage(orderId: string, content: string, type: P2PMessage['type'] = 'text'): Promise<IP2PRouterResponse> {
        const startTime = Date.now();
        const messageId = this.generateMessageId();

        try {
            // 1. 获取订单参与者信息
            const orderInfo = await this.getOrderInfo(orderId);
            const recipientId = orderInfo.otherUserId;

            console.log(`[P2PRouter] Sending ${type} message for order ${orderId} to ${recipientId}`);

            // 2. 确保加密会话
            await e2eeService.ensureSession(this.myUserId, recipientId);

            // 3. 加密消息
            const encryptedData = await e2eeService.encryptMessage(
                this.myUserId,
                recipientId,
                content
            );

            // 4. 构建消息对象
            const message: P2PMessage = {
                id: messageId,
                type: type,
                senderId: this.myUserId,
                recipientId: recipientId,
                orderId: orderId,
                content: content,
                encryptedContent: encryptedData,
                timestamp: Date.now(),
                status: 'pending'
            };

            // 5. 保存到本地
            await this.persistence.saveMessage(message);

            // 6. 发送消息（WebSocket优先）
            if (this.wsManager.isConnected()) {
                const sent = this.wsManager.send({
                    type: 'order_message',
                    data: {
                        id: messageId,
                        orderId: orderId,
                        recipientId: recipientId,
                        encryptedContent: JSON.stringify(encryptedData),
                        messageType: type,
                        timestamp: message.timestamp
                    }
                });

                if (sent) {
                    await this.persistence.updateMessageStatus(messageId, 'sent');
                    console.log(`[P2PRouter] Order message sent via WebSocket`);

                    return {
                        success: true,
                        data: {
                            messageId,
                            orderId,
                            recipientId,
                            method: 'websocket',
                            status: 'sent'
                        },
                        metadata: { timing: Date.now() - startTime }
                    };
                }
            }

            // 7. WebSocket不可用，使用HTTP API
            console.log(`[P2PRouter] WebSocket unavailable, using HTTP API for order message`);

            const serverMessage: PersistedP2PMessage = {
                id: messageId,
                senderId: this.myUserId,
                recipientId: recipientId,
                orderId: orderId,
                encryptedContent: JSON.stringify(encryptedData),
                messageType: type,
                timestamp: message.timestamp,
                status: 'sent'
            };

            const result = await this.apiService.sendMessage(serverMessage);
            await this.persistence.updateMessageStatus(messageId, 'sent');

            console.log(`[P2PRouter] Order message sent via HTTP API`);

            return {
                success: true,
                data: {
                    messageId: result.messageId,
                    orderId,
                    recipientId,
                    method: 'http',
                    status: 'sent',
                    serverTimestamp: result.serverTimestamp
                },
                metadata: { timing: Date.now() - startTime }
            };

        } catch (error) {
            console.error(`[P2PRouter] Send order message failed:`, error);

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 发送文件（基于订单）
     */
    async sendFile(orderId: string, file: File): Promise<IP2PRouterResponse> {
        const startTime = Date.now();
        const fileId = this.generateFileId();

        try {
            // 1. 获取订单参与者信息
            const orderInfo = await this.getOrderInfo(orderId);
            const recipientId = orderInfo.otherUserId;

            console.log(`[P2PRouter] Sending file ${file.name} for order ${orderId} to ${recipientId}`);

            // 2. 确保加密会话
            await e2eeService.ensureSession(this.myUserId, recipientId);

            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            // 3. 加密文件
            const encryptedPackage = await fileEncryptionService.encryptFileForP2P(
                file,
                this.myUserId,
                recipientId,
                progressCallback
            );

            // 4. 上传加密文件到服务器
            const uploadUrl = await this.uploadFileToServer(
                encryptedPackage.encryptedContent,
                fileId,
                orderId,
            );

            // 5. 构建文件消息
            const fileMessageContent = JSON.stringify({
                fileId: encryptedPackage.fileId,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type,
                uploadUrl: uploadUrl,
                metadata: encryptedPackage.metadata,
                signature: encryptedPackage.signature
            });

            // 6. 加密文件消息
            const encryptedData = await e2eeService.encryptMessage(
                this.myUserId,
                recipientId,
                fileMessageContent
            );

            // 7. 构建消息对象
            const message: P2PMessage = {
                id: this.generateMessageId(),
                type: 'file',
                senderId: this.myUserId,
                recipientId: recipientId,
                orderId: orderId,
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

            // 8. 保存到本地
            await this.persistence.saveMessage(message);

            // 9. 发送消息（WebSocket优先）
            if (this.wsManager.isConnected()) {
                const sent = this.wsManager.send({
                    type: 'order_message',
                    data: {
                        id: message.id,
                        orderId: orderId,
                        recipientId: recipientId,
                        encryptedContent: JSON.stringify(encryptedData),
                        messageType: 'file',
                        timestamp: message.timestamp,
                        metadata: message.metadata
                    }
                });

                if (sent) {
                    await this.persistence.updateMessageStatus(message.id, 'sent');
                    console.log(`[P2PRouter] Order file message sent via WebSocket`);

                    return {
                        success: true,
                        data: {
                            messageId: message.id,
                            orderId,
                            fileId: encryptedPackage.fileId,
                            recipientId,
                            method: 'websocket',
                            status: 'sent'
                        },
                        metadata: { timing: Date.now() - startTime }
                    };
                }
            }

            // 10. WebSocket不可用，使用HTTP API
            console.log(`[P2PRouter] WebSocket unavailable, using HTTP API for order file message`);

            const serverMessage: PersistedP2PMessage = {
                id: message.id,
                senderId: this.myUserId,
                recipientId: recipientId,
                orderId: orderId,
                encryptedContent: JSON.stringify(encryptedData),
                messageType: 'file',
                timestamp: message.timestamp,
                status: 'sent',
                metadata: message.metadata
            };

            const result = await this.apiService.sendMessage(serverMessage);
            await this.persistence.updateMessageStatus(message.id, 'sent');

            console.log(`[P2PRouter] Order file message sent via HTTP API`);

            return {
                success: true,
                data: {
                    messageId: result.messageId,
                    fileId: encryptedPackage.fileId,
                    orderId,
                    recipientId,
                    method: 'http',
                    status: 'sent',
                    serverTimestamp: result.serverTimestamp
                },
                metadata: { timing: Date.now() - startTime }
            };

        } catch (error) {
            console.error(`[P2PRouter] Send order file failed:`, error);

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 下载订单文件
     */
    async downloadOrderFile(message: P2PMessage): Promise<IP2PRouterResponse> {
        const startTime = Date.now();

        try {
            if (message.type !== 'file' || !message.metadata?.fileId) {
                throw new Error('Invalid file message');
            }

            console.log(`[P2PRouter] Downloading file for order ${message.orderId}: ${message.metadata.fileName}`);

            // 1. 解析文件消息
            const fileMessageData = JSON.parse(message.content);

            // 2. 下载加密文件内容
            const progressCallback = this.downloadProgressCallbacks.get(fileMessageData.fileId);
            const encryptedContent = await this.downloadFileFromServer(
                fileMessageData.uploadUrl,
                fileMessageData.fileId,
                progressCallback
            );

            // 3. 重建加密包
            const encryptedPackage: EncryptedFilePackage = {
                fileId: fileMessageData.fileId,
                metadata: fileMessageData.metadata,
                encryptedContent: encryptedContent,
                signature: fileMessageData.signature
            };

            // 4. 解密文件
            const decryptionResult = await fileEncryptionService.decryptP2PFile(
                encryptedPackage,
                this.myUserId,
                message.senderId
            );

            // 5. 创建本地下载链接
            const downloadUrl = fileEncryptionService.createDownloadUrl(
                decryptionResult.content,
                decryptionResult.originalName,
                decryptionResult.mimeType
            );

            console.log(`[P2PRouter] Order file decrypted successfully`);

            return {
                success: true,
                data: {
                    fileId: fileMessageData.fileId,
                    fileName: decryptionResult.originalName,
                    mimeType: decryptionResult.mimeType,
                    size: decryptionResult.size,
                    downloadUrl: downloadUrl,
                    isVerified: decryptionResult.isVerified,
                    orderId: message.orderId
                },
                metadata: { timing: Date.now() - startTime }
            };

        } catch (error) {
            console.error(`[P2PRouter] Download order file failed:`, error);

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { timing: Date.now() - startTime }
            };
        }
    }

    /**
     * 接收并处理订单消息
     */
    private async handleIncomingOrderMessage(data: any): Promise<void> {
        try {
            console.log(`[P2PRouter] Handling incoming order message for order ${data.orderId}`);

            const encryptedData = JSON.parse(data.encryptedContent);
            const plaintext = await e2eeService.decryptMessage(
                this.myUserId,
                data.senderId,
                encryptedData
            );

            const message: P2PMessage = {
                id: data.id,
                type: data.messageType || 'text',
                senderId: data.senderId,
                recipientId: this.myUserId,
                orderId: data.orderId,
                content: plaintext,
                encryptedContent: encryptedData,
                timestamp: data.timestamp,
                serverTimestamp: data.serverTimestamp,
                status: 'delivered',
                metadata: data.metadata
            };

            // 保存到本地
            await this.persistence.saveMessage(message);

            // 更新服务器状态
            try {
                await this.apiService.updateMessageStatus(data.id, 'delivered');
            } catch (error) {
                console.warn('[P2PRouter] Failed to update delivery status:', error);
            }

            // 触发消息处理器
            this.triggerMessageHandlers(message);

            console.log(`[P2PRouter] Order message ${data.id} processed successfully`);

        } catch (error) {
            console.error('[P2PRouter] Handle incoming order message failed:', error);
        }
    }

    /**
     * 同步订单的离线消息
     */
    async syncOrderOfflineMessages(orderId?: string): Promise<{ success: boolean; newMessages: number }> {
        console.log(`[P2PRouter] Syncing offline messages${orderId ? ` for order ${orderId}` : ''}`);

        const result = await this.syncService.syncOfflineMessages();

        if (result.success && result.newMessages > 0) {
            this.triggerStatusChange('offline_messages_synced');

            // 如果指定了订单ID，触发特定订单的更新
            if (orderId) {
                const session = await this.persistence.getOrderSession(orderId);
                if (session) {
                    this.triggerOrderSessionCallbacks(session);
                }
            }
        }

        return result;
    }

    /**
     * 重试发送失败的订单消息
     */
    async retryPendingOrderMessages(orderId?: string): Promise<{ success: boolean; sentCount: number }> {
        console.log(`[P2PRouter] Retrying pending messages${orderId ? ` for order ${orderId}` : ''}`);
        return await this.syncService.retrySendingPendingMessages(orderId);
    }

    /**
     * 标记订单消息为已读
     */
    async markOrderMessagesAsRead(orderId: string): Promise<void> {
        await this.syncService.markOrderMessagesAsRead(orderId);
    }

    /**
     * 获取订单聊天历史
     */
    async getOrderHistory(orderId: string, limit: number = 50, beforeTimestamp?: number): Promise<P2PMessage[]> {
        return await this.persistence.getOrderMessages(orderId, limit, beforeTimestamp);
    }

    /**
     * 获取用户的订单会话列表
     */
    async getOrderSessions(): Promise<OrderSessionInfo[]> {
        return await this.syncService.getOrderSessions();
    }

    /**
     * 获取特定订单的会话信息
     */
    async getOrderSession(orderId: string): Promise<OrderSessionInfo | null> {
        return await this.persistence.getOrderSession(orderId);
    }

    // ========== 注册回调方法 ==========

    onMessage(callback: (message: P2PMessage) => void): void {
        this.messageHandlers.push(callback);
    }

    onStatusChange(callback: (status: string) => void): void {
        this.statusChangeCallbacks.push(callback);
    }

    onSessionUpdate(callback: (stateInfo: SessionStateInfo) => void): void {
        this.sessionStateCallbacks.push(callback);
    }

    onOrderSessionUpdate(callback: (session: OrderSessionInfo) => void): void {
        this.orderSessionCallbacks.push(callback);
    }

    onFileUploadProgress(fileId: string, callback: (progress: any) => void): void {
        this.uploadProgressCallbacks.set(fileId, callback);
    }

    onFileDownloadProgress(fileId: string, callback: (progress: number, total: number) => void): void {
        this.downloadProgressCallbacks.set(fileId, callback);
    }

    // ========== 其他公共方法 ==========

    getConnectionStatus(): string {
        return this.wsManager.getStatus();
    }

    disconnect(): void {
        this.wsManager.disconnect();
    }

    cleanup(): void {
        this.wsManager.disconnect();
        this.syncService.cleanup();
        this.messageHandlers = [];
        this.statusChangeCallbacks = [];
        this.sessionStateCallbacks = [];
        this.orderSessionCallbacks = [];
        this.uploadProgressCallbacks.clear();
        this.downloadProgressCallbacks.clear();
    }

    // ========== 私有方法 ==========

    private setupWebSocketHandlers(): void {
        // 处理订单消息
        this.wsManager.on('order_message', (data) => {
            this.handleIncomingOrderMessage(data);
        });

        this.wsManager.onStatusChange((status) => {
            console.log(`[P2PRouter] Connection status: ${status}`);
            this.triggerStatusChange(status);
        });
    }

    private setupConnectionMonitor(): void {
        this.wsManager.onStatusChange(async (status) => {
            if (status === 'connected') {
                console.log('[P2PRouter] Connected, syncing offline messages');
                await this.syncOrderOfflineMessages();
                await this.retryPendingOrderMessages();
            }
        });
    }

    /**
     * 获取订单信息
     */
    private async getOrderInfo(orderId: string): Promise<{ otherUserId: string }> {
        try {
            const participants = await getOrderParticipants(orderId);
            const otherUserId = participants.participants.find(id => id !== this.myUserId);

            if (!otherUserId) {
                throw new Error(`Cannot find other participant in order ${orderId}`);
            }

            return { otherUserId };
        } catch (error) {
            console.error(`[P2PRouter] Get order info error for ${orderId}:`, error);
            throw new Error(`Failed to get order info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private triggerMessageHandlers(message: P2PMessage): void {
        this.messageHandlers.forEach(handler => {
            try {
                handler(message);
            } catch (error) {
                console.error('[P2PRouter] Message handler error:', error);
            }
        });
    }

    private triggerStatusChange(status: string): void {
        this.statusChangeCallbacks.forEach(callback => {
            try {
                callback(status);
            } catch (error) {
                console.error('[P2PRouter] Status callback error:', error);
            }
        });
    }

    private triggerOrderSessionCallbacks(session: OrderSessionInfo): void {
        this.orderSessionCallbacks.forEach(callback => {
            try {
                callback(session);
            } catch (error) {
                console.error('[P2PRouter] Order session callback error:', error);
            }
        });
    }

    /**
     * 上传文件到服务器
     */
    private async uploadFileToServer(content: ArrayBuffer, fileId: string, orderId: string): Promise<string> {
        const progressCallback = this.uploadProgressCallbacks.get(fileId);

        try {
            const formData = new FormData();
            formData.append('file', new Blob([content]), `${fileId}.encrypted`);
            formData.append('fileId', fileId);
            formData.append('orderId', orderId);
            formData.append('userId', this.myUserId);

            console.log(`[P2PRouter] Uploading file to server: ${fileId}`);

            const response = await this.fileApiClient.post<{
                success: boolean;
                downloadUrl: string;
                fileId: string;
                orderId: string;
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
                            orderId,
                            loaded: progressEvent.loaded,
                            total: progressEvent.total,
                            percent: percentCompleted,
                            stage: 'uploading'
                        });

                        console.log(`[P2PRouter] Upload progress: ${percentCompleted}%`);
                    }
                },
                timeout: 300000
            });

            if (!response.data.success) {
                throw new Error('Upload failed: Server returned unsuccessful response');
            }

            console.log(`[P2PRouter] Upload success: ${response.data.downloadUrl}`);
            return response.data.downloadUrl;

        } catch (error) {
            console.error('[P2PRouter] Upload error:', error);

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
     * 从服务器下载文件
     */
    private async downloadFileFromServer(
        url: string,
        _fileId: string,
        progressCallback?: (loaded: number, total: number) => void
    ): Promise<ArrayBuffer> {
        try {
            console.log(`[P2PRouter] Downloading from: ${url}`);

            const response = await this.fileApiClient.get<ArrayBuffer>(url, {
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    if (progressEvent.total && progressCallback) {
                        const percentCompleted = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );

                        progressCallback(progressEvent.loaded, progressEvent.total);
                        console.log(`[P2PRouter] Download progress: ${percentCompleted}%`);
                    }
                },
                timeout: 300000
            });

            console.log(`[P2PRouter] Download success: ${response.data.byteLength} bytes`);
            return response.data;

        } catch (error) {
            console.error('[P2PRouter] Download error:', error);

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
const routerInstances = new Map<string, EnhancedP2PMessageRouter>();

export function getEnhancedP2PRouter(userId: string): EnhancedP2PMessageRouter {
    if (!routerInstances.has(userId)) {
        routerInstances.set(userId, new EnhancedP2PMessageRouter(userId));
    }
    return routerInstances.get(userId)!;
}

export function clearAllP2PRouters(): void {
    routerInstances.forEach(router => router.cleanup());
    routerInstances.clear();
}