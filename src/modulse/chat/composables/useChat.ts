// chat/composables/useChat.ts

import { ref, computed } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { mockService } from "../../mock/mock-service";
import type { ChatMessage, Order } from "../types/chat.types";
import { getEnhancedP2PRouter } from "../../signal/services/p2p-message-router.enhanced";
import { getMessagePersistenceService } from "../../signal/services/message-persistence.service";
import type { P2PMessage } from "../../signal/types/message.types";
import { ElMessage } from "element-plus";
import { ContractService } from "../../contracts/services/contract.service";

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
  const myUserId =
    authStore.currentUserId ||
    sessionStorage.getItem("auth_current_user_id") ||
    "";

  // 使用单例路由
  const EnhancedP2PMessageRouterInstance = getEnhancedP2PRouter(String(myUserId));

  // 移除 MessagePersistenceService 的初始化，改用 getMessagePersistenceService
  // 移除 onMessage 监听，由 useMessageHandlers 统一处理


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
            order.conversationId
          );
          // console.log("------------------------", mockMsgs);

          messages = mockMsgs.map((msg) => ({
            ...msg,
            __conversationType: "p2p" as const,
          }));
        } else if (order.conversationType === "group") {
          const mockMsgs = await mockService.getGroupMessages(
            order.conversationId
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

        // 使用单例持久化服务
        const persistenceService = getMessagePersistenceService(String(currentUserId));

        const Msgs = await persistenceService.getOrderMessages(
          order.id
        );
        console.log(Msgs);

        messages = Msgs.map((msg) => ({
          ...msg,
          __conversationType: "p2p" as const,
        }));
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
   * 发送文本消息（Mock 版本）
   */
  async function sendMessage(order: Order, content: string): Promise<void> {
    console.log("[useChat] Sending message:", content);

    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    const myUserId =
      authStore.currentUserId || localStorage.getItem("auth_user_id") || "";

    // 🔧 Mock 模式：直接添加消息到本地
    if (mockService.enabled) {
      addMessageToConversation(order.conversationId, optimisticMessage);
      console.log("[useChat] Message sent (mock)");
    } else {
      const res = await EnhancedP2PMessageRouterInstance.sendMessage(
        order.id,
        content,
        "text",
        String(order.otherParty.id)
      );
      console.log("res", res);

      const optimisticMessage: ChatMessage = {
        id: messageId,
        type: "text",
        senderId: myUserId,
        orderId: order.id,
        recipientId:
          order.conversationType === "p2p" ? order.otherParty.id : undefined,
        groupId:
          order.conversationType === "group" ? order.conversationId : undefined,
        content: content,
        timestamp: Date.now(),
        status: res.success ? "sent" : "failed", // Mock 模式直接显示为已发送
        __conversationType: order.conversationType,
      };
      addMessageToConversation(order.conversationId, optimisticMessage);
      console.log("optimisticMessage", optimisticMessage);

      if (!res.success || res.error) {
        throw new Error(res.error || "文件发送失败（业务错误）");
      }
      // return optimisticMessage; // 返回成功的消息数据
      console.log("[useChat] Message sent (via P2P router)");
    }

  }

  /**
   * 发送文件消息（Mock 版本）
   */
  async function sendFile(order: Order, file: File): Promise<ChatMessage> {
    console.log("[useChat] Sending file:", file.name);

    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    const myUserId =
      authStore.currentUserId || localStorage.getItem("auth_user_id") || "";

    // 🔧 Mock 模式：直接添加消息到本地
    if (mockService.enabled) {
      addMessageToConversation(order.conversationId, optimisticMessage);
      console.log("[useChat] File sent (mock)");
      return optimisticMessage;
    } else {
      let res = await EnhancedP2PMessageRouterInstance.sendFile(
        order.id,
        file,
        String(order.otherParty.id)
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
          order.conversationType === "group" ? order.conversationId : undefined,
        content: `[文件] ${file.name}`,
        timestamp: Date.now(),
        status: res.success ? "sent" : "failed",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
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
  /**
   * 发送合同文件消息（Mock 版本）
   */
  async function sendContractFile(
    order: Order,
    file: File,
    details: ContractDetails
  ): Promise<ChatMessage> {
    console.log("[useChat] Sending file:", file.name);
    console.log("[useChat] Contract details:", details);

    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
    const myUserId =
      authStore.currentUserId || localStorage.getItem("auth_user_id") || "";

    // 🔧 Mock 模式：直接添加消息到本地
    if (mockService.enabled) {
      const optimisticMessage: ChatMessage = {
        id: messageId,
        type: "contract",
        orderId: order.id,
        senderId: myUserId,
        recipientId:
          order.conversationType === "p2p" ? order.otherParty.id : undefined,
        groupId:
          order.conversationType === "group" ? order.conversationId : undefined,
        content: `[文件] ${file.name}`,
        timestamp: Date.now(),
        status: "sent",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          ...details,
        },
        __conversationType: order.conversationType,
      };

      addMessageToConversation(order.conversationId, optimisticMessage);
      console.log("[useChat] File sent (mock)");
      return optimisticMessage;
    } else {
      let ContractServiceInstance = new ContractService(myUserId);
      let res = await EnhancedP2PMessageRouterInstance.sendFile(
        order.id,
        file,
        String(order.otherParty.id),
        "contract"
      );
      const optimisticMessage: ChatMessage = {
        id: messageId,
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
        status: res.success ? "sent" : "failed",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          fileId: res.success ? res.data.fileId : undefined,
          ...details,
        },
        __conversationType: order.conversationType,
      };

      const formatDate = (date: Date) => {
        const yyyy = date.getFullYear();
        const MM = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        const HH = String(date.getHours()).padStart(2, "0");
        const mm = String(date.getMinutes()).padStart(2, "0");
        const ss = String(date.getSeconds()).padStart(2, "0");
        return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
      };

      const contract_res = await ContractServiceInstance.uploadOrderQuote({
        orderId: order.id,
        amount: details.amount,
        usagePeriod: details.usagePeriod,
        usageStartTime: formatDate(details.usageStartTime),
        usageEndTime: formatDate(details.usageEndTime),
        fileId: res.data.fileId,
      });
      ElMessage.success(contract_res.data);
      console.log("Contract sign response:", contract_res.data);
      addMessageToConversation(order.conversationId, optimisticMessage);
      if (!res.success || res.error) {
        throw new Error(res.error || "文件发送失败（业务错误）");
      }
      return optimisticMessage; // 返回成功的消息数据
    }
  }

  /**
   * 下载文件
   */
  async function downLoadFile(
    message: Extract<ChatMessage, P2PMessage>,
    triggerDownload: boolean = true
  ): Promise<string> {
    let res;
    if (message.type === "contract") {
      res = await EnhancedP2PMessageRouterInstance.downloadOrderContract(
        message,
        triggerDownload
      );
    } else {
      res = await EnhancedP2PMessageRouterInstance.downloadOrderFile(
        message
      );
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
      const beforeSequence = oldestMsg ? (oldestMsg as P2PMessage).sequence : undefined;

      // Mock 模式暂不实现分页
      if (mockService.enabled) {
        // ... mock implementation if needed
      } else {
        const currentUserId =
          authStore.currentUserId ||
          sessionStorage.getItem("auth_current_user_id") ||
          "";
        const persistenceService = getMessagePersistenceService(String(currentUserId));

        const olderMsgs = await persistenceService.getOrderMessages(
          order.id,
          20, // limit
          beforeSequence
        );

        if (olderMsgs.length > 0) {
          const newMessages = olderMsgs.map((msg) => ({
            ...msg,
            __conversationType: "p2p" as const,
          }));

          // 合并消息并去重
          const existingIds = new Set(currentMsgs.map(m => m.id));
          const uniqueNewMessages = newMessages.filter(m => !existingIds.has(m.id));

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
    message: ChatMessage
  ): void {
    const messages = state.value.conversations.get(conversationId) || [];

    const exists = messages.some((m) => m.id === message.id);
    if (exists) {
      const index = messages.findIndex((m) => m.id === message.id);
      messages[index] = message;
    } else {
      messages.push(message);
      // if (message.senderId == myUserId) {
      //   totalUnreadCount.value += 1;
      // }
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
    status: ChatMessage["status"]
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
    EnhancedP2PMessageRouterInstance,
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
