// chat/composables/useChat.ts

import { ref, computed } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { mockService } from "../../mock/mock-service";
import type { ChatMessage, Order } from "../types/chat.types";
import { getEnhancedP2PRouter } from "../../signal/services/p2p-message-router.enhanced";
import { getGroupMessageRouter } from "../../groupchat/services/enhanced-group-message-router";
import { getMessagePersistenceService } from "../../signal/services/message-persistence.service";
import type { P2PMessage } from "../../signal/types/message.types";
import { ContractService } from "../../contracts/services/contract.service";
import type { GroupMessage } from "../../groupchat/types/group-message.types";

interface ChatState {
  conversations: Map<string, ChatMessage[]>;
  loading: Map<string, boolean>;
  hasMore: Map<string, boolean>;
}

export interface ContractDetails {
  amount: number;
  usagePeriod: number;
  usageStartTime: Date;
  usageEndTime: Date;
}

// 聊天状态
const state = ref<ChatState>({
  conversations: new Map(),
  loading: new Map(),
  hasMore: new Map(),
});

const currentConversationId = ref<string | null>(null);

export function useChat() {
  const authStore = useAuthStore();
  const getMyUserId = () =>
    authStore.currentUserId ||
    sessionStorage.getItem("auth_current_user_id") ||
    "";

  // 使用单例路由
  const getP2PRouter = () => getEnhancedP2PRouter(String(getMyUserId()));
  const getGroupRouter = () => getGroupMessageRouter(String(getMyUserId()));

  const currentMessages = computed(() => {
    if (!currentConversationId.value) return [];
    return state.value.conversations.get(currentConversationId.value) || [];
  });

  const messagesLoading = computed(() => {
    if (!currentConversationId.value) return false;
    return state.value.loading.get(currentConversationId.value) || false;
  });

  /**
   * 加载会话消息
   */
  async function loadConversationMessages(order: Order): Promise<void> {
    const conversationId = order.conversationId;
    currentConversationId.value = conversationId;

    if (order.conversationType === "group" && getMyUserId()) {
      // Mark as read locally
      const { GroupMessageSyncService } =
        await import("../../groupchat/services/group-message-sync.service");
      const syncService = new GroupMessageSyncService(String(getMyUserId()));
      syncService.markAsRead(conversationId);

      // Update store immediately to clear badge
      const { useOrderStore } = await import("../../orders/store/order.store");
      const orderStore = useOrderStore();
      orderStore.updateOrderWithMessage(order.id, { unreadCount: 0 });
    }

    console.log("[useChat] Loading messages for:", conversationId);

    // 如果已有缓存，直接返回
    if (state.value.conversations.has(conversationId)) {
      console.log("[useChat] Using cached messages");
      return;
    }

    state.value.loading.set(conversationId, true);

    try {
      let messages: ChatMessage[] = [];

      // 🔧 使用 Mock 数据
      if (mockService.enabled) {
        console.log("[useChat] Loading mock messages");

        if (order.conversationType === "p2p") {
          const mockMsgs = await mockService.getP2PMessages(
            order.conversationId,
          );

          messages = mockMsgs.map((msg) => ({
            ...msg,
            __conversationType: "p2p" as const,
          }));
        } else if (order.conversationType === "group") {
          const mockMsgs = await mockService.getGroupMessages(
            order.conversationId,
          );
          messages = mockMsgs.map((msg) => ({
            ...msg,
            __conversationType: "group" as const,
          }));
        }

        console.log("[useChat] Loaded messages:", messages.length);
      } else {
        // 重新获取当前用户ID，确保不为空
        const currentUserId =
          authStore.currentUserId ||
          sessionStorage.getItem("auth_current_user_id") ||
          "";

        if (order.conversationType === "group") {
          console.log("[useChat] Loading group messages from GroupRouter");
          const groupMsgs = await getGroupRouter().getHistory(
            order.conversationId,
          );
          messages = groupMsgs.map((msg) => ({
            ...msg,
            __conversationType: "group",
            senderId: msg.senderId,
          })) as ChatMessage[];
        } else {
          // 使用单例持久化服务
          const persistenceService = getMessagePersistenceService(
            String(currentUserId),
          );

          const Msgs = await persistenceService.getOrderMessages(order.id);
          console.log(Msgs);

          messages = Msgs.map((msg) => ({
            ...msg,
            __conversationType: (msg as any).groupId ? "group" : "p2p",
          }));
        }
      }

      // 按时间排序
      messages.sort((a, b) => a.timestamp - b.timestamp);

      state.value.conversations.set(conversationId, messages);
      state.value.hasMore.set(conversationId, messages.length >= 50);
    } catch (error) {
      console.error("[useChat] Load messages failed:", error);
      throw error;
    } finally {
      state.value.loading.set(conversationId, false);
    }
  }

  /**
   * 发送文本消息
   */
  async function sendMessage(order: Order, content: string): Promise<void> {
    console.log("[useChat] Sending message:", content);

    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    const myUserId = getMyUserId();

    // 🔧 Mock 模式：直接添加消息到本地
    if (mockService.enabled) {
      // Mock send logic not strictly needed here as we use optimistic update
    } else {
      console.log(
        `[useChat] Sending message to ${order.conversationType} order: ${order.conversationId}`,
      );
      let result: { success: boolean; error?: string } = { success: false };

      try {
        if (order.conversationType === "group") {
          console.log("[useChat] Using GroupMessageRouter");
          const msg = await getGroupRouter().sendGroupTextMessage(
            order.conversationId,
            content,
          );
          result = { success: msg.status === "sent" };
        } else {
          console.log("[useChat] Using EnhancedP2PMessageRouter");
          result = await getP2PRouter().sendMessage(
            order.id,
            content,
            "text",
            String(order.otherParty.id),
          );
        }
      } catch (e: any) {
        console.error("Send message error:", e);
        result = { success: false, error: e.message };
      }

      console.log("Send result", result);

      if (order.conversationType === "group") {
        console.log("[useChat] Group message handled by router event");
      } else {
        const optimisticMessage: ChatMessage = {
          id: messageId,
          type: "text",
          senderId: myUserId,
          orderId: order.id,
          recipientId:
            order.conversationType === "p2p" ? order.otherParty.id : undefined,
          groupId:
            order.conversationType === "group"
              ? order.conversationId
              : undefined,
          content: content,
          timestamp: Date.now(),
          status: result.success ? "sent" : "failed",
          __conversationType: order.conversationType,
        };
        addMessageToConversation(order.conversationId, optimisticMessage);
        console.log("optimisticMessage", optimisticMessage);
      }

      if (!result.success || result.error) {
        throw new Error(result.error || "发送失败（业务错误）");
      }
      console.log("[useChat] Message sent");
    }
  }

  /**
   * 发送文件消息
   */
  async function sendFile(order: Order, file: File): Promise<ChatMessage> {
    console.log("[useChat] Sending file:", file.name);

    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    const myUserId = getMyUserId();

    // 🔧 Mock 模式：直接添加消息到本地
    if (mockService.enabled) {
      const optimisticMessage: ChatMessage = {
        id: messageId,
        type: "file",
        senderId: myUserId,
        orderId: order.id, // Keeping orderId for compatibility
        content: `[文件] ${file.name}`,
        timestamp: Date.now(),
        status: "sent",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        },
        __conversationType: order.conversationType,
      };
      addMessageToConversation(order.conversationId, optimisticMessage);
      console.log("[useChat] File sent (mock)");
      return optimisticMessage;
    } else {
      let res;
      if (order.conversationType === "group") {
        try {
          const groupMsg = await getGroupRouter().sendGroupFileMessage(
            order.conversationId,
            file,
          );

          // Adapting GroupMessage to ChatMessage
          const adaptedMsg: ChatMessage = {
            ...groupMsg,
            metadata: {
              ...groupMsg.metadata,
              fileName: groupMsg.metadata?.fileName || file.name,
              fileSize: groupMsg.metadata?.fileSize || file.size,
              mimeType: groupMsg.metadata?.mimeType || file.type,
              previewUrl: file.type.startsWith("image/")
                ? URL.createObjectURL(file)
                : undefined,
            },
            __conversationType: "group",
          } as any;

          return adaptedMsg;
        } catch (e: any) {
          throw new Error(e.message || "Group file send failed");
        }
      } else {
        res = await getP2PRouter().sendFile(
          order.id,
          file,
          String(order.otherParty.id),
        );

        const optimisticMessage: ChatMessage = {
          id: messageId,
          type: "file",
          senderId: myUserId,
          orderId: order.id,
          recipientId:
            order.conversationType === "p2p"
              ? String(order.otherParty.id)
              : undefined,
          groupId:
            order.conversationType === "group"
              ? order.conversationId
              : undefined,
          content: `[文件] ${file.name}`,
          timestamp: Date.now(),
          status: res.success ? "sent" : "failed",
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            previewUrl: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : undefined,
          },
          __conversationType: order.conversationType,
        };
        addMessageToConversation(order.conversationId, optimisticMessage);

        if (!res.success || res.error) {
          throw new Error(res.error || "文件发送失败（业务错误）");
        }
        return optimisticMessage; // 返回成功的消息数据
      }
    }
  }

  /**
   * 发送合同文件消息
   */
  async function sendContractFile(
    order: Order,
    file: File,
    details: ContractDetails,
  ): Promise<ChatMessage> {
    console.log("[useChat] Sending file:", file.name);
    console.log("[useChat] Contract details:", details);

    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    const myUserId = getMyUserId();
    if (mockService.enabled) {
      const optimisticMessage: ChatMessage = {
        id: messageId,
        type: "contract",
        senderId: "123456",
        orderId: order.id, // Keeping orderId for compatibility
        content: `[文件] ${file.name}`,
        timestamp: Date.now(),
        status: "sent",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        },
        __conversationType: order.conversationType,
      };
      addMessageToConversation(order.conversationId, optimisticMessage);
      console.log("[useChat] File sent (mock)");
      return optimisticMessage;
    }

    const contractService = new ContractService(myUserId);

    const formatDate = (date: Date) => {
      const yyyy = date.getFullYear();
      const MM = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const HH = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      const ss = String(date.getSeconds()).padStart(2, "0");
      return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
    };

    const res = await getP2PRouter().sendFile(
      order.id,
      file,
      String(order.otherParty.id),
      "contract",
      async ({ fileId, signature }) => {
        if (!signature) {
          throw new Error("合同签名生成失败");
        }

        const contractRes = await contractService.uploadOrderQuote({
          orderId: order.id,
          amount: details.amount,
          usagePeriod: details.usagePeriod,
          usageStartTime: formatDate(details.usageStartTime),
          usageEndTime: formatDate(details.usageEndTime),
          fileId,
          signature,
        });

        if (contractRes.code !== 1) {
          throw new Error(String(contractRes.data || "合同签署失败"));
        }
        console.log("Contract sign response:", contractRes.data);
      },
    );

    if (!res.success || !res.data) {
      throw new Error(res.error || "合同签署失败");
    }

    const optimisticMessage: ChatMessage = {
      id: res.data.messageId || messageId,
      type: "contract",
      orderId: order.id,
      senderId: myUserId,
      recipientId:
        order.conversationType === "p2p"
          ? String(order.otherParty.id)
          : undefined,
      groupId:
        order.conversationType === "group" ? order.conversationId : undefined,
      content: `[文件] ${file.name}`,
      timestamp: Date.now(),
      status: "sent",
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        fileId: res.data.fileId,
        ...details,
      },
      __conversationType: order.conversationType,
    };

    addMessageToConversation(order.conversationId, optimisticMessage);
    return optimisticMessage; // 返回成功的消息数据
  }

  /**
   * 下载文件
   */
  async function downLoadFile(
    message: Extract<ChatMessage, P2PMessage> | GroupMessage | any,
    triggerDownload: boolean = true,
  ): Promise<string> {
    // Check if it is a group message
    if (message.__conversationType === "group" || message.groupId) {
      return await getGroupRouter().downloadGroupFile(
        message as GroupMessage,
        triggerDownload,
      );
    }

    let res;
    if (message.type === "contract") {
      res = await getP2PRouter().downloadOrderContract(
        message,
        triggerDownload,
      );
    } else {
      res = await getP2PRouter().downloadOrderFile(message, triggerDownload);
    }

    if (!res.success || res.error) {
      throw new Error(res.error || "文件下载失败（业务错误）");
    }
    if (res.success) {
      return res.data.downloadUrl; // 返回成功的消息数据
    }
    return "";
  }

  /**
   * 加载更多历史消息
   */
  async function loadMoreMessages(order: Order): Promise<void> {
    const conversationId = order.conversationId;
    console.log("[useChat] Load more messages for:", conversationId);

    if (state.value.loading.get(conversationId)) return;
    if (state.value.hasMore.get(conversationId) === false) return;

    state.value.loading.set(conversationId, true);

    try {
      const currentMsgs = state.value.conversations.get(conversationId) || [];
      const oldestMsg = currentMsgs[0];
      const beforeTimestamp = oldestMsg ? oldestMsg.timestamp : Date.now();

      // 注意: P2P 用的 sequence，Group 用的 timestamp
      const beforeSequence = oldestMsg
        ? (oldestMsg as P2PMessage).sequence
        : undefined;

      // Mock 模式暂不实现分页
      if (mockService.enabled) {
        // ... mock implementation if needed
      } else {
        let olderMsgs: any[] = [];

        if (order.conversationType === "group") {
          console.log("[useChat] Loading more group messages");
          olderMsgs = await getGroupRouter().getHistory(
            conversationId,
            20,
            beforeTimestamp,
          );
          olderMsgs = olderMsgs.map((msg) => ({
            ...msg,
            __conversationType: "group",
          }));
        } else {
          const currentUserId =
            authStore.currentUserId ||
            sessionStorage.getItem("auth_current_user_id") ||
            "";
          const persistenceService = getMessagePersistenceService(
            String(currentUserId),
          );

          olderMsgs = await persistenceService.getOrderMessages(
            order.id,
            20, // limit
            beforeSequence,
          );
          olderMsgs = olderMsgs.map((msg) => ({
            ...msg,
            __conversationType: "p2p" as const,
          }));
        }

        if (olderMsgs.length > 0) {
          // 合并消息并去重
          const existingIds = new Set(currentMsgs.map((m) => m.id));
          const uniqueNewMessages = olderMsgs.filter(
            (m) => !existingIds.has(m.id),
          ) as ChatMessage[];

          if (uniqueNewMessages.length > 0) {
            const allMessages = [...uniqueNewMessages, ...currentMsgs];
            // 再次排序确保顺序正确
            allMessages.sort((a, b) => a.timestamp - b.timestamp);
            state.value.conversations.set(conversationId, allMessages);
          }
        }

        // 如果获取的消息少于限制，说明没有更多了
        state.value.hasMore.set(conversationId, olderMsgs.length >= 20);
      }
    } catch (error) {
      console.error("[useChat] Load more messages failed:", error);
    } finally {
      state.value.loading.set(conversationId, false);
    }
  }

  /**
   * 添加消息到会话
   */
  function addMessageToConversation(
    conversationId: string,
    message: ChatMessage,
  ): void {
    const messages = state.value.conversations.get(conversationId) || [];

    const exists = messages.some((m) => m.id === message.id);
    console.log(
      `[useChat] addMessageToConversation: ${conversationId}, msgId: ${message.id}, exists: ${exists}`,
    );
    if (exists) {
      const index = messages.findIndex((m) => m.id === message.id);
      messages[index] = message;
    } else {
      messages.push(message);
    }

    messages.sort((a, b) => a.timestamp - b.timestamp);
    state.value.conversations.set(conversationId, [...messages]);
  }

  /**
   * 更新消息状态
   */
  function updateMessageStatus(
    conversationId: string,
    messageId: string,
    status: ChatMessage["status"],
  ): void {
    const messages = state.value.conversations.get(conversationId);
    if (!messages) return;

    const message = messages.find((m) => m.id === messageId);
    if (message) {
      message.status = status;
      state.value.conversations.set(conversationId, [...messages]);
    }
  }

  /**
   * 清空会话消息
   */
  function clearConversations(): void {
    state.value.conversations.clear();
    state.value.loading.clear();
    state.value.hasMore.clear();
    currentConversationId.value = null;
  }

  return {
    get EnhancedP2PMessageRouterInstance() {
      return getP2PRouter();
    },
    get GroupMessageRouterInstance() {
      return getGroupRouter();
    },
    currentMessages,
    messagesLoading,
    downLoadFile,
    loadConversationMessages,
    loadMoreMessages,
    sendMessage,
    sendFile,
    sendContractFile,
    addMessageToConversation,
    updateMessageStatus,
    clearConversations,
  };
}
