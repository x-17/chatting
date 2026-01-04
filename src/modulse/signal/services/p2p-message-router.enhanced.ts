// signal/services/p2p-message-router.enhanced.ts

import { e2eeService } from "./e2ee.service";
import { WebSocketManager } from "./websocket-manager";
import { MessagePersistenceService } from "./message-persistence.service";
import { P2PApiService } from "./p2p-api.service";
import { MessageSyncService } from "./message-sync.service";
import { fileEncryptionService } from "../../utils/file-encryption.service";
import { createAuthenticatedApiClient } from "../../utils/api-client";
import { getOrderParticipants } from "./users.api";
import axios from "axios";
import type { SessionStateInfo } from "./signal.store";
import type {
  P2PMessage,
  PersistedP2PMessage,
  OrderSessionInfo,
} from "../types/message.types";
import type { EncryptedFilePackage } from "../../utils/file-encryption.service";
import { isProtocolMessage } from "../types/message.types";
import { OrderApiService } from "../../orders/services/order-api.service";
import type {ISenderKeyDistributionMessage} from "../../groupchat/protocol/types.ts";

export interface IP2PRouterResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    messageType?: string;
    sessionInfo?: SessionStateInfo;
    timing?: number;
  };
}
const OrderApiServiceInstance = new OrderApiService();
/**
 * 增强版 P2P 消息路由器 - 完整的基于订单的在线/离线消息支持 + 文件传输
 */
export class EnhancedP2PMessageRouter {
  private myUserId: string;
  private wsManager: WebSocketManager;
  private persistence: MessagePersistenceService;
  private apiService: P2PApiService;
  private syncService: MessageSyncService;
  private fileApiClient = createAuthenticatedApiClient();

  private sessionStateCallbacks: Array<(stateInfo: SessionStateInfo) => void> =
    [];
  private messageHandlers: Array<(message: P2PMessage) => void> = [];
  private statusChangeCallbacks: Array<(status: string) => void> = [];
  private orderSessionCallbacks: Array<(session: OrderSessionInfo) => void> =
    [];
  private uploadProgressCallbacks = new Map<string, (progress: any) => void>();
  private downloadProgressCallbacks = new Map<
    string,
    (progress: number, total: number) => void
  >();

  constructor(userId: string) {
    this.myUserId = userId;
    this.wsManager = new WebSocketManager(userId);
    this.persistence = new MessagePersistenceService(userId);
    this.apiService = new P2PApiService();
    this.syncService = new MessageSyncService(userId);

    //this.setupWebSocketHandlers();
    this.setupConnectionMonitor();
  }

  /**
   * 初始化路由器
   */
  async init(): Promise<void> {
    console.log(`[P2PRouter] Initializing for user: ${this.myUserId}`);

    await this.persistence.init();
    await this.syncService.init();

    this.wsManager.connect();

    console.log(`[P2PRouter] Initialization complete`);
  }

  /**
   * 发送文本消息（基于订单）
   */
  async sendMessage(
    orderId: string,
    content: string,
    type: P2PMessage["type"] = "text",
    _recipientId: string
  ): Promise<IP2PRouterResponse> {
    const startTime = Date.now();
    const messageId = this.generateMessageId();

    try {
      // 1. 获取订单参与者信息
      //   const orderInfo = await this.getOrderInfo(orderId); //不用调接口，从自己取
      const recipientId = _recipientId;

      console.log(
        `[P2PRouter] Sending ${type} message for order ${orderId} to ${recipientId}`
      );

      // 2. 确保加密会话
      await e2eeService.ensureSession(this.myUserId, recipientId);

      // 3. 加密消息
      const encryptionResult = await e2eeService.encryptMessage(
        this.myUserId,
        recipientId,
        content
      );

      if (!encryptionResult.success) {
        throw new Error(`加密失败: ${encryptionResult.error}`);
      }

      // 4. 构建消息对象 - 初始状态为 pending
      const sequence = await this.generateSequenceForOrder(orderId);
      const message: P2PMessage = {
        id: messageId,
        type: type,
        senderId: this.myUserId,
        recipientId: recipientId,
        orderId: orderId,
        content: content,
        encryptedContent: encryptionResult.ciphertext,
        timestamp: Math.floor(Date.now()),
        sequence: sequence,
        status: "pending", // ✅ 初始状态为 pending
        sendAttempts: 0,
        maxRetries: 3,
        retryDelay: 1000,
        deliveryConfirmed: false,
        readConfirmed: false,
        metadata: {
          firstSendTime: Date.now(),
          errorCount: 0,
        },
      };

      // 5. 保存到本地（状态为 pending）
      await this.persistence.saveMessage(message);

      let sendSuccess = false;
      let sendMethod = "";

      // 6. 发送消息（WebSocket优先）
      if (this.wsManager.isConnected()) {
        console.log(`[P2PRouter] Attempting to send via WebSocket`);

        try {
          await this.wsManager.sendOrderMessage({
            messageId: messageId,
            orderId: orderId,
            recipientId: recipientId,
            encryptedContent: JSON.stringify(encryptionResult.ciphertext),
            messageType: message.type,
            timestamp: message.timestamp,
            sequence: sequence,
            fileId: undefined, // 文本消息没有 fileId
          });

          sendSuccess = true;
          sendMethod = "websocket";
          console.log(`[P2PRouter] WebSocket send successful`);
        } catch (error) {
          console.error(`[P2PRouter] WebSocket send failed:`, error);
        }
      }

      // 7. WebSocket不可用或发送失败，使用HTTP API
      // if (!sendSuccess) {
      //   console.log(
      //     `[P2PRouter] WebSocket unavailable or failed, using HTTP API`
      //   );

      //   const serverMessage: PersistedP2PMessage = {
      //     id: messageId,
      //     senderId: this.myUserId,
      //     recipientId: recipientId,
      //     orderId: orderId,
      //     encryptedContent: JSON.stringify(encryptionResult.ciphertext),
      //     messageType: type,
      //     timestamp: message.timestamp,
      //     sequence: sequence,
      //     status: "pending",
      //     sendAttempts: 0,
      //     maxRetries: 3,
      //   };

      //   try {
      //     const apiResult = await this.apiService.sendMessage(serverMessage);
      //     if (apiResult.code === 1) {
      //       sendSuccess = true;
      //       sendMethod = "http";
      //       console.log(
      //         `[P2PApi] Message sent successfully: ${apiResult.data?.id}`
      //       );
      //     }
      //   } catch (apiError) {
      //     console.error(`[P2PRouter] HTTP API send failed:`, apiError);
      //     sendSuccess = false;
      //   }
      // }

      // 8. 根据发送结果更新状态
      if (sendSuccess) {
        // ✅ 乐观更新为 delivered (服务器保证投递)
        await this.persistence.updateMessageStatus(messageId, "delivered");

        console.log(
          `[P2PRouter] Message sent and marked as delivered via ${sendMethod}`
        );
      } else {
        // 发送失败,更新为失败状态
        await this.persistence.updateMessageRetryStatus(messageId, {
          status: "failed",
          lastError: "发送失败:无法通过任何渠道发送消息",
          sendAttempts: 1,
        });

        throw new Error("发送失败:无法通过任何渠道发送消息");
      }

      return {
        success: true,
        data: {
          messageId,
          orderId,
          recipientId,
          method: sendMethod,
          status: "delivered", // ✅ 返回 delivered 状态
        },
        metadata: { timing: Date.now() - startTime },
      };
    } catch (error) {
      console.error(`[P2PRouter] Send order message failed:`, error);

      // 确保在异常情况下也更新状态
      try {
        await this.persistence.updateMessageRetryStatus(messageId, {
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          sendAttempts: 1,
        });
      } catch (updateError) {
        console.error(
          `[P2PRouter] Failed to update message status:`,
          updateError
        );
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { timing: Date.now() - startTime },
      };
    }
  }

  /**
   * 发送文件（基于订单）- 改进的消息状态管理
   */
  async sendFile(
    orderId: string,
    file: File,
    _recipientId: string,
    type?: "contract"
  ): Promise<IP2PRouterResponse> {
    const startTime = Date.now();
    const fileId = this.generateFileId();
    const messageType = type || "file";
    try {
      // 1. 获取订单参与者信息
      // const orderInfo = await this.getOrderInfo(orderId); //还是直接从本地取
      const recipientId = _recipientId;

      console.log(
        `[P2PRouter] Sending file ${file.name} for order ${orderId} to ${recipientId}`
      );

      // 2. 确保加密会话
      await e2eeService.ensureSession(this.myUserId, recipientId);

      const progressCallback = this.uploadProgressCallbacks.get(fileId);

      // 3. 加密文件
      const encryptedPackage = await fileEncryptionService.encryptFileForP2P(
        file,
        this.myUserId,
        recipientId,
        progressCallback
      );

      // 4. 上传加密文件到服务器
      const backendFileId = await this.uploadEncryptedFileToServer(
        encryptedPackage.encryptedContent,
        file.name, // 原始文件名
        orderId,
        fileId // 前端 fileId 用于进度跟踪
      );

      // 5. 构建文件消息内容
      const fileMessageContent = JSON.stringify({
        fileId: backendFileId, // 使用后端返回的数字ID
        frontendFileId: encryptedPackage.fileId, // 保留前端ID用于关联
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        metadata: encryptedPackage.metadata,
        signature: encryptedPackage.signature,
      });

      // 6. 加密文件消息
      const encryptionResult = await e2eeService.encryptMessage(
        this.myUserId,
        recipientId,
        fileMessageContent
      );

      if (!encryptionResult.success) {
        throw new Error(`文件消息加密失败: ${encryptionResult.error}`);
      }

      // 7. 构建消息对象 - 初始状态为 pending
      const sequence = await this.generateSequenceForOrder(orderId);
      const messageId = this.generateMessageId();
      const message: P2PMessage = {
        id: messageId,
        type: messageType,
        senderId: this.myUserId,
        recipientId: recipientId,
        orderId: orderId,
        content: fileMessageContent,
        encryptedContent: encryptionResult.ciphertext,
        timestamp: Math.floor(Date.now()),
        sequence: sequence,
        status: "pending", // ✅ 初始状态为 pending
        sendAttempts: 0,
        maxRetries: 3,
        retryDelay: 1000,
        deliveryConfirmed: false,
        readConfirmed: false,
        metadata: {
          fileId: encryptedPackage.fileId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          firstSendTime: Date.now(),
          errorCount: 0,
        },
      };

      // 8. 保存到本地（状态为 pending）
      await this.persistence.saveMessage(message);

      let sendSuccess = false;
      let sendMethod = "";

      // 9. 发送消息（WebSocket优先）
      if (this.wsManager.isConnected()) {
        console.log(`[P2PRouter] Attempting to send file via WebSocket`);

        try {
          await this.wsManager.sendOrderMessage({
            messageId: messageId,
            orderId: orderId,
            recipientId: recipientId,
            encryptedContent: JSON.stringify(encryptionResult.ciphertext),
            messageType: message.type,
            timestamp: message.timestamp,
            sequence: sequence,
            fileId: backendFileId,
          });

          // 如果没有抛出异常，说明发送成功
          sendSuccess = true;
          sendMethod = "websocket";
          console.log(`[P2PRouter] WebSocket file send successful`);
        } catch (error) {
          console.error(`[P2PRouter] WebSocket file send failed:`, error);
          // 发送失败，继续尝试 HTTP
        }
      }

      // 10. WebSocket不可用或发送失败，使用HTTP API
      // if (!sendSuccess) {
      //   console.log(
      //     `[P2PRouter] WebSocket unavailable or failed, using HTTP API for file`
      //   );
      //
      //   const serverMessage: PersistedP2PMessage = {
      //     id: messageId,
      //     senderId: this.myUserId,
      //     recipientId: recipientId,
      //     orderId: orderId,
      //     encryptedContent: JSON.stringify(encryptionResult.ciphertext),
      //     messageType: "file",
      //     timestamp: message.timestamp,
      //     sequence: sequence,
      //     status: "pending",
      //     sendAttempts: 0,
      //     maxRetries: 3,
      //     metadata: message.metadata,
      //   };
      //
      //   try {
      //     const apiResult = await this.apiService.sendMessage(serverMessage);
      //     if (apiResult.code === 1) {
      //       sendSuccess = true;
      //       sendMethod = "http";
      //       console.log(
      //         `[P2PApi] Message sent successfully: ${apiResult.data?.id}`
      //       );
      //     }
      //   } catch (apiError) {
      //     console.error(`[P2PRouter] HTTP API file send failed:`, apiError);
      //     sendSuccess = false;
      //   }
      // }

      // 11. 根据发送结果更新状态
      if (sendSuccess) {
        // ✅ 乐观更新为 delivered
        await this.persistence.updateMessageStatus(messageId, "delivered");
        console.log(
          `[P2PRouter] File message sent and marked as delivered via ${sendMethod}`
        );
      } else {
        // 发送失败，更新为失败状态
        await this.persistence.updateMessageRetryStatus(messageId, {
          status: "failed",
          lastError: "文件发送失败：无法通过任何渠道发送消息",
          sendAttempts: 1,
        });

        throw new Error("文件发送失败：无法通过任何渠道发送消息");
      }

      return {
        success: true,
        data: {
          messageId: messageId,
          fileId: backendFileId,
          orderId,
          recipientId,
          method: sendMethod,
          status: "sent",
        },
        metadata: { timing: Date.now() - startTime },
      };
    } catch (error) {
      console.error(`[P2PRouter] Send order file failed:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { timing: Date.now() - startTime },
      };
    }
  }

  /**
   * 下载订单文件 - 修改为POST方式获取文件内容
   */
  /**
   * 下载订单文件 - 修改为POST方式获取文件内容
   */
  async downloadOrderFile(message: P2PMessage): Promise<IP2PRouterResponse> {
    const startTime = Date.now();

    try {
      if (message.type !== "file" || !message.metadata?.fileId) {
        throw new Error("Invalid file message");
      }

      console.log(
        `[P2PRouter] Downloading file for order ${message.orderId}: ${message.metadata.fileName}`
      );

      // 1. 解析文件消息
      const fileMessageData = JSON.parse(message.content);
      const backendFileId = fileMessageData.fileId; // 后端数字ID
      const frontendFileId = fileMessageData.frontendFileId; // 前端ID用于进度

      // 2. 使用POST请求获取文件内容
      const fileContentResponse = await this.postRequestFileContent(
        backendFileId
      );

      // 3. 将Base64文件内容转换为ArrayBuffer
      const encryptedContent = this.base64ToArrayBuffer(
        fileContentResponse.fileContent
      );

      // 4. 重建加密包
      const encryptedPackage: EncryptedFilePackage = {
        fileId: frontendFileId, // 使用前端ID
        metadata: fileMessageData.metadata, // 从消息中获取
        encryptedContent: encryptedContent,
        signature: fileMessageData.signature, // 从消息中获取
      };

      // 5. 解密文件
      const decryptionResult = await fileEncryptionService.decryptP2PFile(
        encryptedPackage,
        this.myUserId,
        message.senderId
      );

      // 6. 创建本地下载链接并触发下载
      const downloadUrl = fileEncryptionService.createDownloadUrl(
        decryptionResult.content,
        decryptionResult.originalName,
        decryptionResult.mimeType
      );

      // 7. 自动触发浏览器下载
      this.triggerFileDownload(downloadUrl, decryptionResult.originalName);

      console.log(
        `[P2PRouter] Order file decrypted and download triggered successfully`
      );

      return {
        success: true,
        data: {
          fileId: fileMessageData.fileId,
          fileName: decryptionResult.originalName,
          mimeType: decryptionResult.mimeType,
          size: decryptionResult.size,
          downloadUrl: downloadUrl,
          isVerified: decryptionResult.isVerified,
          orderId: message.orderId,
        },
        metadata: { timing: Date.now() - startTime },
      };
    } catch (error) {
      console.error(`[P2PRouter] Download order file failed:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { timing: Date.now() - startTime },
      };
    }
  }

  /**
   * 下载订单文件 - 修改为POST方式获取文件内容
   */
  async downloadOrderContract(
    message: P2PMessage,
    triggerDownload: boolean = true
  ): Promise<IP2PRouterResponse> {
    const startTime = Date.now();

    try {
      if (message.type !== "contract" || !message.metadata?.fileId) {
        throw new Error("Invalid contract message");
      }

      console.log(
        `[P2PRouter] Downloading contract for order ${message.orderId}: ${message.metadata.fileName}`
      );

      // 1. 解析文件消息
      const fileMessageData = JSON.parse(message.content);
      const backendFileId = fileMessageData.fileId; // 后端数字ID
      const frontendFileId = fileMessageData.frontendFileId; // 前端ID用于进度

      // 2. 使用POST请求获取文件内容
      const fileContentResponse = await this.postRequestFileContent(
        backendFileId
      );

      // 3. 将Base64文件内容转换为ArrayBuffer
      const encryptedContent = this.base64ToArrayBuffer(
        fileContentResponse.fileContent
      );

      // 4. 重建加密包
      const encryptedPackage: EncryptedFilePackage = {
        fileId: frontendFileId, // 使用前端ID
        metadata: fileMessageData.metadata, // 从消息中获取
        encryptedContent: encryptedContent,
        signature: fileMessageData.signature, // 从消息中获取
      };

      // 5. 解密文件
      const decryptionResult = await fileEncryptionService.decryptP2PFile(
        encryptedPackage,
        this.myUserId,
        message.senderId
      );

      // 🔧 修正 MIME 类型：如果文件名以 .pdf 结尾，强制使用 application/pdf
      let mimeType = decryptionResult.mimeType;
      if (decryptionResult.originalName.toLowerCase().endsWith(".pdf")) {
        mimeType = "application/pdf";
      }

      // 6. 创建本地下载链接并触发下载
      const downloadUrl = fileEncryptionService.createDownloadUrl(
        decryptionResult.content,
        decryptionResult.originalName,
        mimeType
      );

      if (triggerDownload) {
        this.triggerFileDownload(downloadUrl, decryptionResult.originalName);
      }

      console.log(
        `[P2PRouter] Order contract decrypted and download triggered successfully`
      );

      return {
        success: true,
        data: {
          fileId: fileMessageData.fileId,
          fileName: decryptionResult.originalName,
          mimeType: mimeType,
          size: decryptionResult.size,
          downloadUrl: downloadUrl,
          isVerified: decryptionResult.isVerified,
          orderId: message.orderId,
        },
        metadata: { timing: Date.now() - startTime },
      };
    } catch (error) {
      console.error(`[P2PRouter] Download order contract failed:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { timing: Date.now() - startTime },
      };
    }
  }

  /**
   * 通过POST请求获取文件内容
   */
  private async postRequestFileContent(fileId: number): Promise<{
    fileName: string;
    fileContent: string; // Base64编码的文件内容
  }> {
    try {
      console.log(`[P2PRouter] Requesting file content for fileId: ${fileId}`);

      const response = await this.fileApiClient.post<{
        code: number;
        msg: string;
        data: {
          fileName: string;
          fileContent: string;
        };
      }>("/file/download", {
        fileId: fileId,
      });

      if (response.data.code !== 1) {
        throw new Error(`获取文件内容失败: ${response.data.msg}`);
      }

      console.log(
        `[P2PRouter] File content received, fileName: ${response.data.data.fileName}`
      );
      return response.data.data;
    } catch (error) {
      console.error("[P2PRouter] Post request file content failed:", error);

      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          throw new Error("文件下载请求超时，请检查网络连接后重试");
        } else if (error.response?.status === 404) {
          throw new Error("文件不存在或已过期");
        } else if (error.response?.status === 401) {
          throw new Error("身份验证失败，请重新登录");
        } else if (error.response?.status === 500) {
          throw new Error("服务器错误，请稍后重试");
        }
      }

      throw new Error(
        "文件下载失败: " +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * 将Base64字符串转换为ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    try {
      // 移除可能的数据URL前缀
      const base64Data = base64.replace(/^data:[^;]+;base64,/, "");

      // Base64解码
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return bytes.buffer;
    } catch (error) {
      console.error(
        "[P2PRouter] Base64 to ArrayBuffer conversion failed:",
        error
      );
      throw new Error("文件内容格式错误，无法解码");
    }
  }

  /**
   * 触发浏览器文件下载
   */
  private triggerFileDownload(downloadUrl: string, fileName: string): void {
    try {
      // 创建隐藏的下载链接并触发点击
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fileName;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 清理URL对象（延迟执行以确保下载已经开始）
      setTimeout(() => {
        fileEncryptionService.revokeDownloadUrl(downloadUrl);
      }, 1000);

      console.log(`[P2PRouter] File download triggered: ${fileName}`);
    } catch (error) {
      console.error("[P2PRouter] Trigger file download failed:", error);
      // 即使触发下载失败，也返回下载URL让用户手动下载
    }
  }

  /**
   * ✅ 统一处理接收到的消息（离线和在线消息统一处理）
   */
  public async handleIncomingMessage(data: any): Promise<void> {
    try {
      if (isProtocolMessage(data.type)) return;

      const encryptedData = JSON.parse(data.encryptedContent);
      const decryptionResult = await e2eeService.decryptMessage(
        this.myUserId,
        data.senderId.toString(),
        encryptedData
      );

      if (!decryptionResult.success || !decryptionResult.content) {
        console.error(`[P2PRouter] Decryption failed:`, decryptionResult.error);
        return;
      }

      // ✅ 对于文件消息，解析 content 获取完整的文件信息
      let messageContent = decryptionResult.content;
      let fileMetadata: any = {};

      if (data.messageType === "file" || "contract") {
        try {
          const fileData = JSON.parse(decryptionResult.content);
          fileMetadata = {
            fileId: fileData.fileId, // 后端数字 ID
            frontendFileId: fileData.frontendFileId, // 前端 ID
            fileName: fileData.fileName,
            fileSize: fileData.fileSize,
            mimeType: fileData.mimeType,
            metadata: fileData.metadata, // 加密 metadata
            signature: fileData.signature,
          };
        } catch (e) {
          console.error("[P2PRouter] Parse file content failed:", e);
        }
      }

      const message: P2PMessage = {
        id: data.id.toString(),
        type: data.messageType,
        senderId: data.senderId.toString(),
        recipientId: this.myUserId,
        orderId: data.orderId,
        content: messageContent,
        encryptedContent: encryptedData,
        timestamp: data.timestamp,
        sequence: data.sequence,
        status: "delivered",
        sendAttempts: 0,
        maxRetries: 0,
        retryDelay: 0,
        deliveryConfirmed: true,
        readConfirmed: false,
        metadata:
          data.messageType === "file" || "contract"
            ? fileMetadata
            : {
              ...data.metadata,
            },
      };

      await this.persistence.saveMessage(message);
      this.triggerMessageHandlers(message);

      console.log(`[P2PRouter] Message ${data.id} processed successfully`);
    } catch (error) {
      console.error("[P2PRouter] Handle message failed:", error);
    }
  }

  /**
   * ✅ 发送密钥分发消息（用于群聊密钥同步）
   *
   * @param recipientId 接收者用户ID
   * @param keyDistMsg 密钥分发消息内容
   * @param orderId 关联的群组订单ID
   */
  async sendKeyDistribution(
      recipientId: string,
      keyDistMsg: ISenderKeyDistributionMessage,
      orderId: string
  ): Promise<IP2PRouterResponse> {
    const startTime = Date.now();
    const messageId = this.generateMessageId();

    try {
      console.log(
          `[P2PRouter] Sending key distribution for order ${orderId} to ${recipientId}`
      );

      // 1. 构建密钥分发消息内容
      const keyContent = {
        type: 'KEY_DISTRIBUTION',
        payload: keyDistMsg
      };

      // 2. ✅ 关键：使用 Signal 加密整个密钥分发消息
      // 这样可以防止中间人攻击，确保密钥只有目标用户能读取
      const encryptionResult = await e2eeService.encryptMessage(
          this.myUserId,
          recipientId,
          JSON.stringify(keyContent)
      );

      if (!encryptionResult.success) {
        throw new Error(`密钥分发加密失败: ${encryptionResult.error}`);
      }

      // 3. 构建消息对象（不保存到历史记录）
      const sequence = await this.generateSequenceForOrder(orderId);
      const message = {
        id: messageId,
        type: 'key_distribution' as const,
        senderId: this.myUserId,
        recipientId: recipientId,
        orderId: orderId,
        content: JSON.stringify(keyContent),
        encryptedContent: encryptionResult.ciphertext,
        timestamp: Math.floor(Date.now()),
        sequence: sequence,
      };

      // 4. ✅ 通过 WebSocket 发送
      let sendSuccess = false;
      let sendMethod = '';

      if (this.wsManager.isConnected()) {
        try {
          await this.wsManager.sendOrderMessage({
            messageId: messageId,
            orderId: orderId,
            recipientId: recipientId,
            encryptedContent: JSON.stringify(encryptionResult.ciphertext),
            messageType: 'key_distribution',
            timestamp: message.timestamp,
            sequence: sequence,
            fileId: undefined,
          });

          sendSuccess = true;
          sendMethod = 'websocket';
          console.log(`[P2PRouter] Key distribution sent via WebSocket`);
        } catch (error) {
          console.error(`[P2PRouter] WebSocket send failed:`, error);
        }
      }

      // 5. ✅ 如果 WebSocket 失败，使用 HTTP（可选）
      if (!sendSuccess) {
        // 这里可以添加 HTTP fallback 逻辑
        throw new Error('密钥分发失败：WebSocket 不可用');
      }

      return {
        success: true,
        data: {
          messageId,
          orderId,
          recipientId,
          method: sendMethod,
          keyType: 'sender_key_distribution'
        },
        metadata: {
          timing: Date.now() - startTime,
          messageType: 'key_distribution'
        },
      };
    } catch (error) {
      console.error(`[P2PRouter] Send key distribution failed:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: { timing: Date.now() - startTime },
      };
    }
  }

  /**
   * ✅ 处理接收到的密钥分发消息
   */
  public async handleKeyDistributionMessage(data: any): Promise<void> {
    try {
      console.log('[P2PRouter] Received key distribution message');

      // 1. 解密消息内容
      const encryptedData = JSON.parse(data.encryptedContent);
      const decryptionResult = await e2eeService.decryptMessage(
          this.myUserId,
          data.senderId.toString(),
          encryptedData
      );

      if (!decryptionResult.success || !decryptionResult.content) {
        console.error(`[P2PRouter] Key decryption failed:`, decryptionResult.error);
        return;
      }

      // 2. 解析密钥内容
      const keyContent = JSON.parse(decryptionResult.content);

      if (keyContent.type !== 'KEY_DISTRIBUTION') {
        console.warn('[P2PRouter] Invalid key distribution message type');
        return;
      }

      // 3. ✅ 触发密钥分发回调（让群聊管理服务处理）
      this.triggerKeyDistributionHandlers({
        orderId: data.orderId,
        senderId: data.senderId.toString(),
        keyDistributionMessage: keyContent.payload
      });

      console.log(`[P2PRouter] Key distribution processed for order ${data.orderId}`);
    } catch (error) {
      console.error('[P2PRouter] Handle key distribution failed:', error);
    }
  }

  // ========== 回调管理 ==========

  private keyDistributionHandlers: Array<(data: {
    orderId: string;
    senderId: string;
    keyDistributionMessage: ISenderKeyDistributionMessage;
  }) => void> = [];

  /**
   * ✅ 注册密钥分发回调
   */
  onKeyDistribution(callback: (data: {
    orderId: string;
    senderId: string;
    keyDistributionMessage: ISenderKeyDistributionMessage;
  }) => void): void {
    this.keyDistributionHandlers.push(callback);
  }

  private triggerKeyDistributionHandlers(data: {
    orderId: string;
    senderId: string;
    keyDistributionMessage: ISenderKeyDistributionMessage;
  }): void {
    this.keyDistributionHandlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error('[P2PRouter] Key distribution handler error:', error);
      }
    });
  }

  /**
   * 同步订单的离线消息
   */
  async syncOrderOfflineMessages(
    orderId?: string
  ): Promise<{ success: boolean; newMessages: number }> {
    console.log(
      `[P2PRouter] Syncing offline messages${orderId ? ` for order ${orderId}` : ""
      }`
    );

    const result = await this.syncService.syncOfflineMessages();

    if (result.success && result.newMessages > 0) {
      this.triggerStatusChange("offline_messages_synced");

      // 如果指定了订单ID，触发特定订单的更新
      if (orderId) {
        const session = await this.persistence.getOrderSession(orderId);
        if (session) {
          this.triggerOrderSessionCallbacks(session);
        }
      }
    }

    return result;
  }

  /**
   * 重试发送失败的订单消息
   */
  async retryPendingOrderMessages(
    orderId?: string
  ): Promise<{ success: boolean; sentCount: number }> {
    console.log(
      `[P2PRouter] Retrying pending messages${orderId ? ` for order ${orderId}` : ""
      }`
    );
    return await this.syncService.retrySendingPendingMessages(orderId);
  }

  /**
   * 标记订单消息为已读
   */
  async markOrderMessagesAsRead(orderId: string): Promise<void> {
    await this.syncService.markOrderMessagesAsRead(orderId);
  }

  /**
   * 获取订单聊天历史
   */
  async getOrderHistory(
    orderId: string,
    limit: number = 50,
    beforeTimestamp?: number
  ): Promise<P2PMessage[]> {
    return await this.persistence.getOrderMessages(
      orderId,
      limit,
      beforeTimestamp
    );
  }

  /**
   * 获取用户的订单会话列表
   */
  async getOrderSessions(): Promise<OrderSessionInfo[]> {
    return await this.syncService.getOrderSessions();
  }

  /**
   * 获取特定订单的会话信息
   */
  async getOrderSession(orderId: string): Promise<OrderSessionInfo | null> {
    return await this.persistence.getOrderSession(orderId);
  }

  // ========== 注册回调方法 ==========

  onMessage(callback: (message: P2PMessage) => void): void {
    this.messageHandlers.push(callback);
  }

  onStatusChange(callback: (status: string) => void): void {
    this.statusChangeCallbacks.push(callback);
  }

  onSessionUpdate(callback: (stateInfo: SessionStateInfo) => void): void {
    this.sessionStateCallbacks.push(callback);
  }

  onOrderSessionUpdate(callback: (session: OrderSessionInfo) => void): void {
    this.orderSessionCallbacks.push(callback);
  }

  onFileUploadProgress(
    fileId: string,
    callback: (progress: any) => void
  ): void {
    this.uploadProgressCallbacks.set(fileId, callback);
  }

  onFileDownloadProgress(
    fileId: string,
    callback: (progress: number, total: number) => void
  ): void {
    this.downloadProgressCallbacks.set(fileId, callback);
  }

  // ========== 其他公共方法 ==========

  getConnectionStatus(): string {
    return this.wsManager.getStatus();
  }

  disconnect(): void {
    this.wsManager.disconnect();
  }

  cleanup(): void {
    this.wsManager.disconnect();
    this.syncService.cleanup();
    this.messageHandlers = [];
    this.statusChangeCallbacks = [];
    this.sessionStateCallbacks = [];
    this.orderSessionCallbacks = [];
    this.uploadProgressCallbacks.clear();
    this.downloadProgressCallbacks.clear();
  }

  // ========== 私有方法 ==========

  /**
   * ✅ 设置 WebSocket 处理器（简化版）
   */
  // private setupWebSocketHandlers(): void {
  //   // 统一处理所有业务消息（包括密钥分发）
  //   this.wsManager.on('order_message', (data) => {
  //     // ✅ 根据消息类型分发处理
  //     if (data.messageType === 'key_distribution') {
  //       this.handleKeyDistributionMessage(data);
  //     } else {
  //       this.handleIncomingMessage(data);
  //     }
  //   });
  //
  //   // 连接状态监控
  //   this.wsManager.onStatusChange((status) => {
  //     console.log(`[P2PRouter] Connection status: ${status}`);
  //     this.triggerStatusChange(status);
  //   });
  // }
  /**
   * 处理在线列表更新
   */
  private handleOnlineListUpdate(onlineTenants: string[]): void {
    console.log(`[P2PRouter] Online tenants updated:`, onlineTenants);

    // 可以在这里更新UI显示在线状态
    this.triggerStatusChange("online_list_updated");
  }

  /**
   * ✅ 连接建立后自动同步
   * 注意:由于后端会自动推送离线消息,这里可以简化
   */
  private setupConnectionMonitor(): void {
    this.wsManager.onStatusChange(async (status) => {
      if (status === "connected") {
        console.log(
          "[P2PRouter] Connected, backend will auto push offline messages"
        );

        // ✅ 只需要重试本地的待发送消息
        await this.retryPendingOrderMessages();

        // ✅ 可选:显式触发同步(如果后端没有自动推送)
        // await this.syncOrderOfflineMessages();
      }
    });
  }

  /**
   * 获取订单信息
   */
  //   private async getOrderInfo(
  //     orderId: string
  //   ): Promise<{ otherUserId: string }> {
  //     try {
  //       const order = await OrderApiServiceInstance.getMyOrders();
  //       // 过滤出 userId 不同的参与者
  //       const filtered = order.participants.filter(
  //         (participant) => participant.userId !== targetUserId
  //       );
  //       const otherUserId = filtered[0].id;

  //       if (!otherUserId) {
  //         throw new Error(`Cannot find other participant in order ${orderId}`);
  //       }

  //       return { otherUserId };
  //     } catch (error) {
  //       console.error(`[P2PRouter] Get order info error for ${orderId}:`, error);
  //       throw new Error(
  //         `Failed to get order info: ${
  //           error instanceof Error ? error.message : String(error)
  //         }`
  //       );
  //     }
  //   }

  private triggerMessageHandlers(message: P2PMessage): void {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error("[P2PRouter] Message handler error:", error);
      }
    });
  }

  private triggerStatusChange(status: string): void {
    this.statusChangeCallbacks.forEach((callback) => {
      try {
        callback(status);
      } catch (error) {
        console.error("[P2PRouter] Status callback error:", error);
      }
    });
  }

  private triggerOrderSessionCallbacks(session: OrderSessionInfo): void {
    this.orderSessionCallbacks.forEach((callback) => {
      try {
        callback(session);
      } catch (error) {
        console.error("[P2PRouter] Order session callback error:", error);
      }
    });
  }

  /**
   * 更新消息的服务器时间戳
   */
  // private async updateMessageServerTimestamp(messageId: string, serverTimestamp: number): Promise<void> {
  //     try {
  //         // 这里需要扩展 MessagePersistenceService 来支持按ID获取消息
  //         // 暂时跳过具体实现，可以在后续版本中添加
  //         console.log(`[P2PRouter] Would update server timestamp for ${messageId}: ${serverTimestamp}`);
  //     } catch (error) {
  //         console.warn(`[P2PRouter] Failed to update server timestamp:`, error);
  //     }
  // }

  /**
   * 上传文件到服务器
   */
  // private async uploadFileToServer(content: ArrayBuffer, fileId: string, orderId: string): Promise<string> {
  //     const progressCallback = this.uploadProgressCallbacks.get(fileId);
  //
  //     try {
  //         const formData = new FormData();
  //         formData.append('file', new Blob([content]), `${fileId}.encrypted`);
  //         formData.append('fileId', fileId);
  //         formData.append('orderId', orderId);
  //         formData.append('userId', this.myUserId);
  //
  //         console.log(`[P2PRouter] Uploading file to server: ${fileId}`);
  //
  //         const response = await this.fileApiClient.post<{
  //             success: boolean;
  //             downloadUrl: string;
  //             fileId: string;
  //             orderId: string;
  //         }>('/api/files/upload', formData, {
  //             headers: {
  //                 'Content-Type': 'multipart/form-data'
  //             },
  //             onUploadProgress: (progressEvent) => {
  //                 if (progressEvent.total && progressCallback) {
  //                     const percentCompleted = Math.round(
  //                         (progressEvent.loaded * 100) / progressEvent.total
  //                     );
  //
  //                     progressCallback({
  //                         fileId,
  //                         orderId,
  //                         loaded: progressEvent.loaded,
  //                         total: progressEvent.total,
  //                         percent: percentCompleted,
  //                         stage: 'uploading'
  //                     });
  //
  //                     console.log(`[P2PRouter] Upload progress: ${percentCompleted}%`);
  //                 }
  //             },
  //             timeout: 300000
  //         });
  //
  //         if (!response.data.success) {
  //             throw new Error('Upload failed: Server returned unsuccessful response');
  //         }
  //
  //         console.log(`[P2PRouter] Upload success: ${response.data.downloadUrl}`);
  //         return response.data.downloadUrl;
  //
  //     } catch (error) {
  //         console.error('[P2PRouter] Upload error:', error);
  //
  //         if (axios.isAxiosError(error)) {
  //             if (error.code === 'ECONNABORTED') {
  //                 throw new Error('文件上传超时，请检查网络连接后重试');
  //             } else if (error.response?.status === 413) {
  //                 throw new Error('文件过大，超出服务器限制');
  //             } else if (error.response?.status === 401) {
  //                 throw new Error('身份验证失败，请重新登录');
  //             } else if (error.response?.status === 500) {
  //                 throw new Error('服务器错误，请稍后重试');
  //             }
  //         }
  //
  //         throw new Error('文件上传失败: ' + (error instanceof Error ? error.message : String(error)));
  //     }
  // }

  private async uploadEncryptedFileToServer(
    encryptedContent: ArrayBuffer,
    originalFileName: string,
    orderId: string,
    frontendFileId: string
  ): Promise<number> {
    const progressCallback = this.uploadProgressCallbacks.get(frontendFileId);

    try {
      const formData = new FormData();

      // 创建加密文件的 Blob，保持 .encrypted 扩展名
      const encryptedBlob = new Blob([encryptedContent], {
        type: "application/octet-stream",
      });

      // 使用原始文件名 + .encrypted 作为上传文件名
      const uploadFileName = `${originalFileName}.encrypted`;
      formData.append("file", encryptedBlob, uploadFileName);
      formData.append("orderId", orderId);

      console.log(
        `[P2PRouter] Uploading encrypted file to server: ${uploadFileName}`
      );

      const response = await this.fileApiClient.post<{
        code: number;
        msg: string;
        data: number; // 后端返回的数字 fileId
      }>("/file/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total && progressCallback) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );

            progressCallback({
              fileId: frontendFileId,
              orderId,
              loaded: progressEvent.loaded,
              total: progressEvent.total,
              percent: percentCompleted,
              stage: "uploading",
            });
          }
        },
        timeout: 300000,
      });

      if (response.data.code !== 1) {
        throw new Error(`上传失败: ${response.data.msg}`);
      }

      console.log(
        `[P2PRouter] Upload success, backend fileId: ${response.data.data}`
      );
      return response.data.data;
    } catch (error) {
      // 错误处理保持不变
      throw new Error(
        "文件上传失败: " +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private async getFileDetail(fileId: number): Promise<{
    id: number;
    url: string;
    fileName: string;
    fileType: number;
    checksum: string;
  }> {
    const response = await this.fileApiClient.get<{
      code: number;
      msg: string;
      data: {
        id: number;
        url: string;
        fileName: string;
        fileType: number;
        checksum: string;
      };
    }>(`/file/${fileId}`);

    if (response.data.code !== 1) {
      throw new Error(`获取文件详情失败: ${response.data.msg}`);
    }

    return response.data.data;
  }

  /**
   * 从服务器下载文件
   */
  private async downloadFileFromServer(
    url: string,
    _fileId: string,
    progressCallback?: (loaded: number, total: number) => void
  ): Promise<ArrayBuffer> {
    try {
      console.log(`[P2PRouter] Downloading from: ${url}`);

      const response = await this.fileApiClient.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total && progressCallback) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );

            progressCallback(progressEvent.loaded, progressEvent.total);
            console.log(`[P2PRouter] Download progress: ${percentCompleted}%`);
          }
        },
        timeout: 300000,
      });

      console.log(
        `[P2PRouter] Download success: ${response.data.byteLength} bytes`
      );
      return response.data;
    } catch (error) {
      console.error("[P2PRouter] Download error:", error);

      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          throw new Error("文件下载超时，请检查网络连接后重试");
        } else if (error.response?.status === 404) {
          throw new Error("文件不存在或已过期");
        } else if (error.response?.status === 401) {
          throw new Error("身份验证失败，请重新登录");
        } else if (error.response?.status === 500) {
          throw new Error("服务器错误，请稍后重试");
        }
      }

      throw new Error(
        "文件下载失败: " +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateFileId(): string {
    return `file_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private async generateSequenceForOrder(orderId: string): Promise<number> {
    try {
      // 从本地存储获取最新消息来确定下一个序列号
      const latestMessages = await this.persistence.getOrderMessages(
        orderId,
        1
      );
      if (latestMessages.length === 0) {
        return 1; // 第一条消息
      }

      const latestSequence = Math.max(
        ...latestMessages.map((msg) => msg.sequence || 0)
      );
      return latestSequence + 1;
    } catch (error) {
      console.error(
        `[P2PRouter] Generate sequence for order ${orderId} error:`,
        error
      );
      return Date.now(); // 降级方案
    }
  }
}

// 工厂函数
const routerInstances = new Map<string, EnhancedP2PMessageRouter>();

export function getEnhancedP2PRouter(userId: string): EnhancedP2PMessageRouter {
  if (!routerInstances.has(userId)) {
    routerInstances.set(userId, new EnhancedP2PMessageRouter(userId));
  }
  return routerInstances.get(userId)!;
}

export function clearAllP2PRouters(): void {
  routerInstances.forEach((router) => router.cleanup());
  routerInstances.clear();
}
