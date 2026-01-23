// src/e2ee/storage/group-message-persistence.service.ts

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
// 引用你提供的类型文件
import type { GroupMessage, GroupMessageStatus } from '../types/group-message.types';

// 定义 IndexedDB 的结构
interface GroupChatDB extends DBSchema {
    'group_messages': {
        key: string; // 使用 message.id 作为主键
        value: GroupMessage;
        indexes: {
            'by_order_id': string; // 用于查询某个订单(群组)的所有消息
            'by_timestamp': number;
            'by_order_timestamp': [string, number]; // 复合索引：查询特定订单的时间范围 (用于分页)
        };
    };
}

export class GroupMessagePersistenceService {
    private dbName: string;
    private dbVersion = 3; // Bump version to force upgrade check
    private db: IDBPDatabase<GroupChatDB> | null = null;

    constructor(private userId: string) {
        // 数据库名称包含 userId，实现多账号数据隔离
        this.dbName = `group-chat-db-${userId}`;
    }

    /**
     * 初始化数据库
     */
    async init(): Promise<void> {
        if (this.db) return;

        this.db = await openDB<GroupChatDB>(this.dbName, this.dbVersion, {
            upgrade(db, oldVersion, newVersion, tx) {
                // 创建对象仓库
                let store;
                if (!db.objectStoreNames.contains('group_messages')) {
                    store = db.createObjectStore('group_messages', {
                        keyPath: 'id',
                    });
                    // 创建索引
                    store.createIndex('by_order_id', 'orderId');
                    store.createIndex('by_timestamp', 'timestamp');
                } else {
                    store = tx.objectStore('group_messages');
                }

                // 独立检查并创建复合索引
                if (!store.indexNames.contains('by_order_timestamp')) {
                    store.createIndex('by_order_timestamp', ['orderId', 'timestamp']);
                }
            },
        });
    }

    /**
     * 保存一条消息 (新建或更新)
     */
    async saveMessage(message: GroupMessage): Promise<void> {
        if (!this.db) await this.init();
        await this.db!.put('group_messages', message);
    }

    /**
     * 更新消息状态
     */
    async updateMessageStatus(messageId: string, status: GroupMessageStatus): Promise<void> {
        if (!this.db) await this.init();

        const tx = this.db!.transaction('group_messages', 'readwrite');
        const store = tx.objectStore('group_messages');

        const message = await store.get(messageId);
        if (message) {
            message.status = status;
            await store.put(message);
        }
        await tx.done;
    }

    /**
     * 获取群组历史消息 (分页，按时间倒序)
     * @param orderId 订单/群组ID
     * @param limit 每页条数
     * @param beforeTimestamp 获取该时间之前的消息 (用于下拉加载更多)
     */
    async getGroupMessages(
        orderId: string,
        limit: number = 50,
        beforeTimestamp: number = Date.now()
    ): Promise<GroupMessage[]> {
        if (!this.db) await this.init();

        // 查询范围：[orderId, 0] 到 [orderId, beforeTimestamp]
        // upperOpen: true 表示不包含 beforeTimestamp 本身
        const range = IDBKeyRange.bound(
            [orderId, 0],
            [orderId, beforeTimestamp],
            false,
            true
        );

        const messages: GroupMessage[] = [];
        // 使用 prev 方向遍历索引 (从新到旧)
        let cursor = await this.db!.transaction('group_messages')
            .store.index('by_order_timestamp')
            .openCursor(range, 'prev');

        while (cursor && messages.length < limit) {
            messages.push(cursor.value);
            cursor = await cursor.continue();
        }

        // 返回结果通常需要按时间正序排列给 UI 渲染 (旧 -> 新)
        return messages.reverse();
    }

    /**
     * 获取群组最后一条消息 (用于会话列表展示)
     */
    async getLastMessage(orderId: string): Promise<GroupMessage | undefined> {
        if (!this.db) await this.init();

        const range = IDBKeyRange.bound([orderId, 0], [orderId, Date.now()]);
        const cursor = await this.db!.transaction('group_messages')
            .store.index('by_order_timestamp')
            .openCursor(range, 'prev');

        return cursor?.value;
    }

    /**
     * 根据 ID 获取单条消息
     */
    async getMessageById(messageId: string): Promise<GroupMessage | undefined> {
        if (!this.db) await this.init();
        return this.db!.get('group_messages', messageId);
    }

    /**
     * 删除消息
     */
    /**
     * 统计指定时间后的消息数量 (用于计算未读数)
     */
    async countMessagesAfter(orderId: string, timestamp: number): Promise<number> {
        if (!this.db) await this.init();

        try {
            // 构造查询范围：(orderId, timestamp) -> (orderId, Infinity]
            const range = IDBKeyRange.bound(
                [orderId, timestamp],
                [orderId, Date.now() + 31536000000000], // ~1000 years
                true,
                false
            );

            const tx = this.db!.transaction('group_messages', 'readonly');
            // Ensure index exists (should be guaranteed by init upgrade if version bumped)
            if (!tx.store.indexNames.contains('by_order_timestamp')) {
                console.warn('[GroupPersistence] Index by_order_timestamp missing!');
                return 0;
            }
            const index = tx.store.index('by_order_timestamp');
            const count = await index.count(range);

            console.log(`[GroupPersistence] countMessagesAfter: orderId=${orderId}, after=${timestamp}, count=${count}`);
            return count;
        } catch (error) {
            console.error('[GroupPersistence] countMessagesAfter failed:', error);
            return 0;
        }
    }
}

export const groupMessagePersistenceService = new GroupMessagePersistenceService('default');
