// chat/composables/useOrderList.ts

import { ref, computed } from 'vue';
import { useAuthStore } from '../../auth/services/auth.store';
import { mockService } from '../../mock/mock-service';
import type { Order as ChatOrder } from '../types/chat.types';

export function useOrderList() {
    const authStore = useAuthStore();
    const activeOrderId = ref<string | null>(null);

    // 本地订单列表
    const ordersList = ref<ChatOrder[]>([]);
    const loading = ref(false);

    const orders = computed(() => ordersList.value);

    const activeOrder = computed(() => {
        if (!activeOrderId.value) return null;
        return orders.value.find(o => o.id === activeOrderId.value) || null;
    });

    const totalUnreadCount = computed(() => {
        return orders.value.reduce((sum, order) => sum + order.unreadCount, 0);
    });

    async function loadOrders() {
        loading.value = true;
        try {
            // 🔧 使用 Mock 数据
            if (mockService.enabled) {
                console.log('[useOrderList] Loading mock orders');
                const mockOrdersData = await mockService.getMyOrders();

                // 转换为 ChatOrder 格式
                const myUserId = authStore.user?.id || localStorage.getItem('auth_user_id') || '';

                ordersList.value = mockOrdersData.map(order => {
                    const isBuyer = order.buyerId === myUserId;
                    const otherParty = isBuyer
                        ? order.participants.find(p => p.role === 'seller')
                        : order.participants.find(p => p.role === 'buyer');

                    return {
                        id: order.id,
                        title: order.title,
                        type: isBuyer ? 'purchase' : 'sale' as 'purchase' | 'sale',
                        status: order.status === 'active' ? 'active' : 'completed' as 'active' | 'completed',
                        otherParty: {
                            id: otherParty?.userId || '',
                            name: otherParty?.userName || '未知用户',
                        },
                        conversationId: order.conversationId,
                        conversationType: order.conversationType,
                        amount: order.amount,
                        currency: order.currency,
                        createdAt: order.createdAt,
                        lastMessageTime: order.metadata?.lastMessageTime,
                        lastMessageContent: order.metadata?.lastMessageContent,
                        unreadCount: order.metadata?.unreadCount || 0
                    };
                });

                console.log('[useOrderList] Loaded orders:', ordersList.value.length);
            }
        } catch (error) {
            console.error('[useOrderList] Load orders failed:', error);
        } finally {
            loading.value = false;
        }
    }

    async function selectOrder(orderId: string) {
        console.log('[useOrderList] Selecting order:', orderId);
        activeOrderId.value = orderId;
    }

    return {
        orders,
        activeOrder,
        activeOrderId,
        totalUnreadCount,
        loading,
        loadOrders,
        selectOrder
    };
}