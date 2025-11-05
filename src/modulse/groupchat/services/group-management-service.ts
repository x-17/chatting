// src/e2ee/services/group-management-service.ts

import { groupStore } from '../store/group-store';
import { groupE2eeService } from './group-e2ee-service';
import { groupStateStore } from '../store/group-state-store';
import { mockMessageSender } from './mock-message-sender';
//import {WebSocketMessageSender} from './websocket-message-sender.ts'
//TODO:这里是本地完成测试用的应该使用正式通信替代

// 修改默认的消息发送器为模拟发送器
const defaultMessageSender: IMessageSender = mockMessageSender;

// 消息发送器接口
export interface IMessageSender {
    sendToUser(userId: string, message: any): Promise<void>;
    sendToGroup(orderId: string, message: any): Promise<void>;
}

export const groupManagementService = {
    // 允许设置自定义的消息发送器
    messageSender: defaultMessageSender,

    /**
     * 创建新群组
     */
    async createGroup(orderId: string, adminId: string, initialMembers: string[] = []): Promise<void> {
        // 创建群组状态
        const groupState = {
            orderId,
            adminId,
            members: [adminId, ...initialMembers],
            createdAt: Date.now()
        };

        await groupStore.set(groupState);

        console.log(`[GroupMgmt] Created group ${orderId} with admin ${adminId} and members: ${initialMembers.join(', ')}`);

        // 【修复】不在这里自动创建会话，让调用方控制时序
        // 通知初始成员加入群组（但不立即分发密钥）
        for (const memberId of initialMembers) {
            if (memberId !== adminId) {
                await this.messageSender.sendToUser(memberId, {
                    type: 'MEMBER_JOINED',
                    payload: {
                        orderId,
                        memberId,
                        inviterId: adminId,
                        timestamp: Date.now()
                    }
                });
            }
        }
    },

    /**
     * 【修复】添加成员到群组
     */
    async addMemberToGroup(orderId: string, inviterId: string, newMemberId: string): Promise<void> {
        console.log(`[GroupMgmt] Adding ${newMemberId} to group ${orderId} by ${inviterId}`);

        // 更新群组成员列表
        await groupStore.addMember(orderId, newMemberId);

        // 获取群组状态
        const groupState = await groupStore.get(orderId);
        if (!groupState) {
            throw new Error(`Group ${orderId} not found`);
        }

        console.log(`[GroupMgmt] Group ${orderId} now has members: ${groupState.members.join(', ')}`);

        // 【关键修复】发送现有成员的密钥分发给新成员
        // 但这次我们不在这里自动创建新的会话，而是使用现有的会话状态
        for (const memberId of groupState.members) {
            if (memberId === newMemberId) continue; // 跳过新成员自己

            try {
                // 获取现有成员的当前会话状态
                const senderState = await groupStateStore.get(memberId, orderId, memberId);
                if (senderState) {
                    // 使用现有状态创建分发消息
                    const SenderKeySession = await import('../protocol/sender-key-session').then(m => m.SenderKeySession);
                    const session = SenderKeySession.createFromState(senderState, memberId, orderId);

                    const distributionMessage = session.getDistributionMessage();
                    const fullDistribution = {
                        ...distributionMessage,
                        orderId,
                        senderId: memberId
                    };

                    // 发送给新成员
                    await this.messageSender.sendToUser(newMemberId, {
                        type: 'KEY_DISTRIBUTION',
                        payload: fullDistribution
                    });

                    console.log(`[GroupMgmt] Sent ${memberId}'s key distribution to ${newMemberId}`);
                } else {
                    console.warn(`[GroupMgmt] No sender state found for ${memberId} in group ${orderId}`);
                }
            } catch (error) {
                console.error(`[GroupMgmt] Failed to create distribution for ${memberId} to ${newMemberId}:`, error);
            }
        }

        // 通知群组有新成员加入
        await this.messageSender.sendToGroup(orderId, {
            type: 'MEMBER_JOINED',
            payload: {
                orderId,
                memberId: newMemberId,
                inviterId,
                timestamp: Date.now()
            }
        });

        console.log(`[GroupMgmt] Notified group about ${newMemberId} joining`);
    },

    /**
     * 【修复】从群组中移除成员 - 触发完整的重新密钥化
     */
    async removeMemberFromGroup(orderId: string, removerId: string, memberToRemoveId: string): Promise<void> {
        console.log(`[GroupMgmt] Removing ${memberToRemoveId} from group ${orderId} by ${removerId}`);

        // 验证操作者权限
        const groupState = await groupStore.get(orderId);
        if (!groupState || groupState.adminId !== removerId) {
            throw new Error('Only group admin can remove members');
        }

        // 更新群组成员列表
        await groupStore.removeMember(orderId, memberToRemoveId);

        // 获取剩余成员
        const updatedGroupState = await groupStore.get(orderId);
        const remainingMembers = updatedGroupState?.members || [];

        console.log(`[GroupMgmt] Remaining members after removal: ${remainingMembers.join(', ')}`);

        // 【关键修复】清理所有与被移除成员相关的密钥状态
        for (const memberId of remainingMembers) {
            try {
                await groupStateStore.remove(memberId, orderId, memberToRemoveId);
                console.log(`[GroupMgmt] Cleaned ${memberToRemoveId}'s key from ${memberId}'s storage`);
            } catch (error) {
                console.warn(`[GroupMgmt] Failed to clean ${memberToRemoveId}'s key from ${memberId}:`, error);
            }
        }

        // 通知群组有成员被移除（这会触发重新密钥化）
        await this.messageSender.sendToGroup(orderId, {
            type: 'MEMBER_REMOVED',
            payload: {
                orderId,
                memberId: memberToRemoveId,
                removerId,
                timestamp: Date.now(),
                requiresRekey: true // 标记需要重新密钥化
            }
        });

        console.log(`[GroupMgmt] Notified group about ${memberToRemoveId} removal and rekey requirement`);
    },

    /**
     * 处理收到的密钥分发消息
     */
    async processKeyDistribution(myUserId: string, distributionMessage: any): Promise<void> {
        if (distributionMessage.type !== 'KEY_DISTRIBUTION') {
            throw new Error('Invalid distribution message type');
        }

        const payload = distributionMessage.payload;
        console.log(`[GroupMgmt] ${myUserId} processing key distribution from ${payload.senderId}`);

        await groupE2eeService.processGroupKeyDistribution(
            myUserId,
            payload.senderId,
            payload
        );
    },

    /**
     * 【修复】处理成员加入通知
     */
    async handleMemberJoined(myUserId: string, message: any): Promise<void> {
        const { orderId, memberId } = message.payload;

        console.log(`[GroupMgmt] ${myUserId} handling member joined: ${memberId}`);

        // 如果是自己加入，不需要特殊处理
        if (memberId === myUserId) {
            return;
        }

        // 【修复】不在这里自动分发密钥，让上层逻辑控制
        // 这避免了重复分发和时序问题
        console.log(`[GroupMgmt] ${myUserId} acknowledged ${memberId} joined group ${orderId}`);
    },

    /**
     * 获取群组成员列表
     */
    async getGroupMembers(orderId: string): Promise<string[]> {
        const groupState = await groupStore.get(orderId);
        return groupState ? groupState.members : [];
    },

    /**
     * 检查用户是否是群组管理员
     */
    async isGroupAdmin(orderId: string, userId: string): Promise<boolean> {
        const groupState = await groupStore.get(orderId);
        return groupState ? groupState.adminId === userId : false;
    }
};