// src/e2ee/services/group-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { PersistedGroupMessage } from '../types/group-message.types';

/**
 * ✅ 订单类型枚举
 */
export enum OrderType {
    P2P = 0,      // 一对一订单（2个参与者）
    GROUP = 1     // 多方订单（3+个参与者，群聊）
}

/**
 * ✅ 服务器返回的群组订单信息
 */
export interface GroupOrderInfo {
    id: number;
    orderId: string;
    orderType: OrderType;
    dataName: string;
    flag: number;
    bssOrderId: number;
    contract?: string;
    members: {
        id: number;
        userId: string;
        roleType: 0 | 1;
        dataName: string;
    }[];
}

/**
 * 群组 API 服务
 * 服务器是群组元数据的 Single Source of Truth
 */
export const groupApiService = {
    client: createAuthenticatedApiClient(),

    /**
     * ✅ 获取当前用户参与的所有群组订单（仅返回多方订单）
     * 接口: POST /order/queryOrders
     * 用户上线时调用，同步所有群组信息
     */
    async getMyGroupOrders(): Promise<GroupOrderInfo[]> {
        try {
            const response = await this.client.post('/order/queryOrders', {});

            if (response.data.code !== 1) {
                console.warn(`[GroupApi] Query orders warning: ${response.data.msg}`);
                return [];
            }

            // ✅ 转换并过滤数据
            const allOrders: GroupOrderInfo[] = (response.data.data || []).map((order: any) => ({
                id: order.id,
                orderId: String(order.orderId),
                orderType: order.orderType,
                dataName: order.dataName,
                flag: order.flag,
                bssOrderId: order.bssOrderId,
                contract: order.contract,
                members: (order.participants || []).map((p: any) => ({
                    id: p.id,
                    userId: String(p.userId),
                    roleType: p.roleType as 0 | 1,
                    dataName: p.dataName
                }))
            }));

            // ✅ 关键：只返回群聊订单（orderType = 1）
            const groupOrders = allOrders.filter(order => order.orderType === OrderType.GROUP);

            console.log(
                `[GroupApi] Fetched ${allOrders.length} total orders, ` +
                `${groupOrders.length} are group orders (orderType=1)`
            );

            return groupOrders;

        } catch (error) {
            console.error('[GroupApi] Query orders failed:', error);
            return [];
        }
    },

    /**
     * ✅ 获取所有订单（包括 P2P 和群聊）
     * 用于其他模块可能需要所有订单的场景
     */
    async getAllOrders(): Promise<GroupOrderInfo[]> {
        try {
            const response = await this.client.post('/order/queryOrders', {});

            if (response.data.code !== 1) {
                console.warn(`[GroupApi] Query orders warning: ${response.data.msg}`);
                return [];
            }

            const orders: GroupOrderInfo[] = (response.data.data || []).map((order: any) => ({
                id: order.id,
                orderId: String(order.orderId),
                orderType: order.orderType,
                dataName: order.dataName,
                flag: order.flag,
                bssOrderId: order.bssOrderId,
                contract: order.contract,
                members: (order.participants || []).map((p: any) => ({
                    id: p.id,
                    userId: String(p.userId),
                    roleType: p.roleType as 0 | 1,
                    dataName: p.dataName
                }))
            }));

            console.log(`[GroupApi] Fetched ${orders.length} total orders`);
            return orders;

        } catch (error) {
            console.error('[GroupApi] Query all orders failed:', error);
            return [];
        }
    },

    /**
     * ✅ 获取 P2P 订单列表（orderType = 0）
     * 用于 P2P Router
     */
    async getP2POrders(): Promise<GroupOrderInfo[]> {
        try {
            const allOrders = await this.getAllOrders();
            const p2pOrders = allOrders.filter(order => order.orderType === OrderType.P2P);

            console.log(`[GroupApi] Found ${p2pOrders.length} P2P orders (orderType=0)`);
            return p2pOrders;

        } catch (error) {
            console.error('[GroupApi] Get P2P orders failed:', error);
            return [];
        }
    },

    /**
     * ✅ 获取单个订单的详细信息
     * 用于按需刷新特定订单的状态
     */
    async getGroupOrder(orderId: string): Promise<GroupOrderInfo | null> {
        try {
            // 查询所有订单并过滤
            const allOrders = await this.getAllOrders();
            const targetOrder = allOrders.find(order => order.orderId === orderId);

            if (!targetOrder) {
                console.warn(`[GroupApi] Order ${orderId} not found`);
                return null;
            }

            // ✅ 验证是否为群聊订单
            if (targetOrder.orderType !== OrderType.GROUP) {
                console.warn(
                    `[GroupApi] Order ${orderId} is not a group order ` +
                    `(orderType=${targetOrder.orderType})`
                );
                // 根据业务需求决定是否返回 null
                // 这里仍然返回，但打印警告
            }

            return targetOrder;

        } catch (error) {
            console.error(`[GroupApi] Get order ${orderId} failed:`, error);
            return null;
        }
    },

    /**
     * 获取群成员列表（兼容旧代码，基于查询订单接口）
     */
    async getGroupMembers(orderId: string): Promise<string[]> {
        try {
            const order = await this.getGroupOrder(orderId);
            if (!order) {
                console.warn(`[GroupApi] Order ${orderId} not found`);
                return [];
            }

            return order.members.map(m => m.userId);
        } catch (error) {
            console.error('[GroupApi] Get members failed:', error);
            return [];
        }
    },

    /**
     * 获取历史消息（支持分页）
     */
    async getHistory(
        orderId: string,
        beforeTimestamp: number = Date.now(),
        limit: number = 20
    ): Promise<PersistedGroupMessage[]> {
        try {
            console.log(`[GroupApi] Fetching history for ${orderId}, before: ${beforeTimestamp}, limit: ${limit}`);
            // 尝试使用符合 api.md 规范的 endpoint
            const response = await this.client.get(`/api/groups/${orderId}/messages`, {
                params: {
                    before: beforeTimestamp,
                    limit: limit
                }
            });

            console.log(`[GroupApi] Server response for ${orderId}: code=${response.data.code}`);

            if (response.data.code !== 1) {
                console.warn(`[GroupApi] Fetch failed: ${response.data.msg}`);
                return [];
            }

            const data = response.data.data;
            // Handle { success: true, messages: [...] } wrapper
            if (data && Array.isArray(data.messages)) {
                return data.messages;
            }
            // Handle direct array []
            if (Array.isArray(data)) {
                return data;
            }

            return [];
        } catch (error: any) {
            // Include fallback to legacy endpoint if 404
            if (error.response?.status === 404) {
                console.warn('[GroupApi] /api/groups Endpoint not found, trying legacy /group');
                try {
                    const legacyRes = await this.client.get(`/group/${orderId}/messages`, {
                        params: { before: beforeTimestamp, limit }
                    });
                    if (legacyRes.data.code === 1) return legacyRes.data.data || [];
                } catch (e) {
                    console.error('[GroupApi] Legacy fetch also failed:', e);
                }
            }
            console.error('[GroupApi] Get history failed:', error);
            return [];
        }
    },

    /**
     * 获取最新群组消息 (用于替代离线消息接口)
     */
    async getLatestGroupMessages(orderId: string, limit: number = 50): Promise<PersistedGroupMessage[]> {
        return this.getHistory(orderId, Date.now(), limit);
    },

    /**
     * 获取离线消息 (After timestamp)
     */
    async getGroupOfflineMessages(
        orderId: string,
        transformTimestamp: number
    ): Promise<PersistedGroupMessage[]> {
        try {
            // ✅ 使用符合 api.md 文档的接口
            // GET /api/groups/:groupId/messages/offline?since=...
            const response = await this.client.get<{
                code: number;
                msg: string;
                data: {
                    success: boolean;
                    messages: PersistedGroupMessage[];
                }
            }>(`/api/groups/${orderId}/messages/offline`, {
                params: {
                    since: transformTimestamp
                }
            });

            if (response.data.code !== 1) {
                return [];
            }

            // ✅ 正确解析返回结构
            const data = response.data.data;
            if (data && Array.isArray(data.messages)) {
                return data.messages;
            }

            // 兼容旧结构（如果后端返回的是直接数组）
            if (Array.isArray(data)) {
                return data;
            }

            return [];
        } catch (error) {
            console.error('[GroupApi] Get offline messages failed:', error);
            // Fallback: try the old endpoint if 404 (optional, but good for safety)
            // But since the old one wasn't working for unread counts (likely), we might as well just fail.
            return [];
        }
    },

    /**
     * 发送群组消息
     */
    async sendGroupMessage(message: PersistedGroupMessage): Promise<void> {
        const response = await this.client.post('/group/message/send', message);
        if (response.data.code !== 1) {
            throw new Error(response.data.msg);
        }
    },

    // ==========================================
    // 文件传输部分（保持不变）
    // ==========================================

    /**
     * 上传加密文件
     */
    async uploadFile(encryptedBlob: Blob, orderId: string): Promise<string> {
        const formData = new FormData();
        const fileName = `group_enc_${Date.now()}.encrypted`;
        formData.append('file', encryptedBlob, fileName);
        formData.append('orderId', orderId);

        try {
            const response = await this.client.post('/file/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 5 * 60 * 1000
            });

            if (response.data.code !== 1) {
                throw new Error(response.data.msg || '文件上传失败');
            }

            return String(response.data.data);
        } catch (error) {
            console.error('[GroupApi] Upload file failed:', error);
            throw error;
        }
    },

    /**
     * 下载加密文件
     */
    async downloadFile(fileId: string): Promise<ArrayBuffer> {
        try {
            const response = await this.client.post('/file/download',
                { fileId },
                { responseType: 'arraybuffer' }
            );

            if (response.headers['content-type']?.includes('application/json')) {
                const text = new TextDecoder().decode(response.data);
                try {
                    const json = JSON.parse(text);
                    if (json.code !== 1) {
                        throw new Error(json.msg || '下载文件出错');
                    }
                    if (json.data && json.data.fileContent) {
                        return this._base64ToArrayBuffer(json.data.fileContent);
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }

            return response.data;
        } catch (error) {
            console.error('[GroupApi] Download file failed:', error);
            throw error;
        }
    },

    /**
     * 辅助：Base64 转 ArrayBuffer
     */
    _base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
};