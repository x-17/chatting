// services/group-message-sync.service.ts

import { GroupApiService } from './group-api.service';
import { GroupMessagePersistenceService } from './group-message-persistence.service';
import { groupE2eeService } from './group-e2ee-service';
import type { GroupMessage, PersistedGroupMessage } from '../types/group-message.types';

/**
 * 群组消息同步服务
 */
export class GroupMessageSyncService {
    private userId: string;
    private apiService: GroupApiService;
    private persistence: GroupMessagePersistenceService;
    private syncTimestamps = new Map<string, number>(); // groupId -> lastSyncTimestamp

    constructor(userId: string) {
        this.userId = userId;
        this.apiService = new GroupApiService();
        this.persistence = new GroupMessagePersistenceService(userId);
        this.loadSyncTimestamps();
    }

    /**
     * 初始化
     */
    async init(): Promise<void> {
        await this.persistence.init();
        this.loadSyncTimestamps();
        console.log(`[GroupSync] Initialized for user: ${this.userId}`);
    }

    /**
     * 同步指定群组的离线消息
     */
    async syncGroupOfflineMessages(orderId: string): Promise<{
        success: boolean;
        newMessages: number;
        error?: string;
    }> {
        console.log(`[GroupSync] Syncing offline messages for group: ${orderId}`);

        try {
            const lastSync = this.syncTimestamps.get(orderId) || 0;

            // 1. 从服务器拉取离线消息
            const serverMessages = await this.apiService.getGroupOfflineMessages(orderId, lastSync);

            if (serverMessages.length === 0) {
                console.log(`[GroupSync] No new offline messages for group: ${orderId}`);
                return { success: true, newMessages: 0 };
            }

            console.log(`[GroupSync] Retrieved ${serverMessages.length} offline messages for group ${orderId}`);

            // 2. 解密消息
            const decryptedMessages: GroupMessage[] = [];

            for (const serverMsg of serverMessages) {
                try {
                    // 解析加密内容
                    const encryptedData = JSON.parse(serverMsg.encryptedContent);

                    // 解密群组消息
                    const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                        this.userId,
                        encryptedData
                    );

                    const plaintext = new TextDecoder().decode(plaintextBytes);

                    // 构建本地消息对象
                    const message: GroupMessage = {
                        id: serverMsg.id,
                        type: serverMsg.messageType,
                        orderId: serverMsg.orderId,
                        senderId: serverMsg.senderId,
                        content: plaintext,
                        encryptedContent: encryptedData,
                        timestamp: serverMsg.timestamp,
                        status: 'delivered',
                        serverTimestamp: serverMsg.timestamp,
                        metadata: serverMsg.metadata
                    };

                    decryptedMessages.push(message);

                } catch (error) {
                    console.error(`[GroupSync] Failed to decrypt message ${serverMsg.id}:`, error);
                    // 继续处理其他消息
                }
            }

            // 3. 保存到本地数据库
            if (decryptedMessages.length > 0) {
                await this.persistence.saveMessages(decryptedMessages);
                console.log(`[GroupSync] Saved ${decryptedMessages.length} messages to local storage`);
            }

            // 4. 更新同步时间戳
            const latestTimestamp = Math.max(...serverMessages.map(m => m.timestamp));
            this.updateSyncTimestamp(orderId, latestTimestamp);

            return {
                success: true,
                newMessages: decryptedMessages.length
            };

        } catch (error) {
            console.error(`[GroupSync] Sync failed for group ${orderId}:`, error);
            return {
                success: false,
                newMessages: 0,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * 同步所有群组的离线消息
     */
    async syncAllGroupsOfflineMessages(orderIds: string[]): Promise<{
        success: boolean;
        totalNewMessages: number;
        results: Map<string, number>;
    }> {
        console.log(`[GroupSync] Syncing offline messages for ${orderIds.length} groups`);

        const results = new Map<string, number>();
        let totalNewMessages = 0;

        for (const orderId of orderIds) {
            const result = await this.syncGroupOfflineMessages(orderId);
            if (result.success) {
                results.set(orderId, result.newMessages);
                totalNewMessages += result.newMessages;
            } else {
                results.set(orderId, 0);
            }
        }

        console.log(`[GroupSync] Synced ${totalNewMessages} total messages across ${orderIds.length} groups`);

        return {
            success: true,
            totalNewMessages,
            results
        };
    }

    /**
     * 重新发送待发送的群组消息
     */
    async retrySendingPendingMessages(): Promise<{
        success: boolean;
        sentCount: number;
    }> {
        try {
            const pendingMessages = await this.persistence.getPendingMessages();

            if (pendingMessages.length === 0) {
                return { success: true, sentCount: 0 };
            }

            console.log(`[GroupSync] Retrying ${pendingMessages.length} pending group messages`);

            let sentCount = 0;

            for (const message of pendingMessages) {
                try {
                    // 准备服务器消息格式
                    const serverMessage: PersistedGroupMessage = {
                        id: message.id,
                        orderId: message.orderId,
                        senderId: message.senderId,
                        encryptedContent: JSON.stringify(message.encryptedContent),
                        messageType: message.type,
                        timestamp: message.timestamp,
                        status: 'sent',
                        metadata: message.metadata
                    };

                    // 发送到服务器
                    await this.apiService.sendGroupMessage(serverMessage);

                    // 更新本地状态
                    await this.persistence.updateMessageStatus(message.id, 'sent');

                    sentCount++;

                } catch (error) {
                    console.error(`[GroupSync] Failed to retry message ${message.id}:`, error);
                    // 继续尝试其他消息
                }
            }

            console.log(`[GroupSync] Successfully sent ${sentCount}/${pendingMessages.length} pending messages`);

            return { success: true, sentCount };

        } catch (error) {
            console.error('[GroupSync] Retry pending messages failed:', error);
            return { success: false, sentCount: 0 };
        }
    }

    /**
     * 获取最后同步时间
     */
    private loadSyncTimestamps(): void {
        try {
            const stored = localStorage.getItem(`groupSyncTimestamps_${this.userId}`);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.syncTimestamps = new Map(Object.entries(parsed));
            }
        } catch (error) {
            console.warn('[GroupSync] Failed to load sync timestamps:', error);
        }
    }

    /**
     * 更新最后同步时间
     */
    private updateSyncTimestamp(orderId: string, timestamp: number): void {
        this.syncTimestamps.set(orderId, timestamp);

        // 保存到 localStorage
        const obj = Object.fromEntries(this.syncTimestamps);
        localStorage.setItem(`groupSyncTimestamps_${this.userId}`, JSON.stringify(obj));

        console.log(`[GroupSync] Updated sync timestamp for group ${orderId}: ${timestamp}`);
    }

    /**
     * 清理
     */
    cleanup(): void {
        // 清理资源
    }
}