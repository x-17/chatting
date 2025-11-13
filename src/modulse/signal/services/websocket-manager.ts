// signal/services/websocket-manager.ts

import type { MessageType } from '../types/message.types';
import { isProtocolMessage } from '../types/message.types';
import type {WebSocketConfig} from "./websocket.config.ts";
import {DEFAULT_WEBSOCKET_CONFIG} from "./websocket.config.ts";

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

/**
 * ✅ 统一的 WebSocket 消息格式
 */
interface WebSocketMessage {
    messageType: MessageType;  // ✅ 使用统一的 MessageType
    id: string;

    // 业务消息字段(仅当 type 为业务消息时存在)
    orderId?: string;
    encryptedContent?: string;
    sequence?: number;
    fileId?: number | null;
    recipientId?: string;

    // ACK 确认字段(仅当 type='ack' 时存在)
    originalId?: number;
    status?: string;

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
    private pendingAcks = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timeoutId: number;
    }>();

    private status: WebSocketStatus = 'disconnected';
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
                ...config?.heartbeat
            },
            reconnect: {
                ...DEFAULT_WEBSOCKET_CONFIG.reconnect,
                ...config?.reconnect
            },
            ack: {
                ...DEFAULT_WEBSOCKET_CONFIG.ack,
                ...config?.ack
            }
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
        if (this.isConnected() || this.status === 'connecting') {
            console.log('[WebSocket] Already connected or connecting');
            return;
        }

        this.updateStatus('connecting');

        try {
            this.ws = new WebSocket(this.wsUrl!);
            this.setupEventListeners();
        } catch (error) {
            console.error('[WebSocket] Connection failed:', error);
            this.handleConnectionError(error);
        }
    }

    /**
     * 断开 WebSocket 连接
     */
    disconnect(): void {
        console.log('[WebSocket] Disconnecting...');

        this.stopHeartbeat();
        this.cleanupPendingAcks('Connection closed');

        if (this.ws) {
            this.ws.close(1000, 'Normal closure');
            this.ws = null;
        }

        this.updateStatus('disconnected');
        this.reconnectAttempts = 0;
    }

    /**
     * 发送消息
     */
    async send(message: WebSocketMessage, options: {
        requireAck?: boolean;
        timeout?: number;
    } = {}): Promise<any> {
        const requireAck = options.requireAck ?? true;
        const timeout = options.timeout ?? 10000;

        if (!this.isConnected()) {
            console.warn('[WebSocket] Cannot send - not connected');
            throw new Error('WebSocket not connected');
        }

        // 确保消息有时间戳
        const messageToSend: WebSocketMessage = {
            ...message,
            timestamp: message.timestamp || Date.now()
        };

        try {
            this.ws!.send(JSON.stringify(messageToSend));

            console.log(`[WebSocket] Sent message: type=${message.type} (Timestamp: ${messageToSend.timestamp})`);

            // ✅ 协议消息(ping/pong/ack)不需要等待 ACK
            if (isProtocolMessage(message.type)) {
                return { success: true, timestamp: messageToSend.timestamp };
            }

            // ✅ 业务消息需要等待 ACK
            if (requireAck) {
                return await this.waitForAck(messageToSend.timestamp, timeout);
            }

            return { success: true, timestamp: messageToSend.timestamp };

        } catch (error) {
            console.error('[WebSocket] Send error:', error);
            throw error;
        }
    }

    /**
     * 发送订单消息
     */
    async sendOrderMessage(orderData: {
        orderId: string;
        encryptedContent: string;
        messageType: MessageType;  // ✅ 使用 MessageType
        timestamp?: number;
        sequence?: number;
        fileId?: number | null;
    }): Promise<void> {
        const message: WebSocketMessage = {
            messageType: orderData.messageType,  // ✅ 直接使用业务消息类型
            orderId: orderData.orderId,
            encryptedContent: orderData.encryptedContent,
            timestamp: orderData.timestamp || Date.now(),
            sequence: orderData.sequence,
            fileId: orderData.fileId
        };

        await this.send(message, { requireAck: true, timeout: 15000 });
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
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.status === 'connected';
    }

    // ========== 私有方法 ==========

    private buildWebSocketUrl(): string {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = import.meta.env.VITE_WS_URL || window.location.host;
        const token = this.getAuthToken();
        return `${protocol}//${host}/chat?token=${token}`;
    }

    private getAuthToken(): string {
        const currentUserId = sessionStorage.getItem('auth_current_user_id');
        return localStorage.getItem(`auth_${currentUserId}_token`) || '';
    }

    private setupEventListeners(): void {
        if (!this.ws) return;

        this.ws.onopen = (event) => this.handleOpen(event);
        this.ws.onmessage = (event) => this.handleMessage(event);
        this.ws.onclose = (event) => this.handleClose(event);
        this.ws.onerror = (error) => this.handleError(error);
    }

    private handleOpen(event: Event): void {
        console.log('[WebSocket] Connection established');
        this.updateStatus('connected');
        this.reconnectAttempts = 0;
        this.waitingForPong = false;

        // ✅ 启动客户端主动心跳
        this.startClientHeartbeat();
    }

    private handleMessage(event: MessageEvent): void {
        try {
            const message: WebSocketMessage = JSON.parse(event.data);

            console.log(`[WebSocket] Received message: type=${message.type}, timestamp=${message.timestamp}`);

            // ✅ 根据消息类型分发处理
            if (isProtocolMessage(message.type)) {
                // 协议消息
                this.handleProtocolMessage(message);
            } else {
                // 业务消息(统一处理，不区分离线/在线)
                this.handleBusinessMessage(message);
            }

        } catch (error) {
            console.error('[WebSocket] Message parsing error:', error);
        }
    }

    private handleClose(event: CloseEvent): void {
        console.log(`[WebSocket] Connection closed: ${event.code} - ${event.reason}`);

        this.stopHeartbeat();
        this.updateStatus('disconnected');

        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
        }

        this.cleanupPendingAcks('Connection closed');
    }

    private handleError(error: Event): void {
        console.error('[WebSocket] Connection error:', error);
        this.updateStatus('error');
    }

    private handleConnectionError(error: any): void {
        console.error('[WebSocket] Connection setup error:', error);
        this.updateStatus('error');
        this.scheduleReconnect();
    }

    // ========== 消息处理 ==========

    /**
     * ✅ 处理协议消息(ping/pong/ack)
     */
    private handleProtocolMessage(message: WebSocketMessage): void {
        switch (message.type) {
            case 'ping':
                this.handlePing(message);
                break;
            case 'pong':
                this.handlePong(message);
                break;
            case 'ack':
                this.handleAck(message);
                break;
            default:
                console.warn('[WebSocket] Unknown protocol message:', message.type);
        }
    }

    /**
     * ✅ 处理业务消息(text/file/image/system/contract)
     */
    private handleBusinessMessage(message: WebSocketMessage): void {
        console.log(`[WebSocket] Processing business message: type=${message.type}, id=${message.id}`);

        // ✅ 触发消息回调（统一处理）
        this.triggerMessageCallbacks('order_message', message);

        // ✅ 发送 ACK 确认
        this.sendAck(message.timestamp, 'delivered');
    }

    /**
     * 服务端发送 ping,客户端回复 pong
     */
    private handlePing(pingMessage: WebSocketMessage): void {
        console.log('[WebSocket] Ping received from server');

        const pongMessage: WebSocketMessage = {
            id: pingMessage.id,
            messageType: 'pong',
            timestamp: Date.now()
        };

        try {
            this.ws!.send(JSON.stringify(pongMessage));
            console.log('[WebSocket] Pong sent to server');
        } catch (error) {
            console.error('[WebSocket] Pong send error:', error);
        }
    }

    /**
     * ✅ 处理服务器返回的 pong（响应客户端的 ping）
     */
    private handlePong(pongMessage: WebSocketMessage): void {
        console.log('[WebSocket] Pong received from server');
        this.waitingForPong = false;

        // 收到 pong，连接正常，重置心跳定时器
        this.resetClientHeartbeat();
    }

    // ========== ACK 确认机制 ==========

    private async waitForAck(timestamp: number, timeout: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                this.pendingAcks.delete(timestamp);
                reject(new Error(`ACK timeout for message ${timestamp}`));
            }, timeout);

            this.pendingAcks.set(timestamp, { resolve, reject, timeoutId });
        });
    }

    private handleAck(ackMessage: WebSocketMessage): void {
        const originalTimestamp = ackMessage.originalTimestamp;
        const ackStatus = ackMessage.status;

        if (!originalTimestamp) {
            console.warn('[WebSocket] ACK message missing originalTimestamp');
            return;
        }

        const pending = this.pendingAcks.get(originalTimestamp);
        if (pending) {
            window.clearTimeout(pending.timeoutId);

            pending.resolve({
                success: true,
                timestamp: originalTimestamp,
                status: ackStatus,
                serverTime: ackMessage.timestamp
            });

            this.pendingAcks.delete(originalTimestamp);
            console.log(`[WebSocket] ACK received for: ${originalTimestamp}, status: ${ackStatus}`);
        } else {
            console.warn(`[WebSocket] Unexpected ACK for: ${originalTimestamp}`);
        }
    }

    /**
     * 发送 ACK 确认
     */
    private sendAck(originalTimestamp: number, status: string): void {
        if (!this.isConnected()) return;

        const ackMessage: WebSocketMessage = {
            messageType: 'ack',
            timestamp: Date.now(),
            originalTimestamp: originalTimestamp,
            status: status
        };

        try {
            this.ws!.send(JSON.stringify(ackMessage));
            console.log(`[WebSocket] ACK sent for: ${originalTimestamp}, status: ${status}`);
        } catch (error) {
            console.error('[WebSocket] ACK send error:', error);
        }
    }

    private cleanupPendingAcks(reason: string): void {
        this.pendingAcks.forEach((pending, timestamp) => {
            window.clearTimeout(pending.timeoutId);
            pending.reject(new Error(`ACK cancelled: ${reason}`));
        });
        this.pendingAcks.clear();
    }

    // ========== 心跳机制 ==========

    /**
     * ✅ 启动客户端主动心跳
     */
    private startClientHeartbeat(): void {
        this.stopHeartbeat();

        console.log('[WebSocket] Starting client heartbeat');

        this.heartbeatTimer = window.setTimeout(() => {
            this.sendClientPing();
        }, this.heartbeatInterval);
    }

    /**
     * ✅ 发送客户端 ping
     */
    private sendClientPing(): void {
        if (!this.isConnected()) {
            console.warn('[WebSocket] Cannot send ping - not connected');
            return;
        }

        if (this.waitingForPong) {
            console.warn('[WebSocket] Previous pong not received, connection may be dead');
            this.handlePongTimeout();
            return;
        }

        console.log('[WebSocket] Sending ping to server');

        const pingMessage: WebSocketMessage = {
            messageType: 'ping',
        };

        try {
            this.ws!.send(JSON.stringify(pingMessage));
            this.waitingForPong = true;

            // 设置 pong 超时检测
            this.heartbeatTimer = window.setTimeout(() => {
                if (this.waitingForPong) {
                    console.error('[WebSocket] Pong timeout');
                    this.handlePongTimeout();
                }
            }, this.pongTimeout);

        } catch (error) {
            console.error('[WebSocket] Failed to send ping:', error);
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
        console.error('[WebSocket] Pong timeout - connection dead');
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
            console.error('[WebSocket] Max reconnection attempts reached');
            return;
        }

        this.updateStatus('reconnecting');
        this.reconnectAttempts++;

        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

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

            this.statusChangeCallbacks.forEach(callback => {
                try {
                    callback(newStatus);
                } catch (error) {
                    console.error('[WebSocket] Status callback error:', error);
                }
            });
        }
    }

    private triggerMessageCallbacks(messageType: string, data: any): void {
        const callbacks = this.messageCallbacks.get(messageType) || [];
        callbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[WebSocket] Message callback error for ${messageType}:`, error);
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
    }
}

// 工厂函数
const managerInstances = new Map<string, WebSocketManager>();

export function getWebSocketManager(userId: string, wsUrl?: string): WebSocketManager {
    if (!managerInstances.has(userId)) {
        managerInstances.set(userId, new WebSocketManager(userId, wsUrl));
    }
    return managerInstances.get(userId)!;
}

export function cleanupWebSocketManagers(): void {
    managerInstances.forEach(manager => manager.cleanup());
    managerInstances.clear();
}