// src/types/group-message.types.ts (或 src/e2ee/types/group-message.types.ts)

export type GroupMessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';
export type GroupMessageType = 'text' | 'file' | 'image' | 'keyDist' | 'userIn' | 'userOut';

/**
 * 前端使用的群组消息接口 (UI/本地存储)
 */
export interface GroupMessage {
    id: string;                          // 消息唯一ID
    type: GroupMessageType;              // 消息类型
    orderId: string;                     // 群组ID (订单ID)
    senderId: string;                    // 发送者ID
    content: string;                     // 消息内容（明文或元数据）
    encryptedContent?: any;              // 加密后的内容（ISenderKeyMessage）
    timestamp: number;                   // 本地时间戳
    status: GroupMessageStatus;          // 消息状态
    localId?: string;                    // 本地临时ID
    serverTimestamp?: number;            // 服务器时间戳
    metadata?: {
        fileId?: string;
        fileName?: string;
        fileSize?: number;
        mimeType?: string;
        memberName?: string;             // 成员名称
        [key: string]: any;
    };
}

/**
 */
export interface PersistedGroupMessage {
    id: string;
    orderId: string;
    senderId: string;
    encryptedContent: string;            // Base64 编码的加密内容
    messageType: GroupMessageType;
    timestamp: number;
    status: GroupMessageStatus;
    expiresAt?: number;                  // 过期时间
    metadata?: Record<string, any>;
}

/**
 * 群组密钥分发消息
 */
export interface GroupKeyDistribution {
    id: string;
    orderId: string;
    senderId: string;
    distributionMessage: string;         // Base64 编码的分发消息
    timestamp: number;
}