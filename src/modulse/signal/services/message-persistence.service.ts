// services/message-persistence.service.ts

import { openDB, type IDBPDatabase } from 'idb';
import type { P2PMessage, OrderSessionInfo } from '../types/message.types';

const DB_NAME = 'p2p-messages-db';
const DB_VERSION = 4; // 升级到4，支持本地多账号共用同一浏览器时的复合主键
const STORE_NAME = 'messages';
const ORDER_SESSIONS_STORE = 'order_sessions';

/**
 * 基于订单的消息持久化服务 - 精简版本
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
                    if (oldVersion < 4) {
                        // 删除旧的消息存储（如果存在）
                        if (db.objectStoreNames.contains(STORE_NAME)) {
                            db.deleteObjectStore(STORE_NAME);
                        }

                        // 创建新的消息存储，使用复合主键 ['userId', 'id'] 避免同浏览器切换账号导致互相覆盖
                        const messageStore = db.createObjectStore(STORE_NAME, { keyPath: ['userId', 'id'] });

                        // 核心索引
                        messageStore.createIndex('by-order-sequence', ['orderId', 'sequence']); 
                        messageStore.createIndex('by-order-status', ['orderId', 'status']);     
                        messageStore.createIndex('by-retry-time', 'nextRetryTime');            
                        messageStore.createIndex('by-user-order', ['userId', 'orderId', 'timestamp']); 

                        // 创建订单会话存储，同样使用复合主键
                        if (db.objectStoreNames.contains(ORDER_SESSIONS_STORE)) {
                            db.deleteObjectStore(ORDER_SESSIONS_STORE);
                        }
                        const sessionStore = db.createObjectStore(ORDER_SESSIONS_STORE, { keyPath: ['userId', 'orderId'] });
                        sessionStore.createIndex('by-user', 'userId');
                        sessionStore.createIndex('by-last-message', ['userId', 'lastMessageTime']);
                    }
                },
            });

            console.log(`[MessagePersistence] Database v${DB_VERSION} initialized for user: ${this.userId}`);

            // v4 升级后复合主键天然隔离，不需要rescue了
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
            userId: this.userId,
            // 确保默认值
            sequence: message.sequence || await this.generateSequence(message.orderId),
            sendAttempts: message.sendAttempts || 0,
            maxRetries: message.maxRetries || 3, // 默认3次重试
            retryDelay: message.retryDelay || 1000, // 默认1秒基础延迟
            deliveryConfirmed: message.deliveryConfirmed || false,
            readConfirmed: message.readConfirmed || false,
            metadata: {
                firstSendTime: message.metadata?.firstSendTime || Date.now(),
                errorCount: message.metadata?.errorCount || 0,
                ...message.metadata
            }
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
                messages.map(msg => {
                    const messageWithUser = {
                        ...msg,
                        userId: this.userId,
                        sendAttempts: msg.sendAttempts || 0,
                        maxRetries: msg.maxRetries || 3,
                        retryDelay: msg.retryDelay || 1000,
                        deliveryConfirmed: msg.deliveryConfirmed || false,
                        readConfirmed: msg.readConfirmed || false,
                        metadata: {
                            firstSendTime: msg.metadata?.firstSendTime || Date.now(),
                            errorCount: msg.metadata?.errorCount || 0,
                            ...msg.metadata
                        }
                    };
                    return tx.store.put(messageWithUser);
                })
            );
            await tx.done;

            // 批量更新订单会话
            for (const message of messages) {
                await this.updateOrderSession(message);
            }

            console.log(`[MessagePersistence] Saved ${messages.length} messages`);
        } catch (error) {
            console.error('[MessagePersistence] Batch save error:', error);
            throw error;
        }
    }

    /**
     * 获取订单的聊天消息 - 按序列号排序
     */
    async getOrderMessages(orderId: string, limit: number = 50, beforeSequence?: number): Promise<P2PMessage[]> {
        await this.ensureDb();

        try {
            const index = this.db!.transaction(STORE_NAME).store.index('by-order-sequence');

            let cursor;
            if (beforeSequence) {
                // 分页查询：获取指定序列号之前的消息
                cursor = await index.openCursor(IDBKeyRange.upperBound([orderId, beforeSequence]));
            } else {
                // 普通查询：按序列号降序获取最新消息
                cursor = await index.openCursor(IDBKeyRange.bound([orderId, 0], [orderId, Infinity]), 'prev');
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

            // 按序列号升序排序（最旧的在前面）
            messages.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

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

            // 计算重传统计
            for (const session of sessions) {
                const stats = await this.calculateOrderStats(session.orderId);
                session.pendingMessages = stats.pending;
                session.failedMessages = stats.failed;
                session.retryQueueSize = stats.retrying;
            }

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
            const session = await this.db!.get(ORDER_SESSIONS_STORE, [this.userId, orderId]);
            if (session) {
                const stats = await this.calculateOrderStats(orderId);
                session.pendingMessages = stats.pending;
                session.failedMessages = stats.failed;
                session.retryQueueSize = stats.retrying;
                return session;
            }
            return null;
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

            const stats = await this.calculateOrderStats(message.orderId);

            const session: OrderSessionInfo = {
                orderId: message.orderId,
                userId: this.userId,
                otherUserId: otherUserId,
                lastMessageTime: message.timestamp,
                unreadCount: existingSession ?
                    (isUnread ? existingSession.unreadCount + 1 : existingSession.unreadCount) :
                    (isUnread ? 1 : 0),
                messageCount: existingSession ? existingSession.messageCount + 1 : 1,
                pendingMessages: stats.pending,
                failedMessages: stats.failed,
                retryQueueSize: stats.retrying
            };

            await this.db!.put(ORDER_SESSIONS_STORE, session);

        } catch (error) {
            console.error('[MessagePersistence] Update order session error:', error);
        }
    }

    /**
     * 计算订单的统计信息
     */
    private async calculateOrderStats(orderId: string): Promise<{
        pending: number;
        failed: number;
        retrying: number;
    }> {
        try {
            // 使用 by-order-status 索引统计各种状态的消息
            const index = this.db!.transaction(STORE_NAME).store.index('by-order-status');

            const pendingMessages = await index.getAll([orderId, 'pending']);
            const pending = pendingMessages.filter(msg =>
                msg.userId === this.userId && msg.senderId === this.userId
            ).length;

            const failedMessages = await index.getAll([orderId, 'failed']);
            const failed = failedMessages.filter(msg =>
                msg.userId === this.userId && msg.senderId === this.userId
            ).length;

            const retryingMessages = await index.getAll([orderId, 'retrying']);
            const retrying = retryingMessages.filter(msg =>
                msg.userId === this.userId && msg.senderId === this.userId
            ).length;

            return { pending, failed, retrying };

        } catch (error) {
            console.error('[MessagePersistence] Calculate order stats error:', error);
            return { pending: 0, failed: 0, retrying: 0 };
        }
    }

    /**
     * 获取需要重试的消息
     */
    async getMessagesForRetry(): Promise<P2PMessage[]> {
        await this.ensureDb();

        try {
            const now = Date.now();
            const index = this.db!.transaction(STORE_NAME).store.index('by-retry-time');

            const messages: P2PMessage[] = [];
            let cursor = await index.openCursor(IDBKeyRange.upperBound(now));

            while (cursor) {
                if (cursor.value.userId === this.userId &&
                    cursor.value.senderId === this.userId &&
                    cursor.value.status === 'retrying' &&
                    cursor.value.sendAttempts < cursor.value.maxRetries) {
                    messages.push(cursor.value);
                }
                cursor = await cursor.continue();
            }

            console.log(`[MessagePersistence] Found ${messages.length} messages ready for retry`);
            return messages;

        } catch (error) {
            console.error('[MessagePersistence] Get messages for retry error:', error);
            return [];
        }
    }

    /**
     * 获取待发送消息
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
                const index = this.db!.transaction(STORE_NAME).store.index('by-order-status');
                // 获取所有订单的pending消息，然后过滤
                const allPending = await index.getAll('pending');
                messages = allPending.filter(msg => msg.userId === this.userId);
            }

            return messages.filter(msg =>
                msg.senderId === this.userId
            );

        } catch (error) {
            console.error('[MessagePersistence] Get pending order messages error:', error);
            return [];
        }
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
        await this.ensureDb();

        try {
            const message = await this.db!.get(STORE_NAME, [this.userId, messageId]);
            if (message) {
                const updatedMessage: P2PMessage = {
                    ...message,
                    ...updates,
                    metadata: {
                        ...message.metadata,
                        lastError: updates.lastError,
                        errorCount: updates.sendAttempts || message.sendAttempts,
                        finalSendTime: updates.status === 'sent' ? Date.now() : message.metadata?.finalSendTime
                    }
                };

                await this.db!.put(STORE_NAME, updatedMessage);

                // 更新订单会话统计
                await this.updateOrderSession(updatedMessage);

                console.log(`[MessagePersistence] Updated retry status for ${messageId}`);
            }
        } catch (error) {
            console.error('[MessagePersistence] Update retry status error:', error);
            throw error;
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
                    cursor.value.readConfirmed = true;
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
            const message = await this.db!.get(STORE_NAME, [this.userId, messageId]);
            if (message) {
                const updates: Partial<P2PMessage> = {
                    status,
                    deliveryConfirmed: status === 'delivered' ? true : message.deliveryConfirmed,
                    readConfirmed: status === 'read' ? true : message.readConfirmed
                };

                if (status === 'sent') {
                    updates.metadata = {
                        ...message.metadata,
                        finalSendTime: Date.now()
                    };
                }

                await this.updateMessageRetryStatus(messageId, updates);
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
            const index = this.db!.transaction(STORE_NAME, 'readwrite').store.index('by-order-sequence');
            let cursor = await index.openCursor(IDBKeyRange.only([orderId]));

            while (cursor) {
                if (cursor.value.userId === this.userId) {
                    await cursor.delete();
                }
                cursor = await cursor.continue();
            }

            // 删除订单会话
            await this.db!.delete(ORDER_SESSIONS_STORE, [this.userId, orderId]);

            console.log(`[MessagePersistence] Deleted all messages for order: ${orderId}`);
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
                        await tx.store.delete([this.userId, message.id]);
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

    async generateSequence(orderId: string): Promise<number> {
        try {
            // 获取订单的最新消息来确定下一个序列号
            const latestMessages = await this.getOrderMessages(orderId, 1);
            if (latestMessages.length === 0) {
                return 1; // 第一条消息
            }

            const latestSequence = Math.max(...latestMessages.map(msg => msg.sequence || 0));
            return latestSequence + 1;

        } catch (error) {
            console.error('[MessagePersistence] Generate sequence error:', error);
            return Date.now(); // 降级方案：使用时间戳
        }
    }
}


// Singleton factory
const persistenceInstances = new Map<string, MessagePersistenceService>();

export function getMessagePersistenceService(userId: string): MessagePersistenceService {
    if (!persistenceInstances.has(userId)) {
        persistenceInstances.set(userId, new MessagePersistenceService(userId));
    }
    return persistenceInstances.get(userId)!;
}