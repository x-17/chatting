// services/group-message-sync.service.ts

import { groupApiService } from './group-api.service';
import { GroupMessagePersistenceService } from './group-message-persistence.service';
import { groupE2eeService } from './group-e2ee-service';
import type { GroupMessage } from '../types/group-message.types';

/**
 * 群组消息同步服务
 */
export class GroupMessageSyncService {
    private userId: string;
    private apiService = groupApiService;
    private persistence: GroupMessagePersistenceService;
    private syncTimestamps = new Map<string, number>(); // groupId -> lastSyncTimestamp

    constructor(userId: string) {
        this.userId = userId;
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
            let lastSync = this.syncTimestamps.get(orderId) || 0;
            console.log(`[GroupSync] Initial lastSync for ${orderId}: ${lastSync}`);

            // If no sync timestamp in localStorage, check local DB for latest message
            if (lastSync === 0) {
                const lastMsg = await this.persistence.getLastMessage(orderId);
                if (lastMsg) {
                    lastSync = lastMsg.timestamp;
                    console.log(`[GroupSync] Found local history, updated lastSync to ${lastSync} (from msg ${lastMsg.id})`);
                } else {
                    console.log(`[GroupSync] No local history found for ${orderId}, lastSync remains 0`);
                }
            }

            // 1. 从服务器拉取最新消息 (作为离线消息的替代方案)
            // Backend offline endpoint is disabled, so we fetch latest history and filter locally
            const rawMessages = await this.apiService.getLatestGroupMessages(orderId, 100);
            console.log(`[GroupSync] Fetched ${rawMessages.length} latest messages from server`);

            if (rawMessages.length > 0) {
                // Log time range for debugging
                console.log(`[GroupSync] Message timestamps: newest=${rawMessages[0].timestamp}, oldest=${rawMessages[rawMessages.length - 1].timestamp}`);
            }

            // 过滤出比上次同步时间新的消息
            const serverMessages = rawMessages.filter(m => m.timestamp > lastSync);
            console.log(`[GroupSync] Filtered ${serverMessages.length} new messages (timestamp > ${lastSync})`);

            if (serverMessages.length === 0) {
                console.log(`[GroupSync] No new offline messages for group: ${orderId}`);
                return { success: true, newMessages: 0 };
            }

            console.log(`[GroupSync] Retrieved ${serverMessages.length} offline messages for group ${orderId}`);

            // 2. 解密消息
            const decryptedMessages: GroupMessage[] = [];

            for (const serverMsg of serverMessages) {
                let plaintext = '';
                let status: 'delivered' | 'failed' = 'delivered';
                let encryptedData: any = null;

                try {
                    // 解析加密内容
                    encryptedData = JSON.parse(serverMsg.encryptedContent);

                    // 解密群组消息
                    const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                        this.userId,
                        encryptedData
                    );

                    plaintext = new TextDecoder().decode(plaintextBytes);

                } catch (error) {
                    console.error(`[GroupSync] Failed to decrypt message ${serverMsg.id}:`, error);
                    // Decryption failed (likely missing key), but we save it anyway to retry later
                    plaintext = '[Message pending decryption]';
                    status = 'failed';
                }

                // 构建本地消息对象
                const message: GroupMessage = {
                    id: serverMsg.id,
                    type: serverMsg.messageType,
                    orderId: serverMsg.orderId,
                    senderId: serverMsg.senderId,
                    content: plaintext,
                    encryptedContent: encryptedData, // Save original encrypted data for retry
                    timestamp: serverMsg.timestamp,
                    status: status,
                    serverTimestamp: serverMsg.timestamp,
                    metadata: serverMsg.metadata
                };

                decryptedMessages.push(message);
            }

            // 3. 保存到本地数据库
            if (decryptedMessages.length > 0) {
                for (const msg of decryptedMessages) {
                    await this.persistence.saveMessage(msg);
                }
                console.log(`[GroupSync] Saved ${decryptedMessages.length} messages (including failed ones) to local storage`);
            }

            // 4. 更新同步时间戳 (Always update, as we have "processed" them by saving)
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
     * 尝试重新解密指定群组中之前解密失败的消息
     * 通常在接收到新的密钥分发后调用
     */
    async retryDecryptingMessages(orderId: string): Promise<number> {
        console.log(`[GroupSync] Retrying decryption for group ${orderId}...`);
        try {
            // 获取最近的消息 (假设离线消息主要集中在最近)
            // 理想情况下应该有一个专门的索引查询 status='failed' 的消息，但这里我们先扫描最近的 100 条
            const recentMessages = await this.persistence.getGroupMessages(orderId, 100);

            // 筛选出解密失败的消息
            const failedMessages = recentMessages.filter(m =>
                m.status === 'failed' || m.content === '[Message pending decryption]'
            );

            if (failedMessages.length === 0) {
                console.log(`[GroupSync] No failed messages found to retry in recent history.`);
                return 0;
            }

            console.log(`[GroupSync] Found ${failedMessages.length} failed messages to retry.`);
            let recoveredCount = 0;

            for (const msg of failedMessages) {
                if (!msg.encryptedContent) {
                    continue;
                }

                try {
                    // 再次尝试解密
                    const plaintextBytes = await groupE2eeService.decryptGroupMessage(
                        this.userId,
                        msg.encryptedContent
                    );

                    const plaintext = new TextDecoder().decode(plaintextBytes);

                    // 更新消息
                    msg.content = plaintext;
                    msg.status = 'delivered';

                    // 保存更新
                    await this.persistence.saveMessage(msg);
                    recoveredCount++;

                } catch (e) {
                    // Still failed, maybe key is still missing
                    // console.debug(`[GroupSync] Retry failed for msg ${msg.id}:`, e);
                }
            }

            if (recoveredCount > 0) {
                console.log(`[GroupSync] Successfully recovered ${recoveredCount} messages!`);
            }

            return recoveredCount;

        } catch (error) {
            console.error(`[GroupSync] Error retrying decryption:`, error);
            return 0;
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
        // Disabled until getPendingMessages is implemented in persistence service
        console.warn('[GroupSync] retrySendingPendingMessages is currently disabled.');
        return { success: true, sentCount: 0 };
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
     * 标记群组为已读
     */
    markAsRead(orderId: string): void {
        const timestamp = Date.now();
        localStorage.setItem(`groupReadTime_${this.userId}_${orderId}`, String(timestamp));
        // 同时更新 store
        // (Store update is handled by UI/Composable usually, but good to have helper)
    }

    /**
     * 获取群组未读数 (基于本地数据库)
     */
    async getUnreadCount(orderId: string): Promise<number> {
        const lastReadStr = localStorage.getItem(`groupReadTime_${this.userId}_${orderId}`);
        const lastRead = lastReadStr ? Number(lastReadStr) : 0;
        return await this.persistence.countMessagesAfter(orderId, lastRead);
    }

    /**
     * 重新计算并更新所有群组的未读数
     */
    async updateAllGroupUnreadCounts(orderStore: any): Promise<void> {
        const groupOrders = orderStore.orderList.filter((o: any) => Number(o.orderType) === 1);

        for (const order of groupOrders) {
            const count = await this.getUnreadCount(order.orderId);
            if (count > 0 || (order.metadata?.unreadCount || 0) !== count) {
                console.log(`[GroupSync] Updating unread count for ${order.orderId}: ${count}`);
                orderStore.updateOrderWithMessage(order.orderId, {
                    unreadCount: count
                });
            }
        }
    }

    /**
     * 清理
     */
    cleanup(): void {
        // 清理资源
    }
}