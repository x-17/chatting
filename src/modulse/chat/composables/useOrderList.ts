// chat/composables/useOrderList.ts

import { ref, computed } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { useOrderStore } from "../../orders/store/order.store";
import { mockService } from "../../mock/mock-service";
import type { Order as realOrder } from "../../orders/types/order.types";
import { OrderApiService } from "../../orders/services/order-api.service";

export function useOrderList() {
  const authStore = useAuthStore();
  const orderStore = useOrderStore();
  const activeOrderId = ref<string | null>(null);

  // 本地订单列表
  const loading = ref(false);

  // 从 Store 获取订单列表并转换为 ChatOrder 格式
  const orders = computed(() => {
    const myUserId =
      authStore.currentUserId ||
      sessionStorage.getItem("auth_current_user_id") ||
      "";

    return orderStore.orderList.map((order) => {
      const isBuyer = is_Buyer(myUserId, order);
      // 兼容字符串类型的 orderType
      const isGroup = Number(order.orderType) === 1;
      console.log(`[OrderList] Order ${order.orderId} type:`, order.orderType, 'isGroup:', isGroup);

      let otherParty;
      if (isGroup) {
        // For groups, "otherParty" is essentially the group itself for display purposes
        otherParty = {
          userId: order.orderId,
          dataName: order.dataName || "未命名群组",
          roleType: -1 // Special role for group
        };
      } else {
        otherParty = isBuyer
          ? order.participants.find((p) => p.roleType === 1)
          : order.participants.find((p) => p.roleType === 0);
      }

      return {
        id: order.orderId,
        title: order.dataName || "未命名订单",
        type: isBuyer ? "purchase" : ("sale" as "purchase" | "sale"),
        status:
          order.flag === 4 ? "active" : ("completed" as "active" | "completed"),
        otherParty: {
          id: String(otherParty?.userId || ""),
          name: otherParty?.dataName || "未知用户",
        },
        conversationId: order.orderId,
        conversationType: (isGroup ? "group" : "p2p") as
          | "p2p"
          | "group",
        unreadCount: order.metadata?.unreadCount || 0,
        lastMessageTime: order.metadata?.lastMessageTime,
        lastMessageContent: order.metadata?.lastMessageContent,
        metadata: order.metadata || { unreadCount: 0 },
      };
    });
  });

  let activeOrder = computed(() => {
    if (!activeOrderId.value) return null;
    return orders.value.find((o) => o.id === activeOrderId.value) || null;
  });

  const totalUnreadCount = computed(() => {
    return orders.value.reduce((sum, order) => sum + order.unreadCount, 0);
  });

  // 判断是否为买家
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

        // 将 Mock 数据存入 Store
        // 注意：Mock 数据类型可能与 realOrder 略有不同，这里假设兼容或需要转换
        // 如果 mockOrdersData 已经是 realOrder[] 类型，则直接使用
        orderStore.setOrders(mockOrdersData as unknown as realOrder[]);

        console.log("[useOrderList] Loaded mock orders into store:", mockOrdersData.length);
      } else {
        console.log("[useOrderList] Loading real orders");
        await orderStore.fetchMyOrders();
        console.log("[useOrderList] Loaded real orders into store");
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

    // 清除未读数
    await orderStore.updateOrderWithMessage(orderId, { unreadCount: 0 });
  }

  const purchaseActiveCount = computed(() =>
    orders.value.filter(
      (o) => o.type === "purchase" && o.status === "active"
    ).length
  );

  const saleActiveCount = computed(() =>
    orders.value.filter(
      (o) => o.type === "sale" && o.status === "active"
    ).length
  );

  return {
    orders,
    activeOrder,
    activeOrderId,
    totalUnreadCount,
    purchaseActiveCount,
    saleActiveCount,
    loading,
    loadOrders,
    selectOrder,
  };
}
