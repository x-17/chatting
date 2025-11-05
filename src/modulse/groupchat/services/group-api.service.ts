// services/group-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { PersistedGroupMessage, GroupKeyDistribution } from '../types/group-message.types';

/**
 * 群组消息 HTTP API 服务
 */
export class GroupApiService {
    private apiClient = createAuthenticatedApiClient();

    /**
     * 发送群组消息到服务器
     */
    async sendGroupMessage(message: PersistedGroupMessage): Promise<{
        success: boolean;
        messageId: string;
        serverTimestamp: number
    }> {
        try {
            const response = await this.apiClient.post<{
                success: boolean;
                messageId: string;
                serverTimestamp: number;
            }>('/api/groups/messages/send', message);

            console.log(`[GroupApi] Message sent to group: ${message.orderId}`);
            return response.data;

        } catch (error) {
            console.error('[GroupApi] Send message error:', error);
            throw error;
        }
    }

    /**
     * 获取群组离线消息
     */
    async getGroupOfflineMessages(orderId: string, since?: number): Promise<PersistedGroupMessage[]> {
        try {
            const params = since ? { since } : {};
            const response = await this.apiClient.get<{
                success: boolean;
                messages: PersistedGroupMessage[];
            }>(`/api/groups/${orderId}/messages/offline`, { params });

            console.log(`[GroupApi] Retrieved ${response.data.messages.length} offline messages for group ${orderId}`);
            return response.data.messages;

        } catch (error) {
            console.error('[GroupApi] Get offline messages error:', error);
            return [];
        }
    }

    /**
     * 分发群组密钥
     */
    async distributeGroupKey(distribution: GroupKeyDistribution): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.post<{ success: boolean }>(
                '/api/groups/keys/distribute',
                distribution
            );

            console.log(`[GroupApi] Key distributed for group: ${distribution.orderId}`);
            return response.data;

        } catch (error) {
            console.error('[GroupApi] Distribute key error:', error);
            throw error;
        }
    }

    /**
     * 获取群组成员的密钥分发消息
     */
    async getGroupKeyDistributions(orderId: string): Promise<GroupKeyDistribution[]> {
        try {
            const response = await this.apiClient.get<{
                success: boolean;
                distributions: GroupKeyDistribution[];
            }>(`/api/groups/${orderId}/keys`);

            console.log(`[GroupApi] Retrieved ${response.data.distributions.length} key distributions for group ${orderId}`);
            return response.data.distributions;

        } catch (error) {
            console.error('[GroupApi] Get key distributions error:', error);
            return [];
        }
    }

    /**
     * 创建群组
     */
    async createGroup(orderId: string, memberIds: string[]): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.post<{ success: boolean }>(
                '/api/groups/create',
                { orderId, memberIds }
            );

            console.log(`[GroupApi] Group created: ${orderId}`);
            return response.data;

        } catch (error) {
            console.error('[GroupApi] Create group error:', error);
            throw error;
        }
    }

    /**
     * 添加成员到群组
     */
    async addGroupMember(orderId: string, userId: string): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.post<{ success: boolean }>(
                `/api/groups/${orderId}/members/add`,
                { userId }
            );

            console.log(`[GroupApi] Added member ${userId} to group ${orderId}`);
            return response.data;

        } catch (error) {
            console.error('[GroupApi] Add member error:', error);
            throw error;
        }
    }

    /**
     * 从群组移除成员
     */
    async removeGroupMember(orderId: string, userId: string): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.post<{ success: boolean }>(
                `/api/groups/${orderId}/members/remove`,
                { userId }
            );

            console.log(`[GroupApi] Removed member ${userId} from group ${orderId}`);
            return response.data;

        } catch (error) {
            console.error('[GroupApi] Remove member error:', error);
            throw error;
        }
    }
}