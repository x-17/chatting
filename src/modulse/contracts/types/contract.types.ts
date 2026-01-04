// contracts/types/contract.types.ts
import type { ApiResponse } from "../../utils/api-client";
export type ContractStatus =
  | "draft" // 草稿
  | "pending_signatures" // 待签署
  | "signing" // 签署中
  | "completed" // 已完成
  | "rejected" // 已拒绝
  | "expired"; // 已过期

export interface SignatureRecord {
  signerId: string;
  signerName: string;
  signature: string; // Base64签名
  signedAt: number;
  ipAddress?: string;
  deviceInfo?: string;
}

export interface ContractParticipant {
  userId: string;
  userName: string;
  role: "buyer" | "seller" | "other";
  creditScore: number; // 信誉分数
  signatureOrder: number; // 签名顺序
  hasSigned: boolean;
  signatureRecord?: SignatureRecord;
}

export interface Contract {
  id: string;
  orderId: string;
  conversationId: string;
  conversationType: "p2p" | "group"; // 私聊还是群聊
  title: string;
  content: string; // 合同文本内容
  fileId?: string; // 关联的文件ID
  fileHash: string; // SHA-256哈希

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

// 订单签署请求参数
export interface OrderSignRequest {
  orderId: string;
  fileId: number;
  signature: string;
}
// 订单签署状态
export interface orderSignState {
  id: number;
  orderId: string;
  fileId: number;
  signature: string;
  status: 0 | 1; // 0-一方签署，1-已签署
  createTime: string;
  lastSignUserId: number;
}
/**
 * 签署记录失败响应的Data类型（字符串类型的错误信息）
 */
export type SignRecordErrorData = string;

/**
 * 签署记录接口的成功响应类型
 */
export type SignRecordSuccessResponse = ApiResponse<orderSignState>;

/**
 * 签署记录接口的失败响应类型
 */
export type SignRecordErrorResponse = ApiResponse<SignRecordErrorData>;

/**
 * 签署记录接口的完整响应类型（联合类型，包含成功和失败场景）
 */
export type SignRecordResponse =
  | SignRecordSuccessResponse
  | SignRecordErrorResponse;
// "data": {
//     "id": 22,
//     "url": "https://files.xxx.com/bucket/xxxx.pdf",
//     "fileName": "合同v3.pdf",
//     "fileType": 1,
//     "checksum": "md5:abcd1234..."
//   }
export interface fileInfo {
  id: number;
  url: string;
  fileName: string;
  fileType: number;
  checksum: string;
}

export interface UploadOrderQuoteRequest {
  orderId: string;
  amount: number;
  usagePeriod: number;
  usageStartTime: string; // yyyy-MM-dd HH:mm:ss
  usageEndTime: string; // yyyy-MM-dd HH:mm:ss
  fileId: number;
  signature: string;
}
