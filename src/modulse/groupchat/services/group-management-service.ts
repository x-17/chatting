// src/e2ee/services/group-management-service.ts

import { groupStore } from '../store/group-store';
import { groupStateStore } from '../store/group-state-store';
import { groupE2eeService } from './group-e2ee-service';
import { groupApiService, type GroupOrderInfo } from './group-api.service';
import type { ISenderKeyDistributionMessage } from '../protocol/types';

export interface IMessageSender {
    /**
     * ✅ 发送密钥分发消息（P2P 加密通道）
     */
    sendKeyToUser(userId: string, orderId: string, distMsg: ISenderKeyDistributionMessage): Promise<void>;

    /**
     * 发送群组广播（系统信令，通过 WebSocket）
     */
    sendToGroup(orderId: string, message: any): Promise<void>;
}

const mockMessageSender: IMessageSender = {
    async sendKeyToUser(uid, oid, msg) {
        console.log('[Mock] Send key to user:', uid, 'for order:', oid);
    },
    async sendToGroup(gid, msg) {
        console.log('[Mock] Send to group:', gid, msg);
    }
};

export const groupManagementService = {
    messageSender: mockMessageSender,

    setMessageSender(sender: IMessageSender) {
        this.messageSender = sender;
    },

    /**
     * ✅ 用户上线时同步所有群组
     */
    async syncAllGroupsOnLogin(myUserId: string): Promise<void> {
        console.log(`[GroupMgmt] User ${myUserId} syncing groups on login...`);

        try {
            const serverOrders = await groupApiService.getMyGroupOrders();

            if (serverOrders.length === 0) {
                console.log('[GroupMgmt] No group orders found');
                return;
            }

            console.log(`[GroupMgmt] Found ${serverOrders.length} orders from server`);

            for (const order of serverOrders) {
                await this.syncSingleGroup(myUserId, order);
            }

            console.log('[GroupMgmt] All groups synced successfully');

        } catch (error) {
            console.error('[GroupMgmt] Failed to sync groups:', error);
            throw error;
        }
    },

    /**
     * ✅ 同步单个群组
     */
    async syncSingleGroup(myUserId: string, orderInfo: GroupOrderInfo): Promise<void> {
        const { orderId, members } = orderInfo;

        try {
            const memberIds = members.map(m => m.userId);

            console.log(`[GroupMgmt] Syncing group ${orderId} with members:`, memberIds);

            // 1. 更新本地群组元数据
            await groupStore.set({
                orderId,
                adminId: '',
                members: memberIds,
                createdAt: Date.now()
            });

            // 2. 初始化或检查我的密钥
            const mySession = await groupStateStore.get(myUserId, orderId, myUserId);
            if (!mySession) {
                console.log(`[GroupMgmt] Creating my SenderKey for ${orderId}`);
                const myDistMsg = await groupE2eeService.createGroupSession(myUserId, orderId);

                // ✅ 广播我的密钥给所有其他成员（P2P 单播）
                await this.broadcastMyKeyToMembers(myUserId, orderId, memberIds, myDistMsg);

                console.log(`[GroupMgmt] Broadcasted my key for ${orderId}`);
            } else {
                console.log(`[GroupMgmt] My SenderKey already exists for ${orderId}`);
            }

            // 3. 检查其他成员的密钥
            const missingKeys: string[] = [];
            for (const memberId of memberIds) {
                if (memberId === myUserId) continue;

                const hasKey = await groupStateStore.get(myUserId, orderId, memberId);
                if (!hasKey) {
                    missingKeys.push(memberId);
                }
            }

            if (missingKeys.length > 0) {
                console.warn(`[GroupMgmt] Missing keys for ${missingKeys.length} members in ${orderId}`);
            } else {
                console.log(`[GroupMgmt] All member keys present for ${orderId}`);
            }

        } catch (error) {
            console.error(`[GroupMgmt] Failed to sync group ${orderId}:`, error);
        }
    },

    /**
     * ✅ 广播我的密钥给所有成员（P2P 单播）
     */
    async broadcastMyKeyToMembers(
        myUserId: string,
        orderId: string,
        memberIds: string[],
        distMsg: ISenderKeyDistributionMessage
    ): Promise<void> {
        const promises = memberIds
            .filter(id => id !== myUserId) // 排除自己
            .map(memberId =>
                this.messageSender.sendKeyToUser(memberId, orderId, distMsg)
                    .catch(error => {
                        console.error(`[GroupMgmt] Failed to send key to ${memberId}:`, error);
                        // 不抛出错误，继续发送给其他成员
                    })
            );

        await Promise.allSettled(promises);
        console.log(`[GroupMgmt] Key broadcast completed for ${orderId}`);
    },

    /**
     * ✅ 处理服务器广播：成员加入 (userIn)
     */
    async handleUserInSignal(myUserId: string, payload: { orderId: string; userId: number | string }): Promise<void> {
        const orderId = payload.orderId;
        const newMemberId = String(payload.userId);

        console.log(`[GroupMgmt] User ${newMemberId} joined group ${orderId}`);

        try {
            // 1. 从服务器刷新最新的群组信息
            const orderInfo = await groupApiService.getGroupOrder(orderId);
            if (!orderInfo) {
                console.error(`[GroupMgmt] Cannot find order ${orderId} from server`);
                return;
            }

            // 2. 更新本地成员列表
            const memberIds = orderInfo.members.map(m => m.userId);
            const existingGroup = await groupStore.get(orderId);

            await groupStore.set({
                orderId,
                adminId: '',
                members: memberIds,
                createdAt: existingGroup?.createdAt || Date.now()
            });

            console.log(`[GroupMgmt] Updated local members for ${orderId}:`, memberIds);

            // 3. 如果是我自己加入
            if (newMemberId === myUserId) {
                // 创建我的密钥并广播给所有成员
                const myDistMsg = await groupE2eeService.createGroupSession(myUserId, orderId);
                await this.broadcastMyKeyToMembers(myUserId, orderId, memberIds, myDistMsg);
                console.log(`[GroupMgmt] I joined ${orderId}, broadcasted my key`);
                return;
            }

            // 4. 如果是别人加入，检查我是否在群里
            const amIMember = memberIds.includes(myUserId);
            if (!amIMember) {
                console.warn(`[GroupMgmt] I'm not a member of ${orderId}, ignoring`);
                return;
            }

            // 5. ✅ 发送我的密钥给新成员（P2P）
            const myDistMsg = await groupE2eeService.getMyCurrentDistribution(myUserId, orderId);
            if (myDistMsg) {
                await this.messageSender.sendKeyToUser(newMemberId, orderId, myDistMsg);
                console.log(`[GroupMgmt] Sent my key to new member ${newMemberId}`);
            } else {
                console.warn(`[GroupMgmt] My key not found for ${orderId}, need to initialize`);
            }

        } catch (error) {
            console.error(`[GroupMgmt] Failed to handle userIn:`, error);
        }
    },

    /**
     * ✅ 处理服务器广播：成员退出 (userOut)
     */
    async handleUserOutSignal(myUserId: string, payload: { orderId: string; userId: number | string }): Promise<void> {
        const orderId = payload.orderId;
        const removedMemberId = String(payload.userId);

        console.log(`[GroupMgmt] User ${removedMemberId} left group ${orderId}`);

        try {
            // 1. 如果被移除的是我自己
            if (removedMemberId === myUserId) {
                console.log(`[GroupMgmt] I was removed from group ${orderId}`);

                const group = await groupStore.get(orderId);
                if (group) {
                    for (const member of group.members) {
                        await groupStateStore.remove(myUserId, orderId, member);
                    }
                }

                await groupStore.remove(orderId);
                console.log(`[GroupMgmt] Cleaned up all data for ${orderId}`);

                return;
            }

            // 2. 从服务器刷新最新的群组信息
            const orderInfo = await groupApiService.getGroupOrder(orderId);
            if (!orderInfo) {
                console.error(`[GroupMgmt] Cannot find order ${orderId} from server`);
                return;
            }

            // 3. 更新本地成员列表
            const memberIds = orderInfo.members.map(m => m.userId);
            const existingGroup = await groupStore.get(orderId);

            await groupStore.set({
                orderId,
                adminId: '',
                members: memberIds,
                createdAt: existingGroup?.createdAt || Date.now()
            });

            console.log(`[GroupMgmt] Updated local members after removal:`, memberIds);

            // 4. 删除被移除成员的密钥
            await groupStateStore.remove(myUserId, orderId, removedMemberId);

            // 5. ✅ 密钥轮转：重新生成密钥并广播
            console.log(`[GroupMgmt] Rotating key for forward secrecy...`);
            const newDistMsg = await groupE2eeService.createGroupSession(myUserId, orderId);

            // 6. ✅ 广播新密钥给剩余成员（P2P 单播）
            await this.broadcastMyKeyToMembers(myUserId, orderId, memberIds, newDistMsg);

            console.log(`[GroupMgmt] Key rotation completed for ${orderId}`);

        } catch (error) {
            console.error(`[GroupMgmt] Failed to handle userOut:`, error);
        }
    },

    /**
     * ✅ 处理收到的密钥分发（通过 P2P Router 回调）
     */
    async handleKeyDistributionSignal(myUserId: string, payload: ISenderKeyDistributionMessage): Promise<void> {
        try {
            await groupE2eeService.processGroupKeyDistribution(myUserId, payload);
            console.log(`[GroupMgmt] Processed key from ${payload.senderId} for ${payload.orderId}`);
        } catch (error) {
            console.error(`[GroupMgmt] Failed to process key distribution:`, error);
        }
    },

    /**
     * ✅ WebSocket 重连后重新同步
     */
    async onReconnected(myUserId: string): Promise<void> {
        console.log('[GroupMgmt] WebSocket reconnected, re-syncing all groups...');
        try {
            await this.syncAllGroupsOnLogin(myUserId);
        } catch (error) {
            console.error('[GroupMgmt] Failed to re-sync on reconnection:', error);
        }
    }
};