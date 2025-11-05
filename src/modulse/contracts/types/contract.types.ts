// contracts/types/contract.types.ts

export type ContractStatus =
    | 'draft'                // 草稿
    | 'pending_signatures'   // 待签署
    | 'signing'              // 签署中
    | 'completed'            // 已完成
    | 'rejected'             // 已拒绝
    | 'expired';             // 已过期

export interface SignatureRecord {
    signerId: string;
    signerName: string;
    signature: string;       // Base64签名
    signedAt: number;
    ipAddress?: string;
    deviceInfo?: string;
}

export interface ContractParticipant {
    userId: string;
    userName: string;
    role: 'buyer' | 'seller' | 'other';
    creditScore: number;     // 信誉分数
    signatureOrder: number;  // 签名顺序
    hasSigned: boolean;
    signatureRecord?: SignatureRecord;
}

export interface Contract {
    id: string;
    orderId: string;
    conversationId: string;
    conversationType: 'p2p' | 'group';  // 私聊还是群聊
    title: string;
    content: string;         // 合同文本内容
    fileId?: string;         // 关联的文件ID
    fileHash: string;        // SHA-256哈希

    participants: ContractParticipant[];
    currentSignerIndex: number;

    status: ContractStatus;

    createdBy: string;
    createdAt: number;
    lastModifiedAt: number;
    completedAt?: number;
    expiresAt?: number;

    metadata?: Record<string, any>;
}

// 服务器存储的合同
export interface PersistedContract {
    id: string;
    orderId: string;
    // conversationId: string;
    // conversationType: 'p2p' | 'group';
    fileHash: string;
    // participants: ContractParticipant[];
    currentSignerIndex: number;
    status: ContractStatus;
    signatures: SignatureRecord[];
    createdAt: number;
    completedAt?: number;
}