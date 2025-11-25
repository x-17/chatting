// types/message.types.ts

export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "retrying";

// ✅ 统一的消息类型,包含协议层和业务层
export type MessageType =
  // 业务消息类型
  | "text"
  | "file"
  | "image"
  | "system"
  | "contract"
  // 协议消息类型
  | "ping"
  | "pong"
  | "ack";

/**
 * 统一的前端处理消息接口
 */
export interface P2PMessage {
  id: string; // 消息唯一ID
  type: MessageType; // 消息类型(统一字段)
  orderId: string; // 订单ID(必需字段)
  senderId: string; // 发送者ID
  recipientId: string; // 接收者ID
  content: string; // 消息内容(文本或元数据JSON)
  encryptedContent?: any; // 加密后的内容
  timestamp: number; // 时间戳
  status: MessageStatus; // 消息状态
  localId?: string; // 本地临时ID
  sequence: number; // 消息序列号(用于排序和去重)
  sendAttempts: number; // 发送尝试次数
  lastAttemptTime?: number; // 最后一次尝试时间
  nextRetryTime?: number; // 下次重试时间
  maxRetries: number; // 最大重试次数
  retryDelay: number; // 重试延迟基数(毫秒)
  deliveryConfirmed: boolean; // 是否已确认送达
  readConfirmed: boolean; // 是否已确认已读
  metadata?: {
    fileId?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    lastError?: string; // 最后一次错误信息
    errorCount?: number; // 错误计数
    firstSendTime?: number; // 首次发送时间
    finalSendTime?: number; // 最终发送成功时间
    [key: string]: any;
  };
}

/**
 * 网络传输的消息格式
 */
export interface PersistedP2PMessage {
  id: string;
  senderId: string;
  recipientId: string;
  orderId: string; // 订单ID(必需字段)
  encryptedContent: string; // Base64 编码的加密内容
  messageType: MessageType; // ✅ 统一使用 MessageType
  timestamp: number;
  status: MessageStatus;
  sequence: number;
  isSystem?: number; // ✅ 离线消息标识
  fileId?: string;
  sendAttempts?: number;
  maxRetries?: number;
  expiresAt?: number; // 过期时间
  metadata?: Record<string, any>;
}

/**
 * 订单会话信息
 */
export interface OrderSessionInfo {
  orderId: string;
  userId: string;
  otherUserId: string;
  lastMessageTime: number;
  unreadCount: number;
  messageCount: number;
  lastSequence?: number;
  pendingMessages: number; // 待发送消息数
  failedMessages: number; // 发送失败消息数
  retryQueueSize: number; // 重试队列大小
  orderTitle?: string; // 订单标题(可选)
  orderStatus?: string; // 订单状态(可选)
}

/**
 * ✅ 工具函数: 判断是否为协议消息
 */
export function isProtocolMessage(messageType: MessageType): boolean {
  return (
    messageType === "ping" || messageType === "pong" || messageType === "ack"
  );
}

/**
 * ✅ 工具函数: 判断是否为业务消息
 */
export function isBusinessMessage(messageType: MessageType): boolean {
  return !isProtocolMessage(messageType);
}

/**
 * ✅ 工具函数: 判断是否需要加密
 */
export function needsEncryption(type: MessageType): boolean {
  return isBusinessMessage(type);
}

/**
 * ✅ 工具函数: 判断是否需要持久化
 */
export function needsPersistence(type: MessageType): boolean {
  return isBusinessMessage(type);
}
