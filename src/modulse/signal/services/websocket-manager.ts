// signal/services/websocket-manager.ts

import type { MessageType } from "../types/message.types";
import { isProtocolMessage } from "../types/message.types";
import type { WebSocketConfig } from "./websocket.config.ts";
import { DEFAULT_WEBSOCKET_CONFIG } from "./websocket.config.ts";

export type WebSocketStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

/**
 * ✅ 简化的 WebSocket 消息格式 - 移除了 originalId
 */
interface WebSocketMessage {
  messageType: MessageType; // ✅ 使用统一的 MessageType
  id: string; // ✅ 必需：所有消息的唯一ID，用于关联
  timestamp?: number; // 时间戳（可选，用于日志）

  // 业务消息字段(仅当 type 为业务消息时存在)
  orderId?: string;
  recipientId?: string;
  encryptedContent?: string;
  sequence?: number;
  fileId?: number | null;

  // ACK 确认字段(仅当 type='ack' 时存在)
  status?: string;
  serverSequence?: number;

  // 其他字段
  [key: string]: any;
}

/**
 * WebSocket 管理器
 */
export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatTimer: number | null = null;
  private heartbeatInterval = 30000; // ✅ 心跳间隔 30 秒
  private pongTimeout = 10000; // ✅ 等待 pong 超时时间 10 秒
  private waitingForPong = false;
  private reconnectTimer: number | null = null;
  private statusChangeCallbacks: Array<(status: WebSocketStatus) => void> = [];
  private messageCallbacks = new Map<string, Array<(data: any) => void>>();
  private pendingAcks = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeoutId: number;
    }
  >();

  // ✅ 新增重传相关状态
  private pendingMessages = new Map<
    string,
    {
      message: WebSocketMessage;
      retryCount: number;
      maxRetries: number;
      sentTime: number;
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeoutId?: number;
    }
  >();

  private retryTimers = new Map<string, number>();

  private status: WebSocketStatus = "disconnected";
  private config: WebSocketConfig;

  constructor(
    private userId: string,
    private wsUrl?: string,
    config?: Partial<WebSocketConfig>
  ) {
    this.wsUrl = wsUrl || this.buildWebSocketUrl();

    // ✅ 合并配置
    this.config = {
      heartbeat: {
        ...DEFAULT_WEBSOCKET_CONFIG.heartbeat,
        ...config?.heartbeat,
      },
      reconnect: {
        ...DEFAULT_WEBSOCKET_CONFIG.reconnect,
        ...config?.reconnect,
      },
      ack: {
        ...DEFAULT_WEBSOCKET_CONFIG.ack,
        ...config?.ack,
      },
    };

    // 应用配置
    this.maxReconnectAttempts = this.config.reconnect.maxAttempts;
    this.reconnectDelay = this.config.reconnect.initialDelay;
    this.heartbeatInterval = this.config.heartbeat.interval;
    this.pongTimeout = this.config.heartbeat.pongTimeout;
  }

  /**
   * 连接到 WebSocket 服务器
   */
  connect(): void {
    if (this.isConnected() || this.status === "connecting") {
      console.log("[WebSocket] Already connected or connecting");
      return;
    }

    this.updateStatus("connecting");

    try {
      console.log("wsurl", this.wsUrl!);

      this.ws = new WebSocket(this.wsUrl!);
      this.setupEventListeners();
    } catch (error) {
      console.error("[WebSocket] Connection failed:", error);
      this.handleConnectionError(error);
    }
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect(): void {
    console.log("[WebSocket] Disconnecting...");

    this.stopHeartbeat();
    this.cleanupPendingAcks("Connection closed");
    this.cleanupPendingMessages("Connection closed");

    if (this.ws) {
      this.ws.close(1000, "Normal closure");
      this.ws = null;
    }

    this.updateStatus("disconnected");
    this.reconnectAttempts = 0;
  }

  /**
   * 发送消息（带重传机制）
   */
  async send(
    message: WebSocketMessage,
    options: {
      requireAck?: boolean;
      timeout?: number;
      maxRetries?: number;
    } = {}
  ): Promise<any> {
    const requireAck = options.requireAck ?? true;
    const timeout = options.timeout ?? this.config.ack.timeout;
    const maxRetries = options.maxRetries ?? this.config.ack.retry.maxAttempts;

    if (!this.isConnected()) {
      console.warn(`[WebSocket] Cannot send - not connected. Status: ${this.status}, ReadyState: ${this.ws?.readyState}, WS exists: ${!!this.ws}`);
      throw new Error("WebSocket not connected");
    }


    // ✅ 确保消息有 id（如果没有则生成）
    const messageToSend: WebSocketMessage = {
      ...message,
      id: message.id || this.generateMessageId(),
      timestamp: message.timestamp || Date.now(),
    };

    try {
      this.ws!.send(JSON.stringify(messageToSend));

      console.log(
        `[WebSocket] Sent message: type=${message.messageType}, id=${messageToSend.id}`
      );

      // ✅ 协议消息(ping/pong/ack)不需要等待 ACK
      if (isProtocolMessage(message.messageType)) {
        return { success: true, id: messageToSend.id };
      }

      // ✅ 业务消息需要等待 ACK（使用消息 id）
      if (requireAck) {
        return await this.waitForAckWithRetry(
          messageToSend,
          timeout,
          maxRetries
        );
      }

      return { success: true, id: messageToSend.id };
    } catch (error) {
      console.error("[WebSocket] Send error:", error);
      throw error;
    }
  }

  /**
   * ✅ 生成消息 ID
   */
  private generateMessageId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 发送订单消息
   */
  async sendOrderMessage(orderData: {
    messageId: string; // ✅ 必需：消息ID
    orderId: string;
    recipientId: string;
    encryptedContent: string;
    messageType: MessageType;
    timestamp?: number;
    sequence?: number;
    fileId?: number | null;
  }): Promise<any> {
    const message: WebSocketMessage = {
      messageType: orderData.messageType,
      id: orderData.messageId, // ✅ 使用消息ID
      orderId: orderData.orderId,
      recipientId: orderData.recipientId,
      encryptedContent: orderData.encryptedContent,
      timestamp: orderData.timestamp || Date.now(),
      sequence: orderData.sequence,
      fileId: orderData.fileId,
    };

    return await this.send(message, { requireAck: true, timeout: 15000 });
  }

  /**
   * 兼容性封装：发送群组消息
   */
  async sendGroupMessage(
    orderId: string,
    encryptedContent: string,
    type: 'text' | 'file' = 'text'
  ): Promise<any> {
    return await this.send({
      id: this.generateMessageId(),
      messageType: type, // 复用现有的 text/file 类型
      orderId: orderId,
      encryptedContent: encryptedContent,
      timestamp: Date.now()
    }, { requireAck: true });
  }

  /**
   * 兼容性封装：发送群信令
   * 实际上是发送一条 type='system', content='JSON...' 的标准消息
   */
  async sendGroupSignal(
    orderId: string,
    signalType: string,
    payload: any
  ): Promise<any> {
    return await this.send({
      id: this.generateMessageId(),
      messageType: 'system', // 复用 system 类型
      orderId: orderId,
      content: JSON.stringify({
        type: signalType,
        payload: payload
      }),
      timestamp: Date.now()
    }, { requireAck: true });
  }

  /**
   * 注册特定类型消息的回调
   */
  on(messageType: string, callback: (data: any) => void): void {
    if (!this.messageCallbacks.has(messageType)) {
      this.messageCallbacks.set(messageType, []);
    }
    this.messageCallbacks.get(messageType)!.push(callback);
  }

  /**
   * 注册状态变化回调
   */
  onStatusChange(callback: (status: WebSocketStatus) => void): void {
    this.statusChangeCallbacks.push(callback);
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): WebSocketStatus {
    return this.status;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.status === "connected"
    );
  }

  // ========== 私有方法 ==========

  private buildWebSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.VITE_WS_URL || window.location.host;
    const token = this.getAuthToken();
    return `${protocol}//${host}/chat?token=${token}`;
  }

  private getAuthToken(): string {
    const currentUserId = sessionStorage.getItem("auth_current_user_id");
    return localStorage.getItem(`auth_${currentUserId}_token`) || "";
  }

  private setupEventListeners(): void {
    if (!this.ws) return;

    this.ws.onopen = (event) => this.handleOpen(event);
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = (event) => this.handleClose(event);
    this.ws.onerror = (error) => this.handleError(error);
  }

  private handleOpen(event: Event): void {
    console.log("[WebSocket] Connection established");
    this.updateStatus("connected");
    this.reconnectAttempts = 0;
    this.waitingForPong = false;

    // ✅ 连接恢复后重传所有待确认消息
    this.retryAllPendingMessages();

    // ✅ 根据配置决定是否启动客户端主动心跳
    if (this.config.heartbeat.enabled) {
      console.log("[WebSocket] Starting active heartbeat mode");
      this.startClientHeartbeat();
    } else {
      console.log(
        "[WebSocket] Running in passive mode (waiting for server pings)"
      );
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      console.log(
        `[WebSocket] Received message: type=${message.messageType}, id=${message.id}`
      );

      // ✅ 根据消息类型分发处理
      if (isProtocolMessage(message.messageType)) {
        // 协议消息
        this.handleProtocolMessage(message);
      } else {
        // 业务消息(统一处理，不区分离线/在线)
        this.handleBusinessMessage(message);
      }
    } catch (error) {
      console.error("[WebSocket] Message parsing error:", error);
    }
  }

  private handleClose(event: CloseEvent): void {
    console.log(
      `[WebSocket] Connection closed: ${event.code} - ${event.reason}`
    );

    this.stopHeartbeat();
    this.updateStatus("disconnected");

    if (
      event.code !== 1000 &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    }

    this.cleanupPendingAcks("Connection closed");
    this.cleanupPendingMessages("Connection closed");
  }

  private handleError(error: Event): void {
    console.error("[WebSocket] Connection error:", error);
    this.updateStatus("error");
  }

  private handleConnectionError(error: any): void {
    console.error("[WebSocket] Connection setup error:", error);
    this.updateStatus("error");
    this.scheduleReconnect();
  }

  // ========== 消息处理 ==========

  /**
   * ✅ 处理协议消息(ping/pong/ack)
   */
  private handleProtocolMessage(message: WebSocketMessage): void {
    switch (message.messageType) {
      case "ping":
        this.handlePing(message);
        break;
      case "pong":
        this.handlePong(message);
        break;
      case "ack":
        this.handleAck(message);
        break;
      default:
        console.warn(
          "[WebSocket] Unknown protocol message:",
          message.messageType
        );
    }
  }

  /**
   * ✅ 处理业务消息(text/file/image/system/contract)
   */
  private handleBusinessMessage(message: WebSocketMessage): void {
    console.log(
      `[WebSocket] Processing business message: type=${message.messageType}, id=${message.id}`
    );

    // ✅ 触发消息回调（统一处理）
    this.triggerMessageCallbacks("order_message", message);

    // ✅ 发送 ACK 确认（使用相同的消息 id）
    this.sendAck(message.id);
  }

  /**
   * 服务端发送 ping,客户端回复 pong
   */
  private handlePing(pingMessage: WebSocketMessage): void {
    console.log("[WebSocket] Ping received from server, id:", pingMessage.id);

    // ✅ pong 消息使用相同的 id
    const pongMessage: WebSocketMessage = {
      messageType: "pong",
      id: pingMessage.id, // ✅ 使用收到的 ping 的 id
    };

    try {
      this.ws!.send(JSON.stringify(pongMessage));
      console.log("[WebSocket] Pong sent to server, id:", pingMessage.id);
    } catch (error) {
      console.error("[WebSocket] Pong send error:", error);
    }
  }

  /**
   * ✅ 处理服务器返回的 pong（响应客户端的 ping）
   */
  private handlePong(pongMessage: WebSocketMessage): void {
    console.log("[WebSocket] Pong received from server, id:", pongMessage.id);
    this.waitingForPong = false;

    // 收到 pong，连接正常，重置心跳定时器
    this.resetClientHeartbeat();
  }

  // ========== ACK 确认机制 ==========

  /**
   * ✅ 带重传机制的 ACK 等待
   */
  private async waitForAckWithRetry(
    message: WebSocketMessage,
    timeout: number,
    maxRetries: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const messageId = message.id;

      // 设置超时
      const timeoutId = window.setTimeout(() => {
        this.handleMessageTimeout(messageId, maxRetries);
      }, timeout);

      // 保存消息信息用于重传
      this.pendingMessages.set(messageId, {
        message,
        retryCount: 0,
        maxRetries,
        sentTime: Date.now(),
        resolve,
        reject,
        timeoutId,
      });

      // 添加到 pendingAcks 用于 ACK 处理（保持向后兼容）
      this.pendingAcks.set(messageId, {
        resolve: (value) => {
          this.clearMessageRetry(messageId);
          resolve(value);
        },
        reject: (error) => {
          this.clearMessageRetry(messageId);
          reject(error);
        },
        timeoutId,
      });
    });
  }

  /**
   * ✅ 处理消息超时（触发重传）
   */
  private handleMessageTimeout(messageId: string, maxRetries: number): void {
    const pending = this.pendingMessages.get(messageId);
    if (!pending) return;

    const { retryCount, reject } = pending;

    if (retryCount < maxRetries) {
      // 进行重传
      this.retryMessage(messageId, maxRetries);
    } else {
      // 达到最大重试次数，失败
      console.error(
        `[WebSocket] Message ${messageId} failed after ${maxRetries} retries`
      );
      this.clearMessageRetry(messageId);
      reject(new Error(`Message delivery failed after ${maxRetries} attempts`));
    }
  }

  /**
   * ✅ 重传消息
   */
  private retryMessage(messageId: string, maxRetries: number): void {
    const pending = this.pendingMessages.get(messageId);
    if (!pending || !this.isConnected()) return;

    const { message, retryCount } = pending;
    const nextRetryCount = retryCount + 1;

    // 计算退避延迟
    const baseDelay = 1000; // 1秒基础延迟
    const backoffDelay =
      baseDelay * Math.pow(this.config.ack.retry.backoffMultiplier, retryCount);

    console.log(
      `[WebSocket] Retrying message ${messageId} (attempt ${nextRetryCount}/${maxRetries}) after ${backoffDelay}ms`
    );

    // 设置重传定时器
    const retryTimer = window.setTimeout(() => {
      if (this.isConnected()) {
        try {
          this.ws!.send(JSON.stringify(message));
          console.log(
            `[WebSocket] Retry sent: type=${message.messageType}, id=${message.id}, attempt=${nextRetryCount}/${maxRetries}`
          );

          // 更新重试计数
          this.pendingMessages.set(messageId, {
            ...pending,
            retryCount: nextRetryCount,
            sentTime: Date.now(),
          });
        } catch (error) {
          console.error(
            `[WebSocket] Retry send error for ${messageId}:`,
            error
          );
          this.handleMessageTimeout(messageId, maxRetries); // 重试发送失败也触发超时处理
        }
      }
      this.retryTimers.delete(messageId);
    }, backoffDelay);

    this.retryTimers.set(messageId, retryTimer);
  }

  /**
   * ✅ 简化的 ACK 处理 - 使用 id 字段直接关联
   */
  private handleAck(ackMessage: WebSocketMessage): void {
    // 兼容：优先使用 originalId（表示响应某条消息），如果没有则使用 id
    const messageId = ackMessage.originalId || ackMessage.id;

    if (!messageId) {
      console.warn("[WebSocket] ACK message missing id or originalId");
      return;
    }

    const pending = this.pendingAcks.get(messageId);
    if (pending) {
      window.clearTimeout(pending.timeoutId);

      pending.resolve({
        success: true,
        id: messageId,
      });

      this.pendingAcks.delete(messageId);
      console.log(`[WebSocket] ACK received for: ${messageId}`);
    } else {
      console.warn(`[WebSocket] Unexpected ACK for: ${messageId}`);
    }
  }

  /**
   * ✅ 简化的 ACK 发送 - 使用相同的消息 ID
   */
  private sendAck(messageId: string): void {
    if (!this.isConnected()) return;

    const ackMessage: WebSocketMessage = {
      messageType: "ack",
      id: messageId, // ✅ 使用原始消息的 ID
    };

    try {
      this.ws!.send(JSON.stringify(ackMessage));
      console.log(`[WebSocket] ACK sent for: ${messageId}`);
    } catch (error) {
      console.error("[WebSocket] ACK send error:", error);
    }
  }

  /**
   * ✅ 重传所有待确认消息
   */
  private retryAllPendingMessages(): void {
    if (this.pendingMessages.size === 0) return;

    console.log(
      `[WebSocket] Retrying ${this.pendingMessages.size} pending messages`
    );

    this.pendingMessages.forEach((pending, messageId) => {
      // 清除现有的重传定时器
      this.clearMessageRetry(messageId);

      // 立即重传（重置重试计数）
      if (this.isConnected()) {
        try {
          this.ws!.send(JSON.stringify(pending.message));
          console.log(`[WebSocket] Retried pending message: ${messageId}`);

          // 重置发送时间和重试计数
          this.pendingMessages.set(messageId, {
            ...pending,
            retryCount: 0,
            sentTime: Date.now(),
          });
        } catch (error) {
          console.error(
            `[WebSocket] Failed to retry pending message ${messageId}:`,
            error
          );
        }
      }
    });
  }

  /**
   * ✅ 清理消息的重传状态
   */
  private clearMessageRetry(messageId: string): void {
    // 清理重传定时器
    const retryTimer = this.retryTimers.get(messageId);
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      this.retryTimers.delete(messageId);
    }

    // 清理消息状态
    this.pendingMessages.delete(messageId);

    // 保持 pendingAcks 的清理（现有逻辑）
    const ackPending = this.pendingAcks.get(messageId);
    if (ackPending) {
      window.clearTimeout(ackPending.timeoutId);
      this.pendingAcks.delete(messageId);
    }
  }

  private cleanupPendingAcks(reason: string): void {
    this.pendingAcks.forEach((pending) => {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(`ACK cancelled: ${reason}`));
    });
    this.pendingAcks.clear();
  }

  /**
   * ✅ 清理待重传消息
   */
  private cleanupPendingMessages(reason: string): void {
    this.pendingMessages.forEach((pending) => {
      if (pending.timeoutId) {
        window.clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error(`Message cancelled: ${reason}`));
    });
    this.pendingMessages.clear();

    // 清理重传定时器
    this.retryTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    this.retryTimers.clear();
  }

  // ========== 心跳机制 ==========

  /**
   * ✅ 启动客户端主动心跳
   */
  private startClientHeartbeat(): void {
    this.stopHeartbeat();

    console.log("[WebSocket] Starting client heartbeat");

    this.heartbeatTimer = window.setTimeout(() => {
      this.sendClientPing();
    }, this.heartbeatInterval);
  }

  /**
   * ✅ 发送客户端 ping
   */
  private sendClientPing(): void {
    if (!this.isConnected()) {
      console.warn("[WebSocket] Cannot send ping - not connected");
      return;
    }

    if (this.waitingForPong) {
      console.warn(
        "[WebSocket] Previous pong not received, connection may be dead"
      );
      this.handlePongTimeout();
      return;
    }

    const pingId = this.generateMessageId();
    console.log("[WebSocket] Sending ping to server, id:", pingId);

    // ✅ ping 消息只需要 type 和 id
    const pingMessage: WebSocketMessage = {
      messageType: "ping",
      id: pingId,
    };

    try {
      this.ws!.send(JSON.stringify(pingMessage));
      this.waitingForPong = true;

      // 设置 pong 超时检测
      this.heartbeatTimer = window.setTimeout(() => {
        if (this.waitingForPong) {
          console.error("[WebSocket] Pong timeout");
          this.handlePongTimeout();
        }
      }, this.pongTimeout);
    } catch (error) {
      console.error("[WebSocket] Failed to send ping:", error);
      this.handlePongTimeout();
    }
  }

  /**
   * ✅ 重置心跳定时器（收到 pong 后调用）
   */
  private resetClientHeartbeat(): void {
    this.stopHeartbeat();

    // 下次心跳
    this.heartbeatTimer = window.setTimeout(() => {
      this.sendClientPing();
    }, this.heartbeatInterval);
  }

  /**
   * ✅ 处理 pong 超时（连接可能已断）
   */
  private handlePongTimeout(): void {
    console.error("[WebSocket] Pong timeout - connection dead");
    this.waitingForPong = false;

    // 关闭连接并触发重连
    if (this.ws) {
      this.ws.close();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ========== 重连机制 ==========

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[WebSocket] Max reconnection attempts reached");
      return;
    }

    this.updateStatus("reconnecting");
    this.reconnectAttempts++;

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
      this.reconnectTimer = null;
    }, delay);
  }

  // ========== 工具方法 ==========

  private updateStatus(newStatus: WebSocketStatus): void {
    if (this.status !== newStatus) {
      const oldStatus = this.status;
      this.status = newStatus;

      console.log(`[WebSocket] Status changed: ${oldStatus} -> ${newStatus}`);

      this.statusChangeCallbacks.forEach((callback) => {
        try {
          callback(newStatus);
        } catch (error) {
          console.error("[WebSocket] Status callback error:", error);
        }
      });
    }
  }

  private triggerMessageCallbacks(messageType: string, data: any): void {
    const callbacks = this.messageCallbacks.get(messageType) || [];
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(
          `[WebSocket] Message callback error for ${messageType}:`,
          error
        );
      }
    });
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.disconnect();

    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.messageCallbacks.clear();
    this.statusChangeCallbacks = [];
    this.pendingAcks.clear();
    this.cleanupPendingMessages("Manager cleaned up");
  }
}

// 工厂函数
const managerInstances = new Map<string, WebSocketManager>();

export function getWebSocketManager(
  userId: string | number,
  wsUrl?: string
): WebSocketManager {
  const key = String(userId); // ✅ Force string key
  if (!managerInstances.has(key)) {
    console.log(`[WebSocketManager] Creating new instance for ${key}`);
    managerInstances.set(key, new WebSocketManager(key, wsUrl));
  }
  return managerInstances.get(key)!;
}

export function cleanupWebSocketManagers(): void {
  managerInstances.forEach((manager) => manager.cleanup());
  managerInstances.clear();
}
