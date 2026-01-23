// src/e2ee/services/group-e2ee-service.ts

import { groupStateStore } from '../store/group-state-store';
import { groupStore } from '../store/group-store';
import { SenderKeySession } from '../protocol/sender-key-session';
import type { ISenderKeyMessage, ISenderKeyDistributionMessage } from '../protocol/types';
import { e2eeService } from '../../signal/services/e2ee.service';
// --- 并发锁工具 ---
// 防止同一时间对同一会话进行读写导致 ratchet 状态覆盖
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
     * 【初始化/轮转】为自己创建一个新的群组发送会话。
     * 场景：
     * 1. 刚创建群组时。
     * 2. 群成员被移除后，剩余成员需要调用此方法进行"密钥轮转(Rotation)"，以保证前向安全。
     */
    async createGroupSession(
        myUserId: string,
        orderId: string
    ): Promise<ISenderKeyDistributionMessage> {
        // 1. 权限检查
        const isMember = await groupStore.isMember(orderId, myUserId);
        if (!isMember) {
            throw new Error(`创建会话失败：您不是群组 "${orderId}" 的成员。`);
        }

        // 2. ✅ 获取复用的签名密钥对
        const signingKeyPair = await e2eeService.getSigningKeyPair(myUserId);

        if (!signingKeyPair) {
            // 这是一个严重错误，说明用户没有初始化 E2EE 身份
            throw new Error(`无法创建群聊会话：未找到用户 ${myUserId} 的签名密钥。请确保已登录并初始化 E2EE。`);
        }

        // 3. 创建新会话 (传入复用的密钥对)
        // 这里的 senderKeyId 会重新生成，chainKey 会重置，但 signingKey 保持不变
        const session = SenderKeySession.createSession(myUserId, orderId, signingKeyPair);

        // 3. 存储状态 (Key: 我在 orderId 群组中保存的 自己的 状态)
        await groupStateStore.set(myUserId, orderId, myUserId, session.getState());

        // 4. 生成分发消息核心
        const distributionCore = session.getDistributionMessage();

        console.log(`[E2EE] Created/Rotated session for group ${orderId}, new keyId: ${distributionCore.senderKeyId}`);

        // 5. 返回完整的 Distribution Message，准备通过信令发送给其他人
        return {
            ...distributionCore,
            orderId: orderId,
            senderId: myUserId,
        };
    },

    /**
     * 【接收密钥】处理从其他成员收到的密钥分发消息。
     * 场景：收到 P2P 的 KEY_DISTRIBUTION 消息时调用。
     */
    async processGroupKeyDistribution(
        myUserId: string,
        distMessage: ISenderKeyDistributionMessage
    ): Promise<void> {
        const { orderId, senderId } = distMessage;

        if (!senderId) {
            console.warn('[E2EE] Received distribution message without senderId');
            return;
        }

        // 1. 权限检查：发送者必须是群成员
        // console.log(`[E2EE] Checking if sender ${senderId} is member of ${orderId}...`);
        const isSenderMember = await groupStore.isMember(orderId, senderId);
        if (!isSenderMember) {
            console.warn(`[E2EE] Ignored key distribution from non-member ${senderId} in group ${orderId}`);
            // 注意：这里可以选择抛错，或者静默忽略（防止被移除的成员继续发包骚扰）
            return;
        }

        console.log(`[E2EE] Processing key from ${senderId} for group ${orderId}`);

        try {
            // 2. 创建接收会话
            // console.log('[E2EE] Creating session from distribution...');
            const session = SenderKeySession.createFromDistribution(distMessage);
            // console.log('[E2EE] Session object created successfully');

            // 3. 存储状态 (Key: 我在 orderId 群组中保存的 对方(senderId) 的状态)
            // 注意：接收会话不包含私钥，只能用于解密
            console.log(`[E2EE] Storing session state for ${senderId} in ${orderId}...`);
            await groupStateStore.set(myUserId, orderId, senderId, session.getState());
            console.log(`[E2EE] Session state stored successfully for ${senderId}`);


        } catch (e) {
            console.error(`[E2EE] Error in processGroupKeyDistribution:`, e);
            throw e;
        }
    },

    /**
     * 【加密】发送群组消息。
     * 会自动推进棘轮（Ratchet）并更新数据库。
     */
    async encryptGroupMessage(
        myUserId: string,
        orderId: string,
        plaintext: Uint8Array
    ): Promise<ISenderKeyMessage> {
        // 1. 权限检查
        const isMember = await groupStore.isMember(orderId, myUserId);
        if (!isMember) {
            throw new Error(`加密失败：您已不再是群组 "${orderId}" 的成员。`);
        }

        // 锁 Key：针对我自己的会话状态加锁，防止连续发送导致状态覆盖
        const lockKey = `encrypt-${myUserId}-${orderId}-${myUserId}`;

        return withLock(lockKey, async () => {
            // 2. 加载状态
            let currentState = await groupStateStore.get(myUserId, orderId, myUserId);
            let session: SenderKeySession;

            // 容错：如果还没有会话（例如第一次发消息前没初始化），自动初始化一个
            if (!currentState) {
                console.warn(`[E2EE] No active session found for ${orderId}, auto-creating...`);
                // 注意：这里自动创建后，必须依赖外层逻辑将新的 Key 分发出去，否则别人解不开。
                // 这种情况下通常建议抛出错误让 UI 引导用户重新初始化，但为了健壮性这里做了自动处理。
                const distMsg = await this.createGroupSession(myUserId, orderId);
                // 重新获取刚刚保存的状态
                currentState = await groupStateStore.get(myUserId, orderId, myUserId);
                if (!currentState) throw new Error('Failed to create session state');

                // TODO: 在实际工程中，这里应该触发一个回调通知 Service 层去广播 distMsg
            }

            session = SenderKeySession.createFromState(currentState!, myUserId, orderId);

            // 3. 执行棘轮加密 (Chain Key 推进)
            const encryptedCore = session.ratchetEncrypt(plaintext);

            // 4. 保存更新后的状态
            await groupStateStore.set(myUserId, orderId, myUserId, session.getState());

            return {
                ...encryptedCore,
                orderId: orderId,
                senderId: myUserId,
            };
        });
    },

    /**
     * 【解密】接收群组消息。
     * 支持乱序消息处理。
     */
    async decryptGroupMessage(
        myUserId: string,
        message: ISenderKeyMessage
    ): Promise<Uint8Array> {
        const { orderId, senderId } = message;

        // 1. 权限检查 (接收者必须还在群里)
        const isReceiverMember = await groupStore.isMember(orderId, myUserId);
        if (!isReceiverMember) {
            throw new Error(`解密失败：您已不再是群组 "${orderId}" 的成员。`);
        }

        // 锁 Key：针对发送者的状态加锁，防止并发解密导致状态覆盖
        const lockKey = `decrypt-${myUserId}-${orderId}-${senderId}`;

        return withLock(lockKey, async () => {
            // 2. 加载发送者的会话状态
            const currentState = await groupStateStore.get(myUserId, orderId, senderId, message.senderKeyId);

            if (!currentState) {
                // 如果找不到会话，说明我还没收到他的 Key Distribution 消息
                // 或者我刚被加入群，还没来得及同步。
                throw new Error(`解密失败：未找到发送者 "${senderId}" 的密钥会话。等待密钥分发中...`);
            }

            const session = SenderKeySession.createFromState(currentState, senderId, orderId);

            // 3. 执行棘轮解密
            // 这一步可能会抛错（如签名验证失败、重放攻击等）
            const plaintext = session.ratchetDecrypt(message);

            // 4. 保存更新后的状态
            // (Chain Key 可能已推进，或者 Message Keys 缓存已更新)
            await groupStateStore.set(myUserId, orderId, senderId, session.getState());

            return plaintext;
        });
    },

    /**
     * 【辅助】获取我当前正在使用的密钥分发包。
     * 场景：有新成员加入时，不需要轮转密钥，只需把当前的 Key 发给他即可。
     */
    async getMyCurrentDistribution(
        myUserId: string,
        orderId: string
    ): Promise<ISenderKeyDistributionMessage | null> {
        const state = await groupStateStore.get(myUserId, orderId, myUserId);
        if (!state) return null;

        const session = SenderKeySession.createFromState(state, myUserId, orderId);
        const distCore = session.getDistributionMessage();

        return {
            ...distCore,
            orderId,
            senderId: myUserId
        };
    }
};