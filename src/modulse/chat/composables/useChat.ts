// chat/composables/useChat.ts

import { ref, computed } from "vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { mockService } from "../../mock/mock-service";
import type { ChatMessage, Order } from "../types/chat.types";

interface ChatState {
  conversations: Map<string, ChatMessage[]>;
  loading: Map<string, boolean>;
  hasMore: Map<string, boolean>;
}

export function useChat() {
  const authStore = useAuthStore();

  const state = ref<ChatState>({
    conversations: new Map(),
    loading: new Map(),
    hasMore: new Map(),
  });

  const currentConversationId = ref<string | null>(null);

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
          console.log("------------------------", mockMsgs);

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

    try {
      const messageId = `msg_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`;
      const myUserId =
        authStore.user?.id || localStorage.getItem("auth_user_id") || "";

      // 🔧 Mock 模式：直接添加消息到本地
      if (mockService.enabled) {
        const optimisticMessage: ChatMessage = {
          id: messageId,
          type: "text",
          senderId: myUserId,
          recipientId:
            order.conversationType === "p2p" ? order.otherParty.id : undefined,
          groupId:
            order.conversationType === "group"
              ? order.conversationId
              : undefined,
          content: content,
          timestamp: Date.now(),
          status: "sent", // Mock 模式直接显示为已发送
          __conversationType: order.conversationType,
        };

        addMessageToConversation(order.conversationId, optimisticMessage);
        console.log("[useChat] Message sent (mock)");
      }
    } catch (error) {
      console.error("[useChat] Send message failed:", error);
      throw error;
    }
  }

  /**
   * 发送文件消息（Mock 版本）
   */
  async function sendFile(order: Order, file: File): Promise<ChatMessage> {
    console.log("[useChat] Sending file:", file.name);

    try {
      const messageId = `msg_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`;
      const myUserId =
        authStore.user?.id || localStorage.getItem("auth_user_id") || "";

      // 🔧 Mock 模式：直接添加消息到本地
      if (mockService.enabled) {
        const optimisticMessage: ChatMessage = {
          id: messageId,
          type: "file",
          senderId: myUserId,
          recipientId:
            order.conversationType === "p2p" ? order.otherParty.id : undefined,
          groupId:
            order.conversationType === "group"
              ? order.conversationId
              : undefined,
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
    } catch (error) {
      console.error("[useChat] Send file failed:", error);
      throw error;
    }
  }
  /**
   * 发送合同文件消息（Mock 版本）
   */
  async function sendContractFile(
    order: Order,
    file: File
  ): Promise<ChatMessage> {
    console.log("[useChat] Sending file:", file.name);

    try {
      const messageId = `msg_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`;
      const myUserId =
        authStore.user?.id || localStorage.getItem("auth_user_id") || "";

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
            order.conversationType === "group"
              ? order.conversationId
              : undefined,
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
    } catch (error) {
      console.error("[useChat] Send file failed:", error);
      throw error;
    }
  }
  /**
   * 加载更多历史消息
   */
  async function loadMoreMessages(conversationId: string): Promise<void> {
    console.log("[useChat] Load more messages for:", conversationId);
    // Mock 模式暂不实现分页
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
    currentMessages,
    messagesLoading,
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
