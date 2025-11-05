// src/e2ee/storage/group-store.ts

import { get, set, del } from 'idb-keyval';

export interface IGroupState {
    orderId: string;
    members: string[]; // 简化为字符串数组，只存储用户ID
    adminId: string;
    createdAt: number;
}

export const groupStore = {
    /**
     * 生成存储键
     */
    _generateKey(orderId: string): string {
        return `group-${orderId}`;
    },

    /**
     * 创建或更新群组状态
     */
    async set(groupState: IGroupState): Promise<void> {
        const key = this._generateKey(groupState.orderId);
        await set(key, groupState);
    },

    /**
     * 获取群组状态
     */
    async get(orderId: string): Promise<IGroupState | null> {
        const key = this._generateKey(orderId);
        return await get<IGroupState>(key);
    },

    /**
     * 删除群组状态
     */
    async remove(orderId: string): Promise<void> {
        const key = this._generateKey(orderId);
        await del(key);
    },

    /**
     * 添加成员到群组
     */
    async addMember(orderId: string, userId: string): Promise<void> {
        const groupState = await this.get(orderId);
        if (!groupState) {
            throw new Error(`Group ${orderId} not found`);
        }

        // 检查成员是否已存在
        if (!groupState.members.includes(userId)) {
            groupState.members.push(userId);
            await this.set(groupState);
        }
    },

    /**
     * 从群组中移除成员
     */
    async removeMember(orderId: string, userId: string): Promise<void> {
        const groupState = await this.get(orderId);
        if (!groupState) {
            throw new Error(`Group ${orderId} not found`);
        }

        const memberIndex = groupState.members.indexOf(userId);
        if (memberIndex !== -1) {
            groupState.members.splice(memberIndex, 1);
            await this.set(groupState);
        }
    },

    /**
     * 检查用户是否是群组成员
     */
    async isMember(orderId: string, userId: string): Promise<boolean> {
        const groupState = await this.get(orderId);
        if (!groupState) {
            return false;
        }

        return groupState.members.includes(userId);
    }
};