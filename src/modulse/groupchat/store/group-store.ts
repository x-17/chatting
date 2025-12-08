// src/e2ee/storage/group-store.ts

import { get, set, del } from 'idb-keyval';

export interface IGroupState {
    orderId: string;
    members: string[];
    adminId: string;
    createdAt: number;
}

export interface IGroupStore {
    set(groupState: IGroupState): Promise<void>;
    get(orderId: string): Promise<IGroupState | null>;
    remove(orderId: string): Promise<void>;
    addMember(orderId: string, userId: string): Promise<void>;
    removeMember(orderId: string, userId: string): Promise<void>;
    isMember(orderId: string, userId: string): Promise<boolean>;
}

export const groupStore: IGroupStore = {
    /**
     * 生成存储键 (内部辅助方法，不暴露在接口中，但在实现中使用)
     */
    // @ts-ignore: 内部方法，不需要在接口中定义，但在对象字面量中需要实现
    _generateKey(orderId: string): string {
        return `group-${orderId}`;
    },

    /**
     * 创建或更新群组状态
     */
    async set(groupState: IGroupState): Promise<void> {
        // @ts-ignore
        const key = this._generateKey(groupState.orderId);
        await set(key, groupState);
    },

    /**
     * 获取群组状态
     */
    async get(orderId: string): Promise<IGroupState | null> {
        // @ts-ignore
        const key = this._generateKey(orderId);
        return await get<IGroupState>(key);
    },

    /**
     * 删除群组状态
     */
    async remove(orderId: string): Promise<void> {
        // @ts-ignore
        const key = this._generateKey(orderId);
        await del(key);
    },

    /**
     * 添加成员到群组
     */
    async addMember(orderId: string, userId: string): Promise<void> {
        const groupState = await this.get(orderId);
        if (!groupState) {
            // 如果群组不存在，可以选择抛错或者自动创建（取决于业务逻辑）
            // 这里为了安全起见，如果没有群组数据，则不执行操作
            console.warn(`[GroupStore] Cannot add member: Group ${orderId} not found`);
            return;
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
            console.warn(`[GroupStore] Cannot remove member: Group ${orderId} not found`);
            return;
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

        // 如果群组本地状态不存在，默认视为 false (或者根据需求处理)
        if (!groupState) {
            return false;
        }

        return groupState.members.includes(userId);
    }
};