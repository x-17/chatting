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
                    const plaintext = await e2eeService.decryptMessage(
                        this.userId,
                        serverMsg.senderId,
                        encryptedData
                    );

                    // 构建本地消息对象
                    const message: P2PMessage = {
                        id: serverMsg.id,
                        type: serverMsg.messageType,
                        senderId: serverMsg.senderId,
                        orderId: serverMsg.orderId,
                        recipientId: serverMsg.recipientId,
                        content: plaintext,
                        encryptedContent: encryptedData,
                        timestamp: serverMsg.timestamp,
                        status: 'delivered',
                        serverTimestamp: serverMsg.timestamp,
                        metadata: serverMsg.metadata
                    };

                    decryptedMessages.push(message);

                } catch (error) {
                    console.error(`[MessageSync] Failed to decrypt message ${serverMsg.id}:`, error);
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
                        status: 'sent',
                        metadata: message.metadata
                    };

                    // 发送到服务器
                    await this.apiService.sendMessage(serverMessage);

                    // 更新本地状态
                    await this.persistence.updateMessageStatus(message.id, 'sent');

                    sentCount++;

                } catch (error) {
                    console.error(`[MessageSync] Failed to retry message ${message.id}:`, error);
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
     * 标记订单消息为已读
     */
    async markOrderMessagesAsRead(orderId: string): Promise<void> {
        try {
            // 更新本地
            await this.persistence.markOrderMessagesAsRead(orderId);

            // 通知服务器（需要服务器支持按订单标记已读）
            // 这里可以优化：先获取订单的未读消息ID，然后批量更新
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
     * 清理
     */
    cleanup(): void {
        this.isSyncing = false;
    }
}