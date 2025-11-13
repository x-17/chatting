// orders/services/order.service.ts

import { OrderApiService } from "./order-api.service";
import { getEnhancedP2PRouter } from "../../signal/services/p2p-message-router.enhanced";
import { getEnhancedGroupRouter } from "../../groupchat/services/enhanced-group-message-router";
import type { Order, CreateOrderRequest } from "../types/order.types";

/**
 * 订单业务逻辑服务
 * 封装订单与会话、消息的关联逻辑
 */
export class OrderService {
  private apiService: OrderApiService;
  private myUserId: string;

  constructor(userId: string) {
    this.myUserId = userId;
    this.apiService = new OrderApiService();
  }

  /**
   * 创建订单并自动初始化会话
   */
  async createOrderWithConversation(data: CreateOrderRequest): Promise<{
    order: Order;
    conversationReady: boolean;
  }> {
    try {
      console.log("[OrderService] Creating order with conversation");

      // 1. 创建订单
      const order = await this.apiService.createOrder(data);

      // 2. 根据会话类型初始化路由器
      let conversationReady = false;

      if (order.conversationType === "p2p") {
        const p2pRouter = getEnhancedP2PRouter(this.myUserId);
        await p2pRouter.init();
        conversationReady = true;
      } else if (order.conversationType === "group") {
        const groupRouter = getEnhancedGroupRouter(this.myUserId);
        const participantIds = order.participants.map((p) => p.userId);
        await groupRouter.init(participantIds);
        conversationReady = true;
      }

      console.log("[OrderService] Order created and conversation initialized");

      return {
        order,
        conversationReady,
      };
    } catch (error) {
      console.error(
        "[OrderService] Create order with conversation failed:",
        error
      );
      throw error;
    }
  }

  /**
   * 获取订单并确保会话已建立
   */
  async getOrderWithConversation(orderId: string): Promise<{
    order: Order;
    conversationReady: boolean;
  }> {
    try {
      // 获取订单信息
      const order = await this.apiService.getOrder(orderId);

      // 确保会话已建立
      const conversationReady = await this.ensureConversation(order);

      return {
        order,
        conversationReady,
      };
    } catch (error) {
      console.error(
        "[OrderService] Get order with conversation failed:",
        error
      );
      throw error;
    }
  }

  /**
   * 确保订单的会话已建立
   */
  private async ensureConversation(order: Order): Promise<boolean> {
    try {
      if (order.conversationType === "p2p") {
        const p2pRouter = getEnhancedP2PRouter(this.myUserId);
        await p2pRouter.init();

        // 确保与对方的加密会话已建立
        const otherUserId =
          order.buyerId === this.myUserId ? order.sellerId : order.buyerId;

        // ensureSession 会在内部检查是否已存在会话
        const { e2eeService } = await import(
          "../../signal/services/e2ee.service"
        );
        await e2eeService.ensureSession(this.myUserId, otherUserId);

        return true;
      } else if (order.conversationType === "group") {
        const groupRouter = getEnhancedGroupRouter(this.myUserId);
        await groupRouter.init([order.conversationId]);
        return true;
      }

      return false;
    } catch (error) {
      console.error("[OrderService] Ensure conversation failed:", error);
      return false;
    }
  }

  /**
   * 检查订单是否可以发送消息
   */
  canSendMessage(order: Order): {
    allowed: boolean;
    reason?: string;
  } {
    if (order.status === "cancelled") {
      return {
        allowed: false,
        reason: "订单已取消，无法发送消息",
      };
    }

    if (order.status === "completed") {
      return {
        allowed: false,
        reason: "订单已完成，无法发送消息",
      };
    }

    if (order.status === "disputed") {
      return {
        allowed: false,
        reason: "订单存在争议，请联系客服处理",
      };
    }

    return { allowed: true };
  }

  /**
   * 检查订单是否可以创建合同
   */
  canCreateContract(order: Order): {
    allowed: boolean;
    reason?: string;
  } {
    if (order.status !== "active") {
      return {
        allowed: false,
        reason: "只有进行中的订单可以创建合同",
      };
    }

    // 检查是否已有未完成的合同
    if (order.contractIds && order.contractIds.length > 0) {
      // 这里可以进一步检查合同状态
      // 简化处理：如果已有合同ID，提示用户
      return {
        allowed: true, // 允许创建多个合同
        reason: "该订单已有关联合同",
      };
    }

    return { allowed: true };
  }

  /**
   * 标记订单消息为已读
   */
  async markOrderMessagesAsRead(orderId: string): Promise<void> {
    try {
      const order = await this.apiService.getOrder(orderId);

      if (order.conversationType === "p2p") {
        const p2pRouter = getEnhancedP2PRouter(this.myUserId);

        // 获取该订单会话的所有消息ID
        const otherUserId =
          order.buyerId === this.myUserId ? order.sellerId : order.buyerId;

        const messages = await p2pRouter.getConversationHistory(
          otherUserId,
          100
        );
        const unreadMessageIds = messages
          .filter((m) => m.senderId !== this.myUserId && m.status !== "read")
          .map((m) => m.id);

        if (unreadMessageIds.length > 0) {
          await p2pRouter.markAsRead(unreadMessageIds);
        }
      } else if (order.conversationType === "group") {
        const groupRouter = getEnhancedGroupRouter(this.myUserId);

        // 群聊消息标记为已读的逻辑
        // TODO: 如果需要实现群聊已读回执
      }
    } catch (error) {
      console.error("[OrderService] Mark messages as read failed:", error);
    }
  }

  /**
   * 获取订单对方的信息
   */
  getOtherParty(order: Order): {
    userId: string;
    userName: string;
    role: "buyer" | "seller";
  } | null {
    const isBuyer = order.buyerId === this.myUserId;

    const otherParty = order.participants.find(
      (p) => p.role === (isBuyer ? "seller" : "buyer")
    );

    if (!otherParty) return null;

    return {
      userId: otherParty.userId,
      userName: otherParty.userName,
      role: otherParty.role,
    };
  }

  /**
   * 格式化订单显示标题
   */
  formatOrderTitle(order: Order, maxLength = 30): string {
    if (order.title.length <= maxLength) {
      return order.title;
    }
    return order.title.substring(0, maxLength) + "...";
  }

  /**
   * 获取订单状态显示文本
   */
  getOrderStatusText(status: Order["status"]): string {
    const statusMap: Record<Order["status"], string> = {
      pending: "待确认",
      active: "进行中",
      completed: "已完成",
      cancelled: "已取消",
      disputed: "有争议",
    };
    return statusMap[status] || "未知状态";
  }

  /**
   * 获取订单状态颜色
   */
  getOrderStatusColor(status: Order["status"]): string {
    const colorMap: Record<Order["status"], string> = {
      pending: "#E6A23C",
      active: "#409EFF",
      completed: "#67C23A",
      cancelled: "#909399",
      disputed: "#F56C6C",
    };
    return colorMap[status] || "#909399";
  }

  /**
   * 计算订单的总金额（含手续费等）
   */
  calculateTotalAmount(order: Order): {
    goodsAmount: number;
    serviceFeePct: number;
    serviceFee: number;
    totalAmount: number;
  } {
    const goodsAmount = order.amount;
    const serviceFeePct = 0.02; // 2% 手续费（示例）
    const serviceFee = Math.round(goodsAmount * serviceFeePct * 100) / 100;
    const totalAmount = goodsAmount + serviceFee;

    return {
      goodsAmount,
      serviceFeePct,
      serviceFee,
      totalAmount,
    };
  }
}

// 工厂函数
const orderServices = new Map<string, OrderService>();

export function getOrderService(userId: string): OrderService {
  if (!orderServices.has(userId)) {
    orderServices.set(userId, new OrderService(userId));
  }
  return orderServices.get(userId)!;
}

export function clearAllOrderServices(): void {
  orderServices.clear();
}
