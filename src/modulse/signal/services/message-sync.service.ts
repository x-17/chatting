// services/message-sync.service.ts

import { P2PApiService } from './p2p-api.service';
import { MessagePersistenceService } from './message-persistence.service';
import { e2eeService } from './e2ee.service';
import type { P2PMessage, PersistedP2PMessage, OrderSessionInfo } from '../types/message.types';

/**
 * 消息同步服务 - 处理离线消息同步（基于订单）
 */
export class MessageSyncService {
    private userId: string;
    private apiService: P2PApiService;
    private persistence: MessagePersistenceService;
    private isSyncing = false;
    private lastSyncTimestamp: number = 0;

    constructor(userId: string) {
        this.userId = userId;
        this.apiService = new P2PApiService();
        this.persistence = new MessagePersistenceService(userId);
        this.loadLastSyncTime();
    }

    /**
     * 初始化
     */
    async init(): Promise<void> {
        await this.persistence.init();
        this.loadLastSyncTime();
        console.log(`[MessageSync] Initialized for user: ${this.userId}`);
    }

    /**
     * 同步离线消息
     */
    async syncOfflineMessages(): Promise<{
        success: boolean;
        newMessages: number;
        error?: string;
    }> {
        if (this.isSyncing) {
            console.log('[MessageSync] Sync already in progress');
            return { success: false, newMessages: 0, error: 'Sync in progress' };
        }

        this.isSyncing = true;
        console.log(`[MessageSync] Starting sync from timestamp: ${this.lastSyncTimestamp}`);

        try {
            // 1. 从服务器拉取离线消息
            const serverMessages = await this.apiService.getOfflineMessages(this.lastSyncTimestamp);

            if (serverMessages.length === 0) {
                console.log('[MessageSync] No new offline messages');
                this.isSyncing = false;
                return { success: true, newMessages: 0 };
            }

            console.log(`[MessageSync] Retrieved ${serverMessages.length} offline messages`);

            // 2. 解密消息
            const decryptedMessages: P2PMessage[] = [];

            for (const serverMsg of serverMessages) {
                try {
                    // 解析加密内容
                    const encryptedData = JSON.parse(serverMsg.encryptedContent);

                    // 解密
                    const decryptionResult = await e2eeService.decryptMessage(
                        this.userId,
                        serverMsg.senderId,
                        encryptedData
                    );

                    if (!decryptionResult.success || !decryptionResult.content) {
                        console.error(`[MessageSync] Failed to decrypt message ${serverMsg.id}:`, decryptionResult.error);
                        continue;
                    }

                    // 构建本地消息对象
                    const message: P2PMessage = {
                        id: serverMsg.id,
                        type: serverMsg.messageType,
                        senderId: serverMsg.senderId,
                        orderId: serverMsg.orderId,
                        recipientId: serverMsg.recipientId,
                        content: decryptionResult.content,
                        encryptedContent: encryptedData,
                        timestamp: serverMsg.timestamp,
                        sequence: serverMsg.sequence || await this.generateLocalSequence(serverMsg.orderId),
                        status: 'delivered' as const,
                        sendAttempts: serverMsg.sendAttempts || 0,
                        maxRetries: serverMsg.maxRetries || 3,
                        retryDelay: 1000,
                        deliveryConfirmed: true,
                        readConfirmed: false,
                        metadata: serverMsg.metadata
                    };

                    decryptedMessages.push(message);

                } catch (error) {
                    console.error(`[MessageSync] Failed to process message ${serverMsg.id}:`, error);
                }
            }

            // 3. 保存到本地数据库
            if (decryptedMessages.length > 0) {
                await this.persistence.saveMessages(decryptedMessages);
                console.log(`[MessageSync] Saved ${decryptedMessages.length} messages to local storage`);
            }

            // 4. 批量标记为已送达
            const messageIds = decryptedMessages.map(m => m.id);
            if (messageIds.length > 0) {
                try {
                    await this.apiService.batchUpdateStatus(messageIds, 'delivered');
                } catch (error) {
                    console.warn('[MessageSync] Failed to update delivery status:', error);
                }
            }

            // 5. 更新同步时间戳
            const latestTimestamp = Math.max(...serverMessages.map(m => m.timestamp));
            this.updateLastSyncTime(latestTimestamp);

            this.isSyncing = false;
            return {
                success: true,
                newMessages: decryptedMessages.length
            };

        } catch (error) {
            console.error('[MessageSync] Sync failed:', error);
            this.isSyncing = false;
            return {
                success: false,
                newMessages: 0,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * 重新发送待发送的消息（基于订单）
     */
    async retrySendingPendingMessages(orderId?: string): Promise<{
        success: boolean;
        sentCount: number;
    }> {
        try {
            const pendingMessages = await this.persistence.getPendingOrderMessages(orderId);

            if (pendingMessages.length === 0) {
                return { success: true, sentCount: 0 };
            }

            console.log(`[MessageSync] Retrying ${pendingMessages.length} pending messages${orderId ? ` for order ${orderId}` : ''}`);

            let sentCount = 0;

            for (const message of pendingMessages) {
                try {
                    // 准备服务器消息格式
                    const serverMessage: PersistedP2PMessage = {
                        id: message.id,
                        senderId: message.senderId,
                        recipientId: message.recipientId,
                        orderId: message.orderId,
                        encryptedContent: JSON.stringify(message.encryptedContent),
                        messageType: message.type,
                        timestamp: message.timestamp,
                        sequence: message.sequence,
                        status: 'sent' as const,
                        sendAttempts: message.sendAttempts,
                        maxRetries: message.maxRetries,
                        metadata: message.metadata
                    };

                    // 发送到服务器
                    await this.apiService.sendMessage(serverMessage);

                    // 更新本地状态
                    await this.persistence.updateMessageStatus(message.id, 'sent');

                    sentCount++;

                } catch (error) {
                    console.error(`[MessageSync] Failed to retry message ${message.id}:`, error);

                    // 更新重试状态
                    await this.persistence.updateMessageRetryStatus(message.id, {
                        status: 'retrying' as const,
                        sendAttempts: (message.sendAttempts || 0) + 1,
                        lastAttemptTime: Date.now(),
                        nextRetryTime: Date.now() + (message.retryDelay || 1000),
                        lastError: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            console.log(`[MessageSync] Successfully sent ${sentCount}/${pendingMessages.length} pending messages`);

            return { success: true, sentCount };

        } catch (error) {
            console.error('[MessageSync] Retry pending messages failed:', error);
            return { success: false, sentCount: 0 };
        }
    }

    /**
     * 重试发送失败的消息（可选只重试某个订单的消息）
     */
    async retryFailedMessages(orderId?: string): Promise<{
        success: boolean;
        retriedCount: number;
    }> {
        try {
            // 获取需要重试的消息
            const messagesForRetry = await this.persistence.getMessagesForRetry();

            // 按订单过滤
            const filteredMessages = orderId
                ? messagesForRetry.filter(msg => msg.orderId === orderId)
                : messagesForRetry;

            if (filteredMessages.length === 0) {
                return { success: true, retriedCount: 0 };
            }

            console.log(`[MessageSync] Retrying ${filteredMessages.length} failed messages${orderId ? ` for order ${orderId}` : ''}`);

            let retriedCount = 0;

            for (const message of filteredMessages) {
                try {
                    // 准备服务器消息格式
                    const serverMessage: PersistedP2PMessage = {
                        id: message.id,
                        senderId: message.senderId,
                        recipientId: message.recipientId,
                        orderId: message.orderId,
                        encryptedContent: JSON.stringify(message.encryptedContent),
                        messageType: message.type,
                        timestamp: message.timestamp,
                        sequence: message.sequence,
                        status: 'sent' as const,
                        sendAttempts: message.sendAttempts,
                        maxRetries: message.maxRetries,
                        metadata: message.metadata
                    };

                    // 发送到服务器
                    await this.apiService.sendMessage(serverMessage);

                    // 更新本地状态为sent
                    await this.persistence.updateMessageStatus(message.id, 'sent');

                    retriedCount++;

                } catch (error) {
                    console.error(`[MessageSync] Failed to retry message ${message.id}:`, error);

                    // 更新重试状态
                    const updatedSendAttempts = (message.sendAttempts || 0) + 1;
                    await this.persistence.updateMessageRetryStatus(message.id, {
                        status: updatedSendAttempts >= (message.maxRetries || 3) ? 'failed' as const : 'retrying' as const,
                        sendAttempts: updatedSendAttempts,
                        lastAttemptTime: Date.now(),
                        nextRetryTime: Date.now() + (message.retryDelay || 1000) * Math.pow(2, updatedSendAttempts - 1), // 指数退避
                        lastError: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            console.log(`[MessageSync] Successfully retried ${retriedCount}/${filteredMessages.length} failed messages`);

            return { success: true, retriedCount };

        } catch (error) {
            console.error('[MessageSync] Retry failed messages failed:', error);
            return { success: false, retriedCount: 0 };
        }
    }

    /**
     * 标记订单消息为已读
     */
    async markOrderMessagesAsRead(orderId: string): Promise<void> {
        try {
            // 更新本地
            await this.persistence.markOrderMessagesAsRead(orderId);

            // 通知服务器（需要服务器支持按订单标记已读）
            const orderMessages = await this.persistence.getOrderMessages(orderId, 1000);
            const unreadMessageIds = orderMessages
                .filter(msg => msg.recipientId === this.userId && msg.status === 'delivered')
                .map(msg => msg.id);

            if (unreadMessageIds.length > 0) {
                await this.apiService.batchUpdateStatus(unreadMessageIds, 'read');
            }

            console.log(`[MessageSync] Marked order ${orderId} messages as read`);

        } catch (error) {
            console.error('[MessageSync] Mark order as read failed:', error);
            throw error;
        }
    }

    /**
     * 标记特定消息为已读
     */
    async markMessagesAsRead(messageIds: string[]): Promise<void> {
        try {
            // 更新本地
            for (const messageId of messageIds) {
                await this.persistence.updateMessageStatus(messageId, 'read');
            }

            // 通知服务器
            await this.apiService.batchUpdateStatus(messageIds, 'read');

            console.log(`[MessageSync] Marked ${messageIds.length} messages as read`);

        } catch (error) {
            console.error('[MessageSync] Mark as read failed:', error);
            throw error;
        }
    }

    /**
     * 获取订单会话列表
     */
    async getOrderSessions(): Promise<OrderSessionInfo[]> {
        return await this.persistence.getOrderSessions();
    }

    /**
     * 获取特定订单的会话信息
     */
    async getOrderSession(orderId: string): Promise<OrderSessionInfo | null> {
        return await this.persistence.getOrderSession(orderId);
    }

    /**
     * 获取订单的未读消息数量
     */
    async getOrderUnreadCount(orderId: string): Promise<number> {
        return await this.persistence.getOrderUnreadCount(orderId);
    }

    /**
     * 获取订单消息历史
     */
    async getOrderMessages(orderId: string, limit?: number, beforeTimestamp?: number): Promise<P2PMessage[]> {
        return await this.persistence.getOrderMessages(orderId, limit, beforeTimestamp);
    }

    /**
     * 获取待发送消息
     */
    async getPendingOrderMessages(orderId?: string): Promise<P2PMessage[]> {
        return await this.persistence.getPendingOrderMessages(orderId);
    }

    /**
     * 获取需要重试的消息
     */
    async getMessagesForRetry(): Promise<P2PMessage[]> {
        return await this.persistence.getMessagesForRetry();
    }

    /**
     * 更新消息状态
     */
    async updateMessageStatus(messageId: string, status: P2PMessage['status']): Promise<void> {
        await this.persistence.updateMessageStatus(messageId, status);
    }

    /**
     * 更新消息重试状态
     */
    async updateMessageRetryStatus(
        messageId: string,
        updates: {
            status?: P2PMessage['status'];
            sendAttempts?: number;
            lastAttemptTime?: number;
            nextRetryTime?: number;
            lastError?: string;
        }
    ): Promise<void> {
        await this.persistence.updateMessageRetryStatus(messageId, updates);
    }

    /**
     * 获取最后同步时间
     */
    private loadLastSyncTime(): void {
        const stored = localStorage.getItem(`lastSyncTimestamp_${this.userId}`);
        this.lastSyncTimestamp = stored ? parseInt(stored, 10) : 0;
    }

    /**
     * 更新最后同步时间
     */
    private updateLastSyncTime(timestamp: number): void {
        this.lastSyncTimestamp = timestamp;
        localStorage.setItem(`lastSyncTimestamp_${this.userId}`, timestamp.toString());
        console.log(`[MessageSync] Updated last sync time to: ${timestamp}`);
    }
    /**
     * 生成本地序列号（用于离线消息）
     */
    private async generateLocalSequence(orderId: string): Promise<number> {
        try {
            // 获取订单的本地最新消息来确定下一个序列号
            const latestMessages = await this.persistence.getOrderMessages(orderId, 1);
            if (latestMessages.length === 0) {
                return 1; // 第一条消息
            }

            const latestSequence = Math.max(...latestMessages.map(msg => msg.sequence || 0));
            return latestSequence + 1;

        } catch (error) {
            console.error(`[MessageSync] Generate local sequence for order ${orderId} error:`, error);
            return Date.now(); // 降级方案：使用时间戳
        }
    }


    /**
     * 清理
     */
    cleanup(): void {
        this.isSyncing = false;
    }
}