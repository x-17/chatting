// orders/services/order-api.service.ts
import {
  createAuthenticatedApiClient,
  type ApiResponse,
} from "../../utils/api-client.ts";
import type { Order, CreateOrderRequest } from "../types/order.types.ts";

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
      console.error("[OrderApi] Get order failed:", error);
      throw error;
    }
  }
  /**
   * 添加订单
   */
  async createOrder(bssOrderId: number): Promise<string> {
    try {
      const response = await this.apiClient.post<ApiResponse<string>>(
        "/order/add",
        bssOrderId
      );
      return response.data.msg;
    } catch (error) {
      console.error("[OrderApi] Create order failed:", error);
      throw error;
    }
  }
  /**
   * 获取我的订单列表
   */
  async getMyOrders(): Promise<Order[]> {
    try {
      const response = await this.apiClient.get<ApiResponse<Order[]>>(
        "/orders/queryOrders"
      );
      return response.data.data;
    } catch (error) {
      console.error("[OrderApi] Get my orders failed:", error);
      throw error;
    }
  }

  /**
   * 更新订单状态
   */
  async updateOrderStatus(
    orderId: string,
    flag: Order["flag"]
  ): Promise<boolean> {
    try {
      const response = await this.apiClient.post<ApiResponse<boolean>>(
        "/order/orderNotification",
        {
          orderId,
          flag,
        }
      );
      if (response.data.code === 1) {
        return response.data.data;
      } else {
        console.warn(
          "[OrderApi] Update order status failed:",
          response.data.msg
        );
        return false;
      }
    } catch (error) {
      console.error("[OrderApi] Update order status error:", error);
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
      console.error("[OrderApi] Get unread count failed:", error);
      return 0;
    }
  }

  /**
   * 批量获取多个订单的未读消息数
   */
  async batchGetUnreadCounts(
    orderIds: string[]
  ): Promise<Record<string, number>> {
    try {
      const response = await this.apiClient.post<{
        counts: Record<string, number>;
      }>("/api/orders/batch-unread-counts", { orderIds });

      return response.data.counts;
    } catch (error) {
      console.error("[OrderApi] Batch get unread counts failed:", error);
      return {};
    }
  }
}
