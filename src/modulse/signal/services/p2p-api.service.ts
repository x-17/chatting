// services/p2p-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { PersistedP2PMessage } from '../types/message.types';

/**
 * P2P 消息 HTTP API 服务（基于订单）
 */
export class P2PApiService {
    private apiClient = createAuthenticatedApiClient();

    /**
     * 发送消息到服务器（用于离线用户）- 基于订单
     */
    async sendMessage(message: PersistedP2PMessage): Promise<{ success: boolean; messageId: string; serverTimestamp: number }> {
        try {
            const response = await this.apiClient.post<{
                success: boolean;
                messageId: string;
                serverTimestamp: number;
            }>('/api/p2p/messages/send', message);

            console.log(`[P2PApi] Order message sent for order ${message.orderId}: ${message.id}`);
            return response.data;

        } catch (error) {
            console.error('[P2PApi] Send order message error:', error);
            throw error;
        }
    }

    /**
     * 获取离线消息 - 支持按订单过滤
     */
    async getOfflineMessages(since?: number, orderId?: string): Promise<PersistedP2PMessage[]> {
        try {
            const params: any = {};
            if (since) params.since = since;
            if (orderId) params.orderId = orderId;

            const response = await this.apiClient.get<{
                success: boolean;
                messages: PersistedP2PMessage[];
            }>('/api/p2p/messages/offline', { params });

            console.log(`[P2PApi] Retrieved ${response.data.messages.length} offline messages${orderId ? ` for order ${orderId}` : ''}`);
            return response.data.messages;

        } catch (error) {
            console.error('[P2PApi] Get offline messages error:', error);
            return [];
        }
    }

    /**
     * 更新消息状态（已送达/已读）
     */
    async updateMessageStatus(messageId: string, status: 'delivered' | 'read'): Promise<void> {
        try {
            await this.apiClient.put(`/api/p2p/messages/${messageId}/status`, { status });
            console.log(`[P2PApi] Updated message ${messageId} to ${status}`);
        } catch (error) {
            console.error('[P2PApi] Update status error:', error);
            throw error;
        }
    }

    /**
     * 批量更新消息状态
     */
    async batchUpdateStatus(messageIds: string[], status: 'delivered' | 'read'): Promise<void> {
        try {
            await this.apiClient.post('/api/p2p/messages/batch-status', {
                messageIds,
                status
            });
            console.log(`[P2PApi] Batch updated ${messageIds.length} messages to ${status}`);
        } catch (error) {
            console.error('[P2PApi] Batch update error:', error);
            throw error;
        }
    }

    /**
     * 获取订单的聊天历史（从服务器）
     */
    async getOrderMessages(orderId: string, since?: number): Promise<PersistedP2PMessage[]> {
        try {
            const params: any = { orderId };
            if (since) params.since = since;

            const response = await this.apiClient.get<{
                success: boolean;
                messages: PersistedP2PMessage[];
            }>('/api/p2p/messages/order', { params });

            console.log(`[P2PApi] Retrieved ${response.data.messages.length} messages for order ${orderId}`);
            return response.data.messages;

        } catch (error) {
            console.error(`[P2PApi] Get order messages error for ${orderId}:`, error);
            return [];
        }
    }
}