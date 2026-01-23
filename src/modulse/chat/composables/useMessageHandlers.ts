import { onMounted, onUnmounted, watch, type Ref, ref, computed } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { getEnhancedP2PRouter } from "../../signal/services/p2p-message-router.enhanced";
import { getGroupMessageRouter } from "../../groupchat/services/enhanced-group-message-router";
import { getMessageDispatcher } from "../../signal/services/message-dispatcher";
import { useOrderStore } from "../../orders/store/order.store";
import { useChat } from "./useChat";
import { getWebSocketManager, type WebSocketStatus } from "../../signal/services/websocket-manager";
import type { P2PMessage } from "../../signal/types/message.types";
import type { GroupMessage } from "../../groupchat/types/group-message.types";

import { groupManagementService } from "../../groupchat/services/group-management-service";
import { getMessagePersistenceService } from "../../signal/services/message-persistence.service";
import { GroupMessageSyncService } from "../../groupchat/services/group-message-sync.service";

export function useMessageHandlers(activeOrderIdRef?: Ref<string | null>) {
  const authStore = useAuthStore();
  const orderStore = useOrderStore();
  const { addMessageToConversation } = useChat();

  const isConnected = ref(false); // ✅ Reactive connection state

  let p2pRouter: ReturnType<typeof getEnhancedP2PRouter> | null = null;
  let groupRouter: ReturnType<typeof getGroupMessageRouter> | null = null;
  let wsManager: ReturnType<typeof getWebSocketManager> | null = null;


  /**
   * 初始化消息监听
   */
  async function initializeHandlers(): Promise<void> {
    console.log("initializeHandlers");

    if (!authStore.user) {
      console.log("[MessageHandlers] Waiting for user authentication...");
      await new Promise<void>((resolve) => {
        let timeoutId: number;

        const unwatch = watch(
          () => authStore.user,
          (user) => {
            if (user) {
              unwatch();
              clearTimeout(timeoutId);
              resolve();
            }
          }
        );

        // ✅ 5秒超时防止无限等待
        timeoutId = window.setTimeout(() => {
          console.warn("[MessageHandlers] Auth wait timed out");
          unwatch();
          resolve();
        }, 5000);
      });
    }

    if (!authStore.currentUserId) {
      console.error("[MessageHandlers] Cannot initialize handlers: User not authenticated (currentUserId is null)");
      return;
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

      // ✅ Initialize Dispatcher (registers unified listeners)
      const dispatcher = getMessageDispatcher(authStore.currentUserId);
      dispatcher.initialize();

      // ✅ Initialize Group Router (registers key distribution listeners)
      groupRouter = getGroupMessageRouter(authStore.currentUserId);
      await groupRouter.initialize();

      // ✅ SETUP DEPENDENCY INJECTION (Glue Code)
      const messageSender = {
        // Used by GroupManagement to reply to key requests or ask for keys
        sendKeyRequest: async (targetUserId: string, orderId: string) => {
          if (!p2pRouter) throw new Error('P2P Router not initialized');
          await p2pRouter.sendKeyRequest(targetUserId, orderId);
        },
        sendKeyToUser: async (targetUserId: string, distMsg: any, orderId: string) => {
          if (!p2pRouter) throw new Error('P2P Router not initialized');
          await p2pRouter.sendKeyDistribution(targetUserId, distMsg, orderId);
        },
        // Used for group messages (GroupRouter handles this internally usually, but interface requires it)
        sendGroupMessage: async (orderId: string, content: string, type: any) => {
          // GroupRouter calls API directly usually
          return Promise.resolve({ success: true, messageId: 'mock' });
        },
        sendGroupFileMessage: async () => Promise.resolve({ success: true, messageId: 'mock' }),
        sendToGroup: async (orderId: string, payload: any) => { /* mock */ }
      };

      // 1. Inject into GroupManagementService
      groupManagementService.setMessageSender(messageSender);

      // 2. Inject into GroupRouter (this registers the onKeyUpdated callback!)
      // @ts-ignore
      groupRouter.injectMessageSender(messageSender);

      // 3. Connect P2P Router events to Group Router
      // @ts-ignore
      groupRouter.setupP2PKeyDistribution(p2pRouter!);

      console.log("[MessageHandlers] Wiring complete: P2P -> GroupRouter -> Management");

      // ✅ SETUP WEBSOCKET MANAGER & LISTENERS
      wsManager = getWebSocketManager(authStore.currentUserId);

      // Update reactive state on status change
      wsManager.onStatusChange((status: WebSocketStatus) => {
        console.log("[MessageHandlers] WebSocket status changed:", status);
        isConnected.value = status === 'connected';
      });

      // Initial status check
      isConnected.value = wsManager.isConnected();

      // ✅ FINALLY CONNECT
      console.log("[MessageHandlers] Listeners registered. Connecting WebSocket...");
      wsManager.connect();

      // ✅ Wait for WebSocket to be fully connected before syncing groups
      // This is critical because syncGroups triggers key distribution which needs an active connection
      const waitForWsConnection = new Promise<void>((resolve) => {
        if (wsManager?.isConnected()) {
          resolve();
          return;
        }

        let resolved = false;
        const cleanup = () => { resolved = true; };

        // Register listener
        wsManager?.onStatusChange((status) => {
          if (status === 'connected' && !resolved) {
            cleanup();
            resolve();
          }
        });

        // Fallback timeout
        setTimeout(() => {
          if (!resolved) {
            console.warn("[MessageHandlers] WebSocket connection wait timed out, continuing anyway...");
            cleanup();
            resolve();
          }
        }, 5000);
      });

      await waitForWsConnection;

      // ✅ Now safe to sync groups/keys
      if (groupRouter) {
        console.log("[MessageHandlers] WebSocket connected, syncing groups...");
        await groupRouter.syncGroups();
      }



      // 注册群组消息处理器
      groupRouter.onMessage((message: GroupMessage) => {
        handleGroupMessage(message);
      });

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
    console.log("[MessageHandlers] Received group message:", message);

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
        // await p2pRouter.syncOrderOfflineMessages(); // Comment out until verified or fixed
      }

      // 同步群组离线消息
      const currentUserId = authStore.currentUserId || sessionStorage.getItem("auth_current_user_id");
      if (currentUserId) {
        // 使用 GroupMessageSyncService 拉取离线消息
        const syncService = new GroupMessageSyncService(currentUserId);

        // 获取所有群组订单ID
        const groupOrderIds = orderStore.orderList
          .filter(order => Number(order.orderType) === 1)
          .map(order => order.orderId);

        if (groupOrderIds.length > 0) {
          // 1. Fetch new messages
          await syncService.syncAllGroupsOfflineMessages(groupOrderIds);

          // 2. Recalculate unread counts from DB (Source of Truth) using "Last Read" logic
          await syncService.updateAllGroupUnreadCounts(orderStore);
        }
      }

      // 刷新订单未读数 (从后端API获取，作为兜底)
      // const orderIds = orderStore.orderList.map((o) => o.orderId);
      // await orderStore.updateUnreadCounts(orderIds);
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
    // groupRouter.disconnect(); // Not implemented yet
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
    initializeHandlers, // ✅ Export initialization function
    isWebSocketConnected: computed(() => isConnected.value) // ✅ Expose connection status
  };
}
