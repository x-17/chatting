// types/message.types.ts

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageType = 'text' | 'file' | 'image' | 'system';

/**
 * 统一的消息接口 - 基于订单
 */
export interface P2PMessage {
    id: string;                      // 消息唯一ID
    type: MessageType;               // 消息类型
    orderId: string;                 // 订单ID（必需字段）
    senderId: string;                // 发送者ID
    recipientId: string;             // 接收者ID
    content: string;                 // 消息内容（文本或元数据JSON）
    encryptedContent?: any;          // 加密后的内容
    timestamp: number;               // 时间戳
    status: MessageStatus;           // 消息状态
    localId?: string;                // 本地临时ID
    serverTimestamp?: number;        // 服务器时间戳
    metadata?: {
        fileId?: string;
        fileName?: string;
        fileSize?: number;
        mimeType?: string;
        [key: string]: any;
    };
}

/**
 * 持久化消息（存储在服务器）- 基于订单
 */
export interface PersistedP2PMessage {
    id: string;
    senderId: string;
    recipientId: string;
    orderId: string;                 // 订单ID（必需字段）
    encryptedContent: string;        // Base64 编码的加密内容
    messageType: MessageType;
    timestamp: number;
    status: MessageStatus;
    expiresAt?: number;              // 过期时间
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
    orderTitle?: string;             // 订单标题（可选）
    orderStatus?: string;            // 订单状态（可选）
}