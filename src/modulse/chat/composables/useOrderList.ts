// chat/composables/useOrderList.ts

import { ref, computed, watch } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { useOrderStore } from "../../orders/store/order.store";
import { mockService } from "../../mock/mock-service";
import type { Order as ChatOrder } from "../types/chat.types";
import type { Order as realOrder } from "../../orders/types/order.types";
import { OrderApiService } from "../../orders/services/order-api.service";

export function useOrderList() {
  const authStore = useAuthStore();
  const orderStore = useOrderStore();
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

  // 监听 orderStore 的变化，同步订单列表中的未读数和最后消息信息
  watch(
    () => orderStore.orders,
    () => {
      // 遍历本地订单列表，更新每个订单的元数据
      ordersList.value.forEach((order) => {
        const storeOrder = orderStore.getOrderById(order.id);
        if (storeOrder && storeOrder.metadata) {
          order.unreadCount = storeOrder.metadata.unreadCount || 0;
          order.lastMessageTime = storeOrder.metadata.lastMessageTime;
          order.lastMessageContent = storeOrder.metadata.lastMessageContent;
        }
      });
    },
    { deep: true }
  );
  function is_Buyer(userId: string | number, order: realOrder): boolean {
    console.log("userId", userId);

    // 1. 校验订单的参与者列表是否有效（必须存在且为数组）
    if (!order?.participants || !Array.isArray(order.participants)) {
      return false; // 参与者列表无效，无法判断
    }

    // 2. 遍历参与者，寻找与 userId 匹配的项
    const matchedParticipant = order.participants.find((participant) => {
      // 统一数据类型（避免 string 与 number 匹配失败）
      return String(participant.userId) === String(userId);
    });
    console.log(matchedParticipant);
    console.log(!!matchedParticipant && matchedParticipant.roleType === 0);

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
          authStore.currentUserId || localStorage.getItem("auth_user_id") || "";

        ordersList.value = mockOrdersData.map((order) => {
          const isBuyer = is_Buyer(myUserId, order);
          const otherParty = isBuyer
            ? order.participants.find((p) => p.roleType === 1)
            : order.participants.find((p) => p.roleType === 0);

          return {
            id: order.orderId,
            title: order.dataName || "未命名订单",
            type: isBuyer ? "purchase" : ("sale" as "purchase" | "sale"),
            status:
              order.flag === 4
                ? "active"
                : ("completed" as "active" | "completed"),
            otherParty: {
              id: String(otherParty?.userId || ""),
              name: otherParty?.dataName || "未知用户",
            },
            conversationId: order.orderId,
            conversationType: order.orderType === 0 ? "p2p" : "group",
            unreadCount: 0, // 初始化为0，后续通过消息更新
            lastMessageTime: undefined,
            lastMessageContent: undefined,
            metadata: {
              unreadCount: 0,
            },
          };
        });

        console.log("[useOrderList] Loaded orders:", ordersList.value.length);
      } else {
        const orderApiService = new OrderApiService();
        console.log("[useOrderList] Loading real orders");
        const myUserId =
          authStore.currentUserId ||
          sessionStorage.getItem("auth_current_user_id") ||
          "";
        console.log("my-userid", myUserId);

        const res = await orderApiService.getMyOrders();
        ordersList.value = res.map((order) => {
          const isBuyer = is_Buyer(myUserId, order);
          const otherParty = isBuyer
            ? order.participants.find((p) => p.roleType === 1)
            : order.participants.find((p) => p.roleType === 0);

          return {
            id: order.orderId,
            title: order.dataName || "未命名订单",
            type: isBuyer ? "purchase" : ("sale" as "purchase" | "sale"),
            status:
              order.flag === 4
                ? "active"
                : ("completed" as "active" | "completed"),
            otherParty: {
              id: String(otherParty?.userId || ""),
              name: otherParty?.dataName || "未知用户",
            },
            conversationId: order.orderId,
            conversationType: order.orderType === 0 ? "p2p" : "group",
            unreadCount: 0, // 初始化为0，后续通过消息更新
            lastMessageTime: undefined,
            lastMessageContent: undefined,
            metadata: {
              unreadCount: 0,
            },
          };
        });
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
