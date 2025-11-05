// src/e2ee/services/websocket-message-sender.ts
//参考代码
import type { IMessageSender } from './group-management-service';

/**
 * 基于 WebSocket 的真实网络消息发送器
 * 可以替换 MockMessageSender 用于生产环境
 */
export class WebSocketMessageSender implements IMessageSender {
    private ws: WebSocket | null = null;
    private messageQueue: Array<{type: string, target: string, message: any}> = [];
    private isConnected = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;

    constructor(private serverUrl: string, private userId: string) {
        this.connect();
    }

    private connect(): void {
        try {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected to server');
                this.isConnected = true;
                this.reconnectAttempts = 0;

                // 认证用户
                this.ws?.send(JSON.stringify({
                    type: 'AUTH',
                    userId: this.userId,
                    timestamp: Date.now()
                }));

                // 发送队列中的消息
                this.flushMessageQueue();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleServerMessage(data);
                } catch (error) {
                    console.error('[WebSocket] Failed to parse message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('[WebSocket] Connection closed');
                this.isConnected = false;
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocket] Connection error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('[WebSocket] Failed to connect:', error);
            this.attemptReconnect();
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

            console.log(`[WebSocket] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            console.error('[WebSocket] Max reconnection attempts reached');
        }
    }

    private flushMessageQueue(): void {
        while (this.messageQueue.length > 0 && this.isConnected) {
            const queuedMessage = this.messageQueue.shift();
            if (queuedMessage) {
                this.sendMessageToServer(queuedMessage);
            }
        }
    }

    private sendMessageToServer(payload: {type: string, target: string, message: any}): void {
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'SEND_MESSAGE',
                ...payload,
                senderId: this.userId,
                timestamp: Date.now()
            }));
        } else {
            // 连接断开时加入队列
            this.messageQueue.push(payload);
        }
    }

    private handleServerMessage(data: any): void {
        // 处理从服务器接收到的消息
        if (data.type === 'MESSAGE_RECEIVED') {
            // 这里可以触发本地的消息处理逻辑
            // 需要集成到现有的 MessageRouter 系统
            console.log('[WebSocket] Received message:', data);
        }
    }

    /**
     * 发送消息给特定用户
     */
    async sendToUser(userId: string, message: any): Promise<void> {
        const payload = {
            type: 'user',
            target: userId,
            message
        };

        this.sendMessageToServer(payload);
    }

    /**
     * 发送消息给群组
     */
    async sendToGroup(orderId: string, message: any): Promise<void> {
        const payload = {
            type: 'group',
            target: orderId,
            message
        };

        this.sendMessageToServer(payload);
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        this.isConnected = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// HTTP API 替代方案（适用于不支持 WebSocket 的环境）
export class HTTPMessageSender implements IMessageSender {
    constructor(private apiBaseUrl: string, private authToken: string) {}

    async sendToUser(userId: string, message: any): Promise<void> {
        await this.sendRequest('/api/messages/user', {
            targetUserId: userId,
            message,
            timestamp: Date.now()
        });
    }

    async sendToGroup(orderId: string, message: any): Promise<void> {
        await this.sendRequest('/api/messages/group', {
            targetGroupId: orderId,
            message,
            timestamp: Date.now()
        });
    }

    private async sendRequest(endpoint: string, data: any): Promise<void> {
        try {
            const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('[HTTP] Failed to send message:', error);
            throw error;
        }
    }
}