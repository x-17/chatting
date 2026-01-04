// src/e2ee/services/group-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { PersistedGroupMessage } from '../types/group-message.types';

/**
 * 群成员信息结构
 */
export interface GroupMemberInfo {
    userId: string;
    role: 'admin' | 'member';
    joinedAt: number;
}

/**
 * 群组 API 服务
 * 负责与后端进行 HTTP 交互，作为 "Single Source of Truth"
 */
export const groupApiService = {
    client: createAuthenticatedApiClient(),

    /**
     * 1. 创建群组
     * 后端应当：在数据库创建群组记录，关联初始成员
     */
    async createGroup(orderId: string, memberIds: string[]): Promise<void> {
        try {
            const response = await this.client.post('/group/create', {
                orderId,
                memberIds
            });

            // 配合 api-client.ts 的拦截器逻辑，通常 code===1 代表成功
            if (response.data.code !== 1) {
                throw new Error(response.data.msg || '创建群组失败');
            }
        } catch (error) {
            console.error('[GroupApi] Create group failed:', error);
            throw error;
        }
    },

    /**
     * 2. 获取群成员列表
     * 场景：用户重新登录或新设备上线时，需要知道群里有哪些人，以便建立加密会话
     */
    async getGroupMembers(orderId: string): Promise<string[]> {
        try {
            const response = await this.client.get(`/group/${orderId}/members`);

            if (response.data.code !== 1) {
                console.warn(`[GroupApi] Get members warning: ${response.data.msg}`);
                return [];
            }

            // 返回纯 ID 数组
            return response.data.data.map(m => m.userId);
        } catch (error) {
            console.error('[GroupApi] Get members failed:', error);
            return [];
        }
    },

    /**
     * 3. 添加群成员
     */
    async addMember(orderId: string, userId: string): Promise<void> {
        try {
            const response = await this.client.post('/group/member/add', {
                orderId,
                userId
            });

            if (response.data.code !== 1) {
                throw new Error(response.data.msg || '添加成员失败');
            }
        } catch (error) {
            console.error('[GroupApi] Add member failed:', error);
            throw error;
        }
    },

    /**
     * 4. 移除群成员
     */
    async removeMember(orderId: string, userId: string): Promise<void> {
        try {
            const response = await this.client.post('/group/member/remove', {
                orderId,
                userId
            });

            if (response.data.code !== 1) {
                throw new Error(response.data.msg || '移除成员失败');
            }
        } catch (error) {
            console.error('[GroupApi] Remove member failed:', error);
            throw error;
        }
    },

    /**
     * 5. 获取历史消息 (支持分页)
     * 用于下拉加载更多，弥补本地 IndexedDB 的不足（可以不做）
     */
    async getHistory(
        orderId: string,
        beforeTimestamp: number = Date.now(),
        limit: number = 20
    ): Promise<PersistedGroupMessage[]> {
        try {
            const response = await this.client.get(`/group/${orderId}/messages`, {
                params: {
                    before: beforeTimestamp,
                    limit: limit
                }
            });

            if (response.data.code !== 1) {
                return [];
            }
            return response.data.data;
        } catch (error) {
            console.error('[GroupApi] Get history failed:', error);
            return [];
        }
    },

    // ==========================================
    // 文件传输部分 (复用逻辑)
    // ==========================================

    /**
     * 6. 上传加密文件
     * @param encryptedBlob 已经被 fileEncryptionService 加密过的二进制数据
     * @param orderId 关联的订单 ID
     * @returns 服务器返回的文件 ID (fileId)
     */
    async uploadFile(encryptedBlob: Blob, orderId: string): Promise<string> {
        const formData = new FormData();
        // 文件名后缀保持 .encrypted，与 P2P 逻辑一致
        const fileName = `group_enc_${Date.now()}.encrypted`;
        formData.append('file', encryptedBlob, fileName);
        formData.append('orderId', orderId);

        try {
            // 复用通用的文件上传接口
            const response = await this.client.post('/file/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                // 设置较长的超时时间，防止大文件上传中断
                timeout: 5 * 60 * 1000
            });

            if (response.data.code !== 1) {
                throw new Error(response.data.msg || '文件上传失败');
            }

            // 统一转为 string 返回
            return String(response.data.data);
        } catch (error) {
            console.error('[GroupApi] Upload file failed:', error);
            throw error;
        }
    },

    /**
     * 7. 下载加密文件
     * @param fileId 文件 ID
     * @returns ArrayBuffer (原始二进制流)
     */
    async downloadFile(fileId: string): Promise<ArrayBuffer> {
        try {
            // 关键：responseType 必须设为 'arraybuffer'，否则 axios 会尝试解析 JSON 或文本
            const response = await this.client.post('/file/download',
                { fileId },
                { responseType: 'arraybuffer' }
            );

            // 容错处理：有时后端出错会返回 JSON 格式的错误信息，即使我们请求的是 arraybuffer
            if (response.headers['content-type']?.includes('application/json')) {
                const text = new TextDecoder().decode(response.data);
                try {
                    const json = JSON.parse(text);
                    if (json.code !== 1) {
                        throw new Error(json.msg || '下载文件出错');
                    }
                    // 极端情况：后端在 JSON 里包了 Base64 (虽然不推荐，但为了健壮性)
                    if (json.data && json.data.fileContent) {
                        return this._base64ToArrayBuffer(json.data.fileContent);
                    }
                } catch (e) {
                    // 解析 JSON 失败，说明可能是真的二进制流被误判，忽略
                }
            }

            return response.data; // 直接返回二进制数据
        } catch (error) {
            console.error('[GroupApi] Download file failed:', error);
            throw error;
        }
    },

    /**
     * 辅助：Base64 转 ArrayBuffer (仅用于兼容某些后端返回格式)
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