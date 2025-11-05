// src/e2ee/services/group-e2ee-service.ts

import { groupStateStore } from '../store/group-state-store';
import { SenderKeySession } from '../protocol/sender-key-session';
import type { ISenderKeyMessage, ISenderKeyDistributionMessage } from '../protocol/types';
import { groupStore } from '../store/group-store';

// 并发锁实现（保持不变）
const operationLocks = new Map<string, Promise<void>>();

async function withLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    while (operationLocks.has(lockKey)) {
        await operationLocks.get(lockKey);
    }

    let resolveLock: () => void;
    const lock = new Promise<void>(resolve => {
        resolveLock = resolve;
    });
    operationLocks.set(lockKey, lock);

    try {
        return await operation();
    } finally {
        operationLocks.delete(lockKey);
        resolveLock!();
    }
}

export const groupE2eeService = {
    /**
     * 为自己创建一个新的群组会话，并生成用于分发的密钥消息。
     * 添加了群组成员身份检查
     */
    async createGroupSession(
        myUserId: string,
        orderId: string
    ): Promise<ISenderKeyDistributionMessage> {
        // 检查用户是否是群组成员
        const isMember = await groupStore.isMember(orderId, myUserId);
        if (!isMember) {
            throw new Error(`创建会话失败：您不是群组 "${orderId}" 的成员。`);
        }

        // 创建新会话
        const session = SenderKeySession.createSession(myUserId, orderId);

        // 异步操作：将新创建的会话状态存入数据库
        await groupStateStore.set(myUserId, orderId, myUserId, session.getState());

        // 同步操作：从会话中获取分发消息的核心部分
        const distributionCore = session.getDistributionMessage();

        // 将上下文信息（groupId, senderId）添加到核心消息中，形成完整的消息
        return {
            ...distributionCore,
            orderId: orderId,
            senderId: myUserId,
        };
    },

    /**
     * 处理从其他群组成员收到的密钥分发消息，并建立会话。
     * 添加了群组成员身份检查
     */
    async processGroupKeyDistribution(
        myUserId: string,
        senderId: string,
        distMessage: ISenderKeyDistributionMessage
    ): Promise<void> {
        // 检查发送者是否是群组成员
        const isSenderMember = await groupStore.isMember(distMessage.orderId, senderId);
        if (!isSenderMember) {
            throw new Error(`处理密钥分发失败：发送者 "${senderId}" 不是群组 "${distMessage.orderId}" 的成员。`);
        }

        // 检查自己是否是群组成员
        const isMember = await groupStore.isMember(distMessage.orderId, myUserId);
        if (!isMember) {
            throw new Error(`处理密钥分发失败：您不是群组 "${distMessage.orderId}" 的成员。`);
        }

        // 创建会话
        const session = SenderKeySession.createFromDistribution(distMessage);

        // 异步操作：将为他人创建的会话状态存入数据库
        await groupStateStore.set(myUserId, distMessage.orderId, senderId, session.getState());
    },

    /**
     * 加密一条群组消息。
     * 添加了密钥有效性检查
     */
    async encryptGroupMessage(
        myUserId: string,
        orderId: string,
        plaintext: Uint8Array
    ): Promise<ISenderKeyMessage> {
        // 检查发送者是否仍然是群组成员
        const isMember = await groupStore.isMember(orderId, myUserId);
        if (!isMember) {
            throw new Error(`加密失败：您已不再是群组 "${orderId}" 的成员。`);
        }

        // 使用锁确保对同一会话的并发操作是串行的
        const lockKey = `encrypt-${myUserId}-${orderId}-${myUserId}`;

        return withLock(lockKey, async () => {
            // 异步操作：从数据库获取自己的会话状态
            const currentState = await groupStateStore.get(myUserId, orderId, myUserId);
            if (!currentState) {
                throw new Error(`加密失败：群组 "${orderId}" 的会话未初始化。请先调用 createGroupSession。`);
            }

            // 使用新的工厂方法，需要传入 senderId 和 groupId
            const session = SenderKeySession.createFromState(currentState, myUserId, orderId);

            // 同步操作：加密消息
            const encryptedCore = session.ratchetEncrypt(plaintext);

            // 异步操作：加密后，会话状态已更新（棘轮推进），必须存回数据库
            await groupStateStore.set(myUserId, orderId, myUserId, session.getState());

            return {
                ...encryptedCore,
                orderId: orderId,
                senderId: myUserId,
            };
        });
    },

    /**
     * 解密一条群组消息。
     * 添加了密钥有效性检查
     */
    async decryptGroupMessage(
        myUserId: string,
        message: ISenderKeyMessage
    ): Promise<Uint8Array> {
        const { orderId, senderId } = message;

        // 检查接收者是否仍然是群组成员
        const isReceiverMember = await groupStore.isMember(orderId, myUserId);
        if (!isReceiverMember) {
            throw new Error(`解密失败：您已不再是群组 "${orderId}" 的成员。`);
        }

        // 检查发送者是否仍然是群组成员
        const isSenderMember = await groupStore.isMember(orderId, senderId);
        if (!isSenderMember) {
            throw new Error(`解密失败：发送者 "${senderId}" 已不是群组 "${orderId}" 的成员。`);
        }

        // 使用锁确保对同一会话的并发操作是串行的
        const lockKey = `decrypt-${myUserId}-${orderId}-${senderId}`;

        return withLock(lockKey, async () => {
            // 异步操作：根据消息的发送者，从数据库获取对应的会话状态
            const currentState = await groupStateStore.get(myUserId, orderId, senderId);
            if (!currentState) {
                throw new Error(`解密失败：找不到发送者 "${senderId}" 在群组 "${orderId}" 中的会话。可能需要对方重新分发密钥。`);
            }

            // 使用新的工厂方法，需要传入 senderId 和 groupId
            const session = SenderKeySession.createFromState(currentState, senderId, orderId);

            // 同步操作：解密消息
            const plaintext = session.ratchetDecrypt(message);

            // 异步操作：解密后，会话状态已更新（棘轮推进），必须存回数据库
            await groupStateStore.set(myUserId, orderId, senderId, session.getState());

            return plaintext;
        });
    },

    /**
     * 检查用户是否具有有效的群组会话
     */
    async hasValidSession(userId: string, orderId: string, senderId: string): Promise<boolean> {
        try {
            // 检查用户是否是群组成员
            const isMember = await groupStore.isMember(orderId, userId);
            if (!isMember) {
                return false;
            }

            // 检查发送者是否是群组成员
            const isSenderMember = await groupStore.isMember(orderId, senderId);
            if (!isSenderMember) {
                return false;
            }

            // 检查是否存在有效的会话状态
            const state = await groupStateStore.get(userId, orderId, senderId);
            return state !== null;
        } catch (error) {
            console.error('Error checking session validity:', error);
            return false;
        }
    },

    /**
     * 获取用户的所有有效会话
     */
    async getValidSessions(userId: string, orderId: string): Promise<string[]> {
        try {
            // 获取群组所有成员
            const groupState = await groupStore.get(orderId);
            if (!groupState) {
                return [];
            }

            const validSenders: string[] = [];

            // 检查每个发送者是否有有效会话
            for (const memberId of groupState.members) {
                if (memberId === userId) continue; // 跳过自己

                const hasSession = await this.hasValidSession(userId, orderId, memberId);
                if (hasSession) {
                    validSenders.push(memberId);
                }
            }

            return validSenders;
        } catch (error) {
            console.error('Error getting valid sessions:', error);
            return [];
        }
    }
};