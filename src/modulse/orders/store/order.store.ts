// orders/store/order.store.ts

import { defineStore } from "pinia";
import { OrderApiService } from "../services/order-api.service.ts";
import type { Order } from "../types/order.types.ts";

interface OrderState {
  orders: Map<string, Order>; // orderId -> Order
  myOrderIds: string[]; // 我的订单ID列表
  loading: boolean;
  lastFetchTime: number;
}

export const useOrderStore = defineStore("order", {
  state: (): OrderState => ({
    orders: new Map(),
    myOrderIds: [],
    loading: false,
    lastFetchTime: 0,
  }),

  getters: {
    // 获取指定订单
    getOrderById:
      (state) =>
        (orderId: string): Order | undefined => {
          return state.orders.get(orderId);
        },

    // 获取所有订单列表
    orderList: (state): Order[] => {
      return state.myOrderIds
        .map((id) => state.orders.get(id))
        .filter((order): order is Order => order !== undefined);
    },

    // 购买订单
    purchaseOrders: (state): Order[] => {
      // 1. 获取当前用户 ID（从 sessionStorage）
      const currentUserId = sessionStorage.getItem("auth_user_id");
      if (!currentUserId) {
        return []; // 未登录，返回空数组
      }

      // 2. 校验 orders 是否为有效 Map
      if (!(state.orders instanceof Map)) {
        return []; // 非 Map 类型，返回空数组
      }

      // 3. 遍历 Map 中的所有订单，筛选符合条件的订单
      const buyerOrders: Order[] = [];
      for (const order of state.orders.values()) {
        // 校验订单格式（必须包含有效的 participants 数组）
        if (
          !order ||
          !order.participants ||
          !Array.isArray(order.participants)
        ) {
          continue;
        }

        // 检查当前用户是否为该订单的买方（roleType: 0）
        const isBuyer = order.participants.some((participant) => {
          // 统一数据类型（sessionStorage 的值为字符串，后端 userId 可能为数字）
          return (
            String(participant.userId) === currentUserId &&
            participant.roleType === 0
          );
        });

        if (isBuyer) {
          buyerOrders.push(order);
        }
      }

      return buyerOrders;
    },

    // 出售订单
    saleOrders: (state): Order[] => {
      // 1. 获取当前用户 ID（从 sessionStorage）
      const currentUserId = sessionStorage.getItem("auth_user_id");
      if (!currentUserId) {
        return []; // 未登录，返回空数组
      }

      // 2. 校验 orders 是否为有效 Map
      if (!(state.orders instanceof Map)) {
        return []; // 非 Map 类型，返回空数组
      }

      // 3. 遍历 Map 中的所有订单，筛选符合条件的订单
      const sellerOrders: Order[] = [];
      for (const order of state.orders.values()) {
        // 校验订单格式（必须包含有效的 participants 数组）
        if (
          !order ||
          !order.participants ||
          !Array.isArray(order.participants)
        ) {
          continue;
        }

        // 检查当前用户是否为该订单的卖方（roleType: 1）
        const isSeller = order.participants.some((participant) => {
          // 统一数据类型（字符串 vs 数字），避免匹配误差
          return (
            String(participant.userId) === currentUserId &&
            participant.roleType === 1
          ); // 核心区别：卖方角色为 1
        });

        if (isSeller) {
          sellerOrders.push(order);
        }
      }

      return sellerOrders;
    },

    // 进行中的订单
    activeOrders: (state): Order[] => {
      return Array.from(state.orders.values()).filter(
        (order) => order.flag === 4
      );
    },

    // 已完成的订单
    completedOrders: (state): Order[] => {
      return Array.from(state.orders.values()).filter(
        (order) => order.flag === 3
      );
    },
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
        const my_orders = await apiService.getMyOrders();
        // 更新到 Map
        this.myOrderIds = [];
        my_orders.forEach((order) => {
          this.orders.set(order.orderId, order);
          this.myOrderIds.push(order.orderId);
        });

        this.lastFetchTime = now;

        // 批量获取未读数
        await this.updateUnreadCounts(my_orders.map((o) => o.orderId));
      } catch (error) {
        console.error("[OrderStore] Fetch orders failed:", error);
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
        this.orders.set(order.orderId, order);

        if (!this.myOrderIds.includes(order.orderId)) {
          this.myOrderIds.push(order.orderId);
        }

        return order;
      } catch (error) {
        console.error("[OrderStore] Fetch order failed:", error);
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
        orderIds.forEach((orderId) => {
          const order = this.orders.get(orderId);
          if (order && order.metadata) {
            order.metadata.unreadCount = counts[orderId] || 0;
          }
        });
      } catch (error) {
        console.error("[OrderStore] Update unread counts failed:", error);
      }
    },

    /**
     * 更新单个订单的未读数和最后消息信息
     */
    async updateOrderWithMessage(
      orderId: string,
      messageInfo: {
        unreadCount?: number;
        lastMessageTime?: number;
        lastMessageContent?: string;
      }
    ): Promise<void> {
      try {
        const order = this.orders.get(orderId);
        if (order) {
          if (!order.metadata) {
            order.metadata = {};
          }
          // 更新未读数（如果提供）
          if (messageInfo.unreadCount !== undefined) {
            order.metadata.unreadCount = messageInfo.unreadCount;
          }
          // 更新最后消息时间（如果提供）
          if (messageInfo.lastMessageTime !== undefined) {
            order.metadata.lastMessageTime = messageInfo.lastMessageTime;
          }
          // 更新最后消息内容（如果提供）
          if (messageInfo.lastMessageContent !== undefined) {
            order.metadata.lastMessageContent = messageInfo.lastMessageContent;
          }
        }
      } catch (error) {
        console.error("[OrderStore] Update order with message failed:", error);
      }
    },

    /**
     * 更新订单状态
     */
    async updateOrderStatus(
      orderId: string,
      status: Order["flag"]
    ): Promise<void> {
      try {
        const apiService = new OrderApiService();
        const res = await apiService.updateOrderStatus(orderId, status);
        const targetOrder = this.orders.get(orderId);

        // 3. 检查订单是否存在
        if (!targetOrder) {
          throw Error(`[OrderStore] Order with ID ${orderId} not found.`);
        }
        // 4. 修改 flag 字段（对象是引用类型，修改后 Map 中的值会自动更新）
        targetOrder.flag = status;
      } catch (error) {
        console.error("[OrderStore] Update order status failed:", error);
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
    },

    /**
     * 批量设置订单（用于 Mock 数据）
     */
    setOrders(orders: Order[]): void {
      this.orders.clear();
      this.myOrderIds = [];
      orders.forEach((order) => {
        this.orders.set(order.orderId, order);
        this.myOrderIds.push(order.orderId);
      });
    },
  },
});
