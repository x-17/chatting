// orders/store/order.store.ts

import { defineStore } from 'pinia';
import { OrderApiService } from '../services/order-api.service.ts';
import type { Order } from '../types/order.types.ts';

interface OrderState {
    orders: Map<string, Order>;     // orderId -> Order
    myOrderIds: string[];            // 我的订单ID列表
    loading: boolean;
    lastFetchTime: number;
}

export const useOrderStore = defineStore('order', {
    state: (): OrderState => ({
        orders: new Map(),
        myOrderIds: [],
        loading: false,
        lastFetchTime: 0
    }),

    getters: {
        // 获取指定订单
        getOrderById: (state) => (orderId: string): Order | undefined => {
            return state.orders.get(orderId);
        },

        // 获取所有订单列表
        orderList: (state): Order[] => {
            return state.myOrderIds
                .map(id => state.orders.get(id))
                .filter((order): order is Order => order !== undefined);
        },

        // 购买订单
        purchaseOrders: (state): Order[] => {
            return Array.from(state.orders.values()).filter(order => {
                const myUserId = localStorage.getItem('auth_user_id') || '';
                return order.buyerId === myUserId;
            });
        },

        // 出售订单
        saleOrders: (state): Order[] => {
            return Array.from(state.orders.values()).filter(order => {
                const myUserId = localStorage.getItem('auth_user_id') || '';
                return order.sellerId === myUserId;
            });
        },

        // 进行中的订单
        activeOrders: (state): Order[] => {
            return Array.from(state.orders.values())
                .filter(order => order.status === 'active');
        },

        // 已完成的订单
        completedOrders: (state): Order[] => {
            return Array.from(state.orders.values())
                .filter(order => order.status === 'completed');
        }
    },

    actions: {
        /**
         * 加载我的订单列表
         */
        async fetchMyOrders(force = false): Promise<void> {
            // 5分钟内不重复请求
            const now = Date.now();
            if (!force && now - this.lastFetchTime < 5 * 60 * 1000) {
                return;
            }

            this.loading = true;

            try {
                const apiService = new OrderApiService();
                const { orders } = await apiService.getMyOrders({
                    type: 'all',
                    status: 'all',
                    limit: 100
                });

                // 更新到 Map
                this.myOrderIds = [];
                orders.forEach(order => {
                    this.orders.set(order.id, order);
                    this.myOrderIds.push(order.id);
                });

                this.lastFetchTime = now;

                // 批量获取未读数
                await this.updateUnreadCounts(orders.map(o => o.id));

            } catch (error) {
                console.error('[OrderStore] Fetch orders failed:', error);
                throw error;
            } finally {
                this.loading = false;
            }
        },

        /**
         * 获取单个订单
         */
        async fetchOrder(orderId: string): Promise<Order> {
            try {
                const apiService = new OrderApiService();
                const order = await apiService.getOrder(orderId);

                // 更新到 Map
                this.orders.set(order.id, order);

                if (!this.myOrderIds.includes(order.id)) {
                    this.myOrderIds.push(order.id);
                }

                return order;
            } catch (error) {
                console.error('[OrderStore] Fetch order failed:', error);
                throw error;
            }
        },

        /**
         * 更新订单的未读消息数
         */
        async updateUnreadCounts(orderIds: string[]): Promise<void> {
            if (orderIds.length === 0) return;

            try {
                const apiService = new OrderApiService();
                const counts = await apiService.batchGetUnreadCounts(orderIds);

                // 更新每个订单的未读数
                orderIds.forEach(orderId => {
                    const order = this.orders.get(orderId);
                    if (order && order.metadata) {
                        order.metadata.unreadCount = counts[orderId] || 0;
                    }
                });
            } catch (error) {
                console.error('[OrderStore] Update unread counts failed:', error);
            }
        },

        /**
         * 更新单个订单的未读数
         */
        async updateOrderUnreadCount(orderId: string): Promise<void> {
            try {
                const apiService = new OrderApiService();
                const count = await apiService.getOrderUnreadCount(orderId);

                const order = this.orders.get(orderId);
                if (order) {
                    if (!order.metadata) {
                        order.metadata = {};
                    }
                    order.metadata.unreadCount = count;
                }
            } catch (error) {
                console.error('[OrderStore] Update order unread count failed:', error);
            }
        },

        /**
         * 更新订单状态
         */
        async updateOrderStatus(orderId: string, status: Order['status']): Promise<void> {
            try {
                const apiService = new OrderApiService();
                const updatedOrder = await apiService.updateOrderStatus(orderId, status);

                this.orders.set(orderId, updatedOrder);
            } catch (error) {
                console.error('[OrderStore] Update order status failed:', error);
                throw error;
            }
        },

        /**
         * 清空订单缓存
         */
        clearOrders(): void {
            this.orders.clear();
            this.myOrderIds = [];
            this.lastFetchTime = 0;
        }
    }
});