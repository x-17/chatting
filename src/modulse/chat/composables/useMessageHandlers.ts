// chat/composables/useMessageHandlers.ts

import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { getEnhancedP2PRouter } from "../../signal/services/p2p-message-router.enhanced";
import { getEnhancedGroupRouter } from "../../groupchat/services/enhanced-group-message-router";
import { useOrderStore } from "../../orders/store/order.store";
import { useChat } from "./useChat";
import type { P2PMessage } from "../../signal/types/message.types";
import type { GroupMessage } from "../../groupchat/types/group-message.types";

import { getMessagePersistenceService } from "../../signal/services/message-persistence.service";

export function useMessageHandlers(activeOrderIdRef?: Ref<string | null>) {
  const authStore = useAuthStore();
  const orderStore = useOrderStore();
  const { addMessageToConversation, updateMessageStatus } = useChat();




  let p2pRouter: ReturnType<typeof getEnhancedP2PRouter> | null = null;
  let groupRouter: ReturnType<typeof getEnhancedGroupRouter> | null = null;

  /**
   * 初始化消息监听
   */
  async function initializeHandlers(): Promise<void> {
    console.log("initializeHandlers");

    if (!authStore.user) {
      console.log("[MessageHandlers] Waiting for user authentication...");
      await new Promise<void>((resolve) => {
        const unwatch = watch(
          () => authStore.user,
          (user) => {
            if (user) {
              unwatch();
              resolve();
            }
          }
        );
      });
    }

    try {
      // 初始化P2P路由器
      p2pRouter = getEnhancedP2PRouter(authStore.currentUserId);
      console.log("p2pRouter", p2pRouter);

      await p2pRouter.init();

      // 初始化持久化服务
      const persistenceService = getMessagePersistenceService(authStore.currentUserId);
      await persistenceService.init();

      console.log("init p2pRouter and persistence");


      // 注册P2P消息处理器
      p2pRouter.onMessage((message: P2PMessage) => {
        handleP2PMessage(message);
      });

      // 注册P2P状态变化处理器
      // p2pRouter.onStatusChange((status: string) => {
      //   console.log("[MessageHandlers] P2P connection status:", status);

      //   if (status === "connected") {
      //     // 连接成功后同步离线消息
      //     syncOfflineMessages();
      //   }
      // });

      // 初始化群组路由器
      // groupRouter = getEnhancedGroupRouter(authStore.user.tenantId);
      const orderList = orderStore.orderList;
      // const groupIds = orderList
      //   .filter((order) => order.orderType === 1) // 1 is group
      //   .map((order) => order.orderId);

      // await groupRouter.init(groupIds);

      // // 注册群组消息处理器
      // groupRouter.onMessage((message: GroupMessage) => {
      //   handleGroupMessage(message);
      // });

      // 注册群组状态变化处理器
      // groupRouter.onStatusChange((status: string) => {
      //   console.log("[MessageHandlers] Group connection status:", status);
      // });

      console.log("[MessageHandlers] Handlers initialized successfully");
    } catch (error) {
      console.error("[MessageHandlers] Initialization failed:", error);
    }
  }

  /**
   * 处理P2P消息
   */
  function handleP2PMessage(message: P2PMessage): void {
    console.log("[MessageHandlers] Received P2P message:", message.id);

    // 找到对应的订单/会话
    const order = orderStore.getOrderById(message.orderId);

    if (!order) {
      console.warn("[MessageHandlers] Order not found for P2P message:", message.orderId);
      return;
    }

    // 添加到会话
    addMessageToConversation(order.orderId, {
      ...message,
      __conversationType: "p2p",
    } as any);

    // 检查是否是当前活动订单
    const isActive = activeOrderIdRef?.value === order.orderId;

    // 更新订单的未读数和最后消息信息
    const messageContent =
      message.type === "text" ? message.content : `[${message.type}]`;

    const currentUnread = (order.metadata as any)?.unreadCount || 0;
    const newUnreadCount = isActive ? 0 : currentUnread + 1;

    orderStore.updateOrderWithMessage(order.orderId, {
      unreadCount: newUnreadCount,
      lastMessageTime: message.timestamp,
      lastMessageContent: messageContent,
    });

    // 显示系统通知（如果在后台）
    if (document.hidden && message.senderId !== authStore.user!.id) {
      showNotification(message, order);
    }
  }

  /**
   * 处理群组消息
   */
  function handleGroupMessage(message: GroupMessage): void {
    console.log("[MessageHandlers] Received group message:", message.id);

    // 找到对应的订单/会话
    // GroupMessage 应该也有 orderId，或者 groupId 就是 orderId
    const orderId = (message as any).orderId || (message as any).groupId;
    const order = orderStore.getOrderById(orderId);

    if (!order) {
      console.warn("[MessageHandlers] Order not found for group message:", orderId);
      return;
    }

    // 添加到会话
    addMessageToConversation(order.orderId, {
      ...message,
      __conversationType: "group",
    } as any);

    // 检查是否是当前活动订单
    const isActive = activeOrderIdRef?.value === order.orderId;

    // 更新订单的未读数和最后消息信息
    const messageContent =
      message.type === "text" ? message.content : `[${message.type}]`;

    const currentUnread = (order.metadata as any)?.unreadCount || 0;
    const newUnreadCount = isActive ? 0 : currentUnread + 1;

    orderStore.updateOrderWithMessage(order.orderId, {
      unreadCount: newUnreadCount,
      lastMessageTime: message.timestamp,
      lastMessageContent: messageContent,
    });

    // 显示系统通知（如果在后台）
    if (document.hidden && message.senderId !== authStore.user!.id) {
      showNotification(message, order);
    }
  }

  /**
   * 同步离线消息
   */
  async function syncOfflineMessages(): Promise<void> {
    console.log("[MessageHandlers] Syncing offline messages");

    try {
      // 同步P2P离线消息
      if (p2pRouter) {
        await p2pRouter.syncOfflineMessages();
      }

      // 同步群组离线消息
      if (groupRouter) {
        await groupRouter.syncAllOfflineMessages();
      }

      // 刷新订单未读数
      const orderIds = orderStore.orderList.map((o) => o.orderId);
      await orderStore.updateUnreadCounts(orderIds);
    } catch (error) {
      console.error("[MessageHandlers] Sync offline messages failed:", error);
    }
  }

  /**
   * 显示系统通知
   */
  function showNotification(
    message: P2PMessage | GroupMessage,
    order: any
  ): void {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const senderName =
      message.senderId === authStore.user!.id
        ? "我"
        : order.dataName || message.senderId;

    const title = `${order.dataName}`;
    const body =
      message.type === "text" ? message.content : `[${message.type}]`;

    const notification = new Notification(title, {
      body: `${senderName}: ${body}`,
      icon: "/favicon.ico",
      tag: message.id,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  /**
   * 请求通知权限
   */
  async function requestNotificationPermission(): Promise<void> {
    if (!("Notification" in window)) {
      console.warn("[MessageHandlers] Notifications not supported");
      return;
    }

    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }

  /**
   * 清理处理器
   */
  function cleanup(): void {
    if (p2pRouter) {
      p2pRouter.disconnect();
    }
    if (groupRouter) {
      groupRouter.disconnect();
    }
  }

  // 生命周期钩子
  onMounted(async () => {
    await initializeHandlers();
    await requestNotificationPermission();
  });

  onUnmounted(() => {
    cleanup();
  });

  return {
    syncOfflineMessages,
    requestNotificationPermission,
  };
}
