// src/e2ee/services/group-management-service.ts

import { groupStore } from '../store/group-store';
import { groupStateStore } from '../store/group-state-store';
import { groupE2eeService } from './group-e2ee-service';
import type { ISenderKeyDistributionMessage } from '../protocol/types';

export interface IMessageSender {
    /**
     * 发送私聊消息 (用于密钥分发)
     * 必须是端到端加密通道
     */
    sendToUser(userId: string, message: any): Promise<void>;

    /**
     * 发送群组广播 (用于信令和群聊)
     * 服务器会转发给群内所有在线成员
     */
    sendToGroup(orderId: string, message: any): Promise<void>;
}

// 模拟的发送器，用于防止未注入时报错
const mockMessageSender: IMessageSender = {
    async sendToUser(uid, msg) { console.log('[Mock] Send to user:', uid, msg); },
    async sendToGroup(gid, msg) { console.log('[Mock] Send to group:', gid, msg); }
};

export const groupManagementService = {
    messageSender: mockMessageSender,

    /**
     * 依赖注入：设置真正的消息发送器
     */
    setMessageSender(sender: IMessageSender) {
        this.messageSender = sender;
    },

    /**
     * 【创建群组】
     * 1. 存储本地元数据
     * 2. 初始化管理员(自己)的加密会话
     * 3. 通知并分发密钥给初始成员
     */
    async createGroup(orderId: string, adminId: string, initialMembers: string[] = []): Promise<void> {
        // 去重成员列表
        const allMembers = Array.from(new Set([adminId, ...initialMembers]));

        // 1. 存储群组基本信息
        const groupState = {
            orderId,
            adminId,
            members: allMembers,
            createdAt: Date.now()
        };
        await groupStore.set(groupState);
        console.log(`[GroupMgmt] Created group ${orderId} locally.`);

        // 2. 初始化我的 Sender Key (我是管理员)
        const myDistMsg = await groupE2eeService.createGroupSession(adminId, orderId);

        // 3. 邀请初始成员
        // 注意：这里我们通过单播 P2P 逐个发送邀请和密钥
        // 这样新成员一上线收到消息就能解密群聊
        for (const memberId of initialMembers) {
            if (memberId === adminId) continue;

            // 发送密钥 (P2P E2EE)
            await this.distributeKeyToUser(memberId, myDistMsg);

            // 发送入群通知 (可以是系统消息)
            await this.messageSender.sendToUser(memberId, {
                type: 'MEMBER_JOINED', // 信令类型
                payload: {
                    orderId,
                    memberId, // 你被加入了
                    inviterId: adminId,
                    timestamp: Date.now()
                }
            });
        }
    },

    /**
     * 【添加成员】
     * 触发者：管理员
     */
    async addMemberToGroup(orderId: string, inviterId: string, newMemberId: string): Promise<void> {
        // 1. 更新本地存储
        await groupStore.addMember(orderId, newMemberId);
        console.log(`[GroupMgmt] Added member ${newMemberId} to group ${orderId}`);

        // 2. 广播 "MEMBER_JOINED" 信令给整个群 (包括新成员)
        // 现有的群成员收到这个信令后，会自动触发 handleMemberJoinedSignal
        // 将他们各自的 Key 发送给新成员
        await this.messageSender.sendToGroup(orderId, {
            type: 'MEMBER_JOINED',
            payload: {
                orderId,
                memberId: newMemberId,
                inviterId,
                timestamp: Date.now()
            }
        });
    },

    /**
     * 【移除成员】
     * 触发者：管理员
     */
    async removeMemberFromGroup(orderId: string, removerId: string, memberToRemoveId: string): Promise<void> {
        // 1. 权限验证
        const groupState = await groupStore.get(orderId);
        if (!groupState || groupState.adminId !== removerId) {
            throw new Error('Permission denied: Only admin can remove members.');
        }

        // 2. 更新本地存储
        await groupStore.removeMember(orderId, memberToRemoveId);

        // 3. 清理我本地存储中关于该用户的密钥 (不再接收他的消息)
        await groupStateStore.remove(removerId, orderId, memberToRemoveId);

        console.log(`[GroupMgmt] Removed member ${memberToRemoveId} from group ${orderId}`);

        // 4. 广播 "MEMBER_REMOVED" 信令给剩余成员
        // 剩余成员收到后，会触发 handleMemberRemovedSignal 进行密钥轮转
        await this.messageSender.sendToGroup(orderId, {
            type: 'MEMBER_REMOVED',
            payload: {
                orderId,
                memberId: memberToRemoveId,
                removerId,
                timestamp: Date.now()
            }
        });
    },

    // ==========================================
    // 信令响应处理 (被动触发)
    // 这些方法应该在 Router 收到 WebSocket 消息后调用
    // ==========================================

    /**
     * 【处理：成员加入】
     * 逻辑：如果我是老成员，有新人加入，我需要把我的 Key 发给他。
     */
    async handleMemberJoinedSignal(myUserId: string, payload: any): Promise<void> {
        const { orderId, memberId } = payload;

        // 如果是我自己加入了，不需要给自己发 Key (但我可能需要拉取群组列表，这里暂不处理)
        if (memberId === myUserId) return;

        // 检查我是否在群里 (双重保险)
        const amIMember = await groupStore.isMember(orderId, myUserId);
        if (!amIMember) return;

        console.log(`[GroupMgmt] Detected new member ${memberId}, sending my key...`);

        // 获取我当前的发送密钥 (不需要轮转，直接给当前的即可)
        const myDistMsg = await groupE2eeService.getMyCurrentDistribution(myUserId, orderId);

        if (myDistMsg) {
            await this.distributeKeyToUser(memberId, myDistMsg);
        }
    },

    /**
     * 【处理：成员移除】
     * 逻辑：有人被移除了。为了前向安全，我必须轮转(Rotate)我的密钥。
     */
    async handleMemberRemovedSignal(myUserId: string, payload: any): Promise<void> {
        const { orderId, memberId } = payload;

        // 1. 从我的存储中删除被踢者的 Session (防止他还能发消息给我，虽然他已经被踢出群路由)
        await groupStateStore.remove(myUserId, orderId, memberId);

        // 如果被踢的是我自己
        if (memberId === myUserId) {
            console.log(`[GroupMgmt] I have been removed from group ${orderId}.`);
            await groupStore.remove(orderId); // 删除群组元数据
            return;
        }

        console.log(`[GroupMgmt] Member ${memberId} removed. Rotating my key to ensure forward secrecy...`);

        // 2. 密钥轮转：生成全新的 Session
        // 这会覆盖旧的 Chain Key，使得被踢者即使持有旧 Key 也无法推导出新 Key
        const newDistMsg = await groupE2eeService.createGroupSession(myUserId, orderId);

        // 3. 广播新密钥给剩下的所有人
        // 使用 sendToGroup，因为通过 P2P 一个个发效率太低
        // 这里的 KEY_DISTRIBUTION 消息本身可以是明文传输的(依托于 TLS)，
        // 或者也可以包装在 P2P 加密层中(如果追求极致安全，但群发通常直接发)。
        // *重要*：Signal 协议中，SenderKeyDistribution 消息包含的是 Public Key 和 Chain Key，
        // 只要信道(TLS/WebSocket)是安全的，直接发送也是可接受的。
        // 但为了统一，我们通常建议将这个广播消息包装在一种特殊的 Type 中。
        await this.messageSender.sendToGroup(orderId, {
            type: 'KEY_DISTRIBUTION', // 这是一个群广播的 Key Update
            payload: newDistMsg
        });
    },

    /**
     * 【处理：收到密钥分发】
     * 逻辑：无论是 P2P 收到的，还是群广播收到的 (Key Rotation)，都通过此方法处理
     */
    async handleKeyDistributionSignal(myUserId: string, payload: any): Promise<void> {
        await groupE2eeService.processGroupKeyDistribution(myUserId, payload);
    },

    // --- 私有辅助方法 ---

    /**
     * 封装发送密钥分发消息的逻辑
     * 这通常通过 P2P 隐蔽通道发送 (System Message)
     */
    async distributeKeyToUser(targetUserId: string, distMsg: ISenderKeyDistributionMessage) {
        // 这里我们约定一个特殊的 type，Router 收到后不渲染，而是转交给 Service
        await this.messageSender.sendToUser(targetUserId, {
            type: 'KEY_DISTRIBUTION',
            payload: distMsg
        });
    }
};