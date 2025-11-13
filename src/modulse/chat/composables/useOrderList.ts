// chat/composables/useOrderList.ts

import { ref, computed } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { mockService } from "../../mock/mock-service";
import type { Order as ChatOrder } from "../types/chat.types";
import type { Order as realOrder } from "../../orders/types/order.types";
import { ContractApiService } from "../../contracts/services/contract-api.service";
import type { ApiResponse } from "../../utils/api-client";

export function useOrderList() {
  const authStore = useAuthStore();
  const contractApiService = new ContractApiService();
  const activeOrderId = ref<string | null>(null);

  // 本地订单列表
  const ordersList = ref<ChatOrder[]>([]);
  const loading = ref(false);

  const orders = computed(() => ordersList.value);

  let activeOrder = computed(() => {
    if (!activeOrderId.value) return null;
    return orders.value.find((o) => o.id === activeOrderId.value) || null;
  });

  const totalUnreadCount = computed(() => {
    return orders.value.reduce((sum, order) => sum + order.unreadCount, 0);
  });
  function is_Buyer(userId: string | number, order: realOrder): boolean {
    // 1. 校验订单的参与者列表是否有效（必须存在且为数组）
    if (!order?.participants || !Array.isArray(order.participants)) {
      return false; // 参与者列表无效，无法判断
    }

    // 2. 遍历参与者，寻找与 userId 匹配的项
    const matchedParticipant = order.participants.find((participant) => {
      // 统一数据类型（避免 string 与 number 匹配失败）
      return String(participant.userId) === String(userId);
    });

    // 3. 若找到匹配的参与者，且其 roleType 为 0（买方），则返回 true
    return !!matchedParticipant && matchedParticipant.roleType === 0;
  }
  async function loadOrders() {
    loading.value = true;
    try {
      // 🔧 使用 Mock 数据
      if (mockService.enabled) {
        console.log("[useOrderList] Loading mock orders");
        const mockOrdersData = await mockService.getMyOrders();

        // 转换为 ChatOrder 格式
        const myUserId =
          authStore.user?.id || localStorage.getItem("auth_user_id") || "";

        ordersList.value = mockOrdersData.map((order) => {
          const isBuyer = is_Buyer(myUserId, order);
          const otherParty = isBuyer
            ? order.participants.find((p) => p.roleType === 1)
            : order.participants.find((p) => p.roleType === 0);

          return {
            id: order.orderId,
            // title: order.title,
            type: isBuyer ? "purchase" : ("sale" as "purchase" | "sale"),
            status:
              order.flag === 4
                ? "active"
                : ("completed" as "active" | "completed"),
            otherParty: {
              id: otherParty?.userId || "",
              name: otherParty?.dataName || "未知用户",
            },
            conversationId: order.orderId,
            conversationType: order.orderType === 0 ? "p2p" : "group",
            // amount: order.amount,
            // currency: order.currency,
            // createdAt: order.createdAt,
            // lastMessageTime: order.metadata?.lastMessageTime,
            // lastMessageContent: order.metadata?.lastMessageContent,
            // unreadCount: order.metadata?.unreadCount || 0,
          };
        });

        console.log("[useOrderList] Loaded orders:", ordersList.value.length);
      }
    } catch (error) {
      console.error("[useOrderList] Load orders failed:", error);
    } finally {
      loading.value = false;
    }
  }
  async function selectOrder(orderId: string) {
    console.log("[useOrderList] Selecting order:", orderId);
    activeOrderId.value = orderId;
  }

  return {
    orders,
    activeOrder,
    activeOrderId,
    totalUnreadCount,
    loading,
    loadOrders,
    selectOrder,
  };
}
