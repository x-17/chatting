// services/group-message-persistence.service.ts

import { openDB, type IDBPDatabase } from 'idb';
import type { GroupMessage } from '../types/group-message.types';

const DB_NAME = 'group-messages-db';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

/**
 * 群组消息持久化服务 - 本地 IndexedDB 存储
 */
export class GroupMessagePersistenceService {
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
                upgrade(db) {
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

                        // 创建索引
                        store.createIndex('by-order', ['orderId', 'timestamp']);
                        store.createIndex('by-status', 'status');
                        store.createIndex('by-timestamp', 'timestamp');
                        store.createIndex('by-user', 'userId'); // 用于多用户场景
                    }
                },
            });

            console.log(`[GroupPersistence] Database initialized for user: ${this.userId}`);
        } catch (error) {
            console.error('[GroupPersistence] Init error:', error);
            throw error;
        }
    }

    /**
     * 保存消息
     */
    async saveMessage(message: GroupMessage): Promise<void> {
        await this.ensureDb();

        const messageWithUser = {
            ...message,
            userId: this.userId
        };

        try {
            await this.db!.put(STORE_NAME, messageWithUser);
            console.log(`[GroupPersistence] Saved message: ${message.id}`);
        } catch (error) {
            console.error('[GroupPersistence] Save error:', error);
            throw error;
        }
    }

    /**
     * 批量保存消息
     */
    async saveMessages(messages: GroupMessage[]): Promise<void> {
        await this.ensureDb();

        const tx = this.db!.transaction(STORE_NAME, 'readwrite');

        try {
            await Promise.all(
                messages.map(msg =>
                    tx.store.put({ ...msg, userId: this.userId })
                )
            );
            await tx.done;
            console.log(`[GroupPersistence] Saved ${messages.length} messages`);
        } catch (error) {
            console.error('[GroupPersistence] Batch save error:', error);
            throw error;
        }
    }

    /**
     * 获取群组消息
     */
    async getGroupMessages(orderId: string, limit: number = 50): Promise<GroupMessage[]> {
        await this.ensureDb();

        try {
            const index = this.db!.transaction(STORE_NAME).store.index('by-order');

            // 获取指定群组的消息
            const messages = await index.getAll([orderId]);

            // 过滤当前用户的消息并排序
            return messages
                .filter(msg => msg.userId === this.userId)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);

        } catch (error) {
            console.error('[GroupPersistence] Get group messages error:', error);
            return [];
        }
    }

    /**
     * 获取待发送的消息（状态为 pending）
     */
    async getPendingMessages(): Promise<GroupMessage[]> {
        await this.ensureDb();

        try {
            const index = this.db!.transaction(STORE_NAME).store.index('by-status');
            const messages = await index.getAll('pending');

            return messages.filter(msg => msg.userId === this.userId);

        } catch (error) {
            console.error('[GroupPersistence] Get pending error:', error);
            return [];
        }
    }

    /**
     * 更新消息状态
     */
    async updateMessageStatus(messageId: string, status: GroupMessage['status']): Promise<void> {
        await this.ensureDb();

        try {
            const message = await this.db!.get(STORE_NAME, messageId);
            if (message && message.userId === this.userId) {
                message.status = status;
                await this.db!.put(STORE_NAME, message);
                console.log(`[GroupPersistence] Updated message ${messageId} status to ${status}`);
            }
        } catch (error) {
            console.error('[GroupPersistence] Update status error:', error);
            throw error;
        }
    }

    /**
     * 删除消息
     */
    async deleteMessage(messageId: string): Promise<void> {
        await this.ensureDb();

        try {
            await this.db!.delete(STORE_NAME, messageId);
            console.log(`[GroupPersistence] Deleted message: ${messageId}`);
        } catch (error) {
            console.error('[GroupPersistence] Delete error:', error);
            throw error;
        }
    }

    /**
     * 清理旧消息
     */
    async cleanOldMessages(orderId: string, keepCount: number = 500): Promise<void> {
        await this.ensureDb();

        try {
            const messages = await this.getGroupMessages(orderId, keepCount + 100);

            // 删除超出保留数量的消息
            const toDelete = messages.slice(keepCount);
            const tx = this.db!.transaction(STORE_NAME, 'readwrite');

            await Promise.all(
                toDelete.map(msg => tx.store.delete(msg.id))
            );

            await tx.done;
            console.log(`[GroupPersistence] Cleaned ${toDelete.length} old messages from group ${orderId}`);

        } catch (error) {
            console.error('[GroupPersistence] Clean error:', error);
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