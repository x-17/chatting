// chat/types/chat.types.ts

import type { P2PMessage } from "../../signal/types/message.types";
import type { GroupMessage } from "../../groupchat/types/group-message.types";

export type ChatMessage = P2PMessage | GroupMessage;

export interface Order {
  id: string;
  title: string; // 订单标题
  type: "purchase" | "sale";
  status: "active" | "completed";
  otherParty: {
    id: string;
    name: string;
    avatar?: string;
  };
  conversationId: string; // 会话ID
  conversationType: "p2p" | "group";
  unreadCount: number; // 未读消息数
  lastMessageTime?: number; // 最后消息时间
  lastMessageContent?: string; // 最后消息内容
  amount?: number;
  currency?: string;
  createdAt?: number;
  metadata?: {
    unreadCount?: number;
    lastMessageTime?: number;
    lastMessageContent?: string;
    [key: string]: any;
  };
}

export interface Conversation {
  id: string;
  orderId: string;
  type: "p2p" | "group";
  participantIds: string[];
  messages: ChatMessage[];
}
