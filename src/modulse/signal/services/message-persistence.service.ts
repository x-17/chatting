// services/message-persistence.service.ts

import { openDB, type IDBPDatabase } from 'idb';
import type { P2PMessage, OrderSessionInfo } from '../types/message.types';

const DB_NAME = 'p2p-messages-db';
const DB_VERSION = 2; // 版本升级
const STORE_NAME = 'messages';
const ORDER_SESSIONS_STORE = 'order_sessions';

/**
 * 基于订单的消息持久化服务 - 本地 IndexedDB 存储
 */
export class MessagePersistenceService {
    private db: IDBPDatabase | null = null;
    private userId: string;

    constructor(userId: string) {
        this.userId = userId;
    }

    /**
     * 初始化数据库
     */
    async init(): Promise<void> {
        if (this.db) return;

        try {
            this.db = await openDB(DB_NAME, DB_VERSION, {
                upgrade(db, oldVersion) {
                    // 版本1到版本2的迁移：添加订单支持
                    if (oldVersion < 2) {
                        // 删除旧的消息存储
                        if (db.objectStoreNames.contains(STORE_NAME)) {
                            db.deleteObjectStore(STORE_NAME);
                        }

                        // 创建新的消息存储（基于订单）
                        const messageStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

                        // 创建基于订单的索引
                        messageStore.createIndex('by-order', ['orderId', 'timestamp']);
                        messageStore.createIndex('by-order-status', ['orderId', 'status']);
                        messageStore.createIndex('by-user-order', ['userId', 'orderId', 'timestamp']);
                        messageStore.createIndex('by-sender-order', ['senderId', 'orderId']);
                        messageStore.createIndex('by-recipient-order', ['recipientId', 'orderId']);
                        messageStore.createIndex('by-status', 'status');
                        messageStore.createIndex('by-timestamp', 'timestamp');
                        messageStore.createIndex('by-user', 'userId');

                        // 创建订单会话存储
                        const sessionStore = db.createObjectStore(ORDER_SESSIONS_STORE, { keyPath: 'orderId' });
                        sessionStore.createIndex('by-user', 'userId');
                        sessionStore.createIndex('by-last-message', ['userId', 'lastMessageTime']);
                    }
                },
            });

            console.log(`[MessagePersistence] Order-based database initialized for user: ${this.userId}`);
        } catch (error) {
            console.error('[MessagePersistence] Init error:', error);
            throw error;
        }
    }

    /**
     * 保存消息
     */
    async saveMessage(message: P2PMessage): Promise<void> {
        await this.ensureDb();

        const messageWithUser = {
            ...message,
            userId: this.userId
        };

        try {
            await this.db!.put(STORE_NAME, messageWithUser);

            // 自动更新订单会话
            await this.updateOrderSession(message);

            console.log(`[MessagePersistence] Saved message for order ${message.orderId}: ${message.id}`);
        } catch (error) {
            console.error('[MessagePersistence] Save error:', error);
            throw error;
        }
    }

    /**
     * 批量保存消息
     */
    async saveMessages(messages: P2PMessage[]): Promise<void> {
        await this.ensureDb();

        const tx = this.db!.transaction(STORE_NAME, 'readwrite');

        try {
            await Promise.all(
                messages.map(msg =>
                    tx.store.put({ ...msg, userId: this.userId })
                )
            );
            await tx.done;

            // 批量更新订单会话
            for (const message of messages) {
                await this.updateOrderSession(message);
            }

            console.log(`[MessagePersistence] Saved ${messages.length} messages for orders: ${[...new Set(messages.map(m => m.orderId))].join(', ')}`);
        } catch (error) {
            console.error('[MessagePersistence] Batch save error:', error);
            throw error;
        }
    }

    /**
     * 获取订单的聊天消息
     */
    async getOrderMessages(orderId: string, limit: number = 50, beforeTimestamp?: number): Promise<P2PMessage[]> {
        await this.ensureDb();

        try {
            const index = this.db!.transaction(STORE_NAME).store.index('by-order');

            let cursor;
            if (beforeTimestamp) {
                // 分页查询：获取某个时间点之前的消息
                cursor = await index.openCursor(IDBKeyRange.bound([orderId, 0], [orderId, beforeTimestamp]));
            } else {
                // 普通查询：获取最新的消息
                cursor = await index.openCursor(IDBKeyRange.bound([orderId, 0], [orderId, Date.now()]), 'prev');
            }

            const messages: P2PMessage[] = [];
            let count = 0;

            while (cursor && count < limit) {
                if (cursor.value.userId === this.userId) {
                    messages.push(cursor.value);
                    count++;
                }
                cursor = await cursor.continue();
            }

            // 如果分页查询，需要反转顺序（最新的在前）
            if (!beforeTimestamp) {
                messages.reverse();
            }

            console.log(`[MessagePersistence] Retrieved ${messages.length} messages for order: ${orderId}`);
            return messages;

        } catch (error) {
            console.error('[MessagePersistence] Get order messages error:', error);
            return [];
        }
    }

    /**
     * 获取用户的订单会话列表
     */
    async getOrderSessions(): Promise<OrderSessionInfo[]> {
        await this.ensureDb();

        try {
            const index = this.db!.transaction(ORDER_SESSIONS_STORE).store.index('by-user');
            const sessions = await index.getAll(this.userId);

            return sessions.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

        } catch (error) {
            console.error('[MessagePersistence] Get order sessions error:', error);
            return [];
        }
    }

    /**
     * 获取特定订单的会话信息
     */
    async getOrderSession(orderId: string): Promise<OrderSessionInfo | null> {
        await this.ensureDb();

        try {
            const session = await this.db!.get(ORDER_SESSIONS_STORE, orderId);
            return session && session.userId === this.userId ? session : null;
        } catch (error) {
            console.error('[MessagePersistence] Get order session error:', error);
            return null;
        }
    }

    /**
     * 更新订单会话
     */
    private async updateOrderSession(message: P2PMessage): Promise<void> {
        try {
            const existingSession = await this.getOrderSession(message.orderId);
            const otherUserId = message.senderId === this.userId ? message.recipientId : message.senderId;

            const isIncoming = message.recipientId === this.userId;
            const isUnread = isIncoming && message.status !== 'read';

            const session: OrderSessionInfo = {
                orderId: message.orderId,
                otherUserId: otherUserId,
                lastMessageTime: message.timestamp,
                unreadCount: existingSession ?
                    (isUnread ? existingSession.unreadCount + 1 : existingSession.unreadCount) :
                    (isUnread ? 1 : 0),
                messageCount: existingSession ? existingSession.messageCount + 1 : 1,
                userId: this.userId
            };

            await this.db!.put(ORDER_SESSIONS_STORE, session);

        } catch (error) {
            console.error('[MessagePersistence] Update order session error:', error);
        }
    }

    /**
     * 标记订单消息为已读
     */
    async markOrderMessagesAsRead(orderId: string): Promise<void> {
        await this.ensureDb();

        try {
            // 更新消息状态
            const index = this.db!.transaction(STORE_NAME, 'readwrite').store.index('by-order-status');
            let cursor = await index.openCursor([orderId, 'delivered']);

            while (cursor) {
                if (cursor.value.userId === this.userId && cursor.value.recipientId === this.userId) {
                    cursor.value.status = 'read';
                    await cursor.update(cursor.value);
                }
                cursor = await cursor.continue();
            }

            // 更新订单会话的未读计数
            const session = await this.getOrderSession(orderId);
            if (session) {
                session.unreadCount = 0;
                await this.db!.put(ORDER_SESSIONS_STORE, session);
            }

            console.log(`[MessagePersistence] Marked order ${orderId} messages as read`);

        } catch (error) {
            console.error('[MessagePersistence] Mark order messages as read error:', error);
            throw error;
        }
    }

    /**
     * 获取订单的待发送消息
     */
    async getPendingOrderMessages(orderId?: string): Promise<P2PMessage[]> {
        await this.ensureDb();

        try {
            let messages: P2PMessage[];

            if (orderId) {
                // 获取特定订单的待发送消息
                const index = this.db!.transaction(STORE_NAME).store.index('by-order-status');
                messages = await index.getAll([orderId, 'pending']);
            } else {
                // 获取所有待发送消息
                const index = this.db!.transaction(STORE_NAME).store.index('by-status');
                messages = await index.getAll('pending');
            }

            return messages.filter(msg => msg.senderId === this.userId);

        } catch (error) {
            console.error('[MessagePersistence] Get pending order messages error:', error);
            return [];
        }
    }

    /**
     * 获取订单的未读消息数量
     */
    async getOrderUnreadCount(orderId: string): Promise<number> {
        const session = await this.getOrderSession(orderId);
        return session ? session.unreadCount : 0;
    }

    /**
     * 更新消息状态
     */
    async updateMessageStatus(messageId: string, status: P2PMessage['status']): Promise<void> {
        await this.ensureDb();

        try {
            const message = await this.db!.get(STORE_NAME, messageId);
            if (message && message.userId === this.userId) {
                message.status = status;
                await this.db!.put(STORE_NAME, message);
                console.log(`[MessagePersistence] Updated message ${messageId} status to ${status}`);
            }
        } catch (error) {
            console.error('[MessagePersistence] Update status error:', error);
            throw error;
        }
    }

    /**
     * 删除订单的所有消息
     */
    async deleteOrderMessages(orderId: string): Promise<void> {
        await this.ensureDb();

        try {
            // 删除消息
            const messageIndex = this.db!.transaction(STORE_NAME, 'readwrite').store.index('by-order');
            let cursor = await messageIndex.openCursor(IDBKeyRange.only([orderId]));

            while (cursor) {
                if (cursor.value.userId === this.userId) {
                    await cursor.delete();
                }
                cursor = await cursor.continue();
            }

            // 删除订单会话
            await this.db!.delete(ORDER_SESSIONS_STORE, orderId);

            console.log(`[MessagePersistence] Deleted all messages and session for order: ${orderId}`);
        } catch (error) {
            console.error('[MessagePersistence] Delete order messages error:', error);
            throw error;
        }
    }

    /**
     * 清理旧消息（按订单保留最近的 N 条）
     */
    async cleanOldOrderMessages(keepPerOrder: number = 100): Promise<void> {
        await this.ensureDb();

        try {
            const orders = await this.getOrderSessions();

            for (const order of orders) {
                const allMessages = await this.getOrderMessages(order.orderId, 1000);

                if (allMessages.length > keepPerOrder) {
                    const toDelete = allMessages.slice(keepPerOrder);
                    const tx = this.db!.transaction(STORE_NAME, 'readwrite');

                    for (const message of toDelete) {
                        await tx.store.delete(message.id);
                    }
                    await tx.done;

                    console.log(`[MessagePersistence] Cleaned ${toDelete.length} old messages from order ${order.orderId}`);
                }
            }
        } catch (error) {
            console.error('[MessagePersistence] Clean old order messages error:', error);
        }
    }

    /**
     * 确保数据库已初始化
     */
    private async ensureDb(): Promise<void> {
        if (!this.db) {
            await this.init();
        }
    }
}