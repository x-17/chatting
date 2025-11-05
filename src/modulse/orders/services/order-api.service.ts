// orders/services/order-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client.ts';
import type { Order, CreateOrderRequest } from '../types/order.types.ts';

export class OrderApiService {
    private apiClient = createAuthenticatedApiClient();

    /**
     * 获取订单详情
     */
    async getOrder(orderId: string): Promise<Order> {
        try {
            const response = await this.apiClient.get<{ order: Order }>(
                `/api/orders/${orderId}`
            );
            return response.data.order;
        } catch (error) {
            console.error('[OrderApi] Get order failed:', error);
            throw error;
        }
    }

    /**
     * 获取我的订单列表
     */
    async getMyOrders(params?: {
        type?: 'purchase' | 'sale' | 'all';
        status?: 'active' | 'completed' | 'all';
        page?: number;
        limit?: number;
    }): Promise<{ orders: Order[]; total: number }> {
        try {
            const response = await this.apiClient.get<{
                orders: Order[];
                total: number;
            }>('/api/orders/my', { params });

            return response.data;
        } catch (error) {
            console.error('[OrderApi] Get my orders failed:', error);
            throw error;
        }
    }

    /**
     * 更新订单状态
     */
    async updateOrderStatus(
        orderId: string,
        status: Order['status']
    ): Promise<Order> {
        try {
            const response = await this.apiClient.put<{ order: Order }>(
                `/api/orders/${orderId}/status`,
                { status }
            );
            return response.data.order;
        } catch (error) {
            console.error('[OrderApi] Update order status failed:', error);
            throw error;
        }
    }

    /**
     * 获取订单的未读消息数
     */
    async getOrderUnreadCount(orderId: string): Promise<number> {
        try {
            const response = await this.apiClient.get<{ count: number }>(
                `/api/orders/${orderId}/unread-count`
            );
            return response.data.count;
        } catch (error) {
            console.error('[OrderApi] Get unread count failed:', error);
            return 0;
        }
    }

    /**
     * 批量获取多个订单的未读消息数
     */
    async batchGetUnreadCounts(orderIds: string[]): Promise<Record<string, number>> {
        try {
            const response = await this.apiClient.post<{
                counts: Record<string, number>
            }>('/api/orders/batch-unread-counts', { orderIds });

            return response.data.counts;
        } catch (error) {
            console.error('[OrderApi] Batch get unread counts failed:', error);
            return {};
        }
    }
}