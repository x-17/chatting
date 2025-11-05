// services/websocket-manager.ts

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WebSocketMessage {
    type: string                   //‘ping’, ‘pong’,'message'等等
    data?: any;
    timestamp?: number;
}

/**
 * WebSocket 连接管理器
 */
export class WebSocketManager {
    private ws: WebSocket | null = null;
    private userId: string;
    private reconnectAttempts = 0;   //重连尝试次数
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000; // 初始重连延迟
    private heartbeatInterval: number | null = null;
    //按消息类型处理消息
    private messageHandlers = new Map<string, Array<(data: any) => void>>();
    //状态变化回调
    private statusCallbacks = new Array<(status: ConnectionStatus) => void>();
    private currentStatus: ConnectionStatus = 'disconnected';

    constructor(userId: string) {
        this.userId = userId;
    }

    /**
     * 连接到 WebSocket 服务器
     */
    connect(): void {
        //防止重复连接
        if (this.ws?.readyState === WebSocket.OPEN) {
            console.log('[WebSocket] Already connected');
            return;
        }

        this.updateStatus('connecting');

        //构建WebSocket URL
        const wsUrl = this.getWebSocketUrl();
        console.log(`[WebSocket] Connecting to ${wsUrl}`);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected');
                this.reconnectAttempts = 0;
                this.updateStatus('connected');
                this.startHeartbeat();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocket] Error:', error);
                this.updateStatus('disconnected');
            };

            this.ws.onclose = () => {
                console.log('[WebSocket] Disconnected');
                this.updateStatus('disconnected');
                this.stopHeartbeat();
                this.attemptReconnect();
            };

        } catch (error) {
            console.error('[WebSocket] Connection error:', error);
            this.updateStatus('disconnected');
            this.attemptReconnect();
        }
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        console.log('[WebSocket] Disconnecting');
        this.stopHeartbeat();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.updateStatus('disconnected');
    }

    /**
     * 发送消息
     */
    send(message: WebSocketMessage): boolean {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error('[WebSocket] Send error:', error);
                return false;
            }
        }

        console.warn('[WebSocket] Cannot send - not connected');
        return false;
    }

    /**
     * 注册消息处理器
     */
    on(messageType: string, handler: (data: any) => void): void {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType)!.push(handler);
    }

    /**
     * 注册状态回调
     */
    onStatusChange(callback: (status: ConnectionStatus) => void): void {
        this.statusCallbacks.push(callback);
    }

    /**
     * 获取当前状态
     */
    getStatus(): ConnectionStatus {
        return this.currentStatus;
    }

    /**
     * 是否已连接
     */
    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    // ========== 私有方法 ==========

    private getWebSocketUrl(): string {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = import.meta.env.VITE_WS_URL || window.location.host;
        return `${protocol}//${host}/ws?userId=${this.userId}&token=${this.getAuthToken()}`;
    }

    private getAuthToken(): string {
        const currentUserId = sessionStorage.getItem('auth_current_user_id');
        return localStorage.getItem(`auth_${currentUserId}_token`) || '';
    }

    private handleMessage(data: string): void {
        try {
            const message: WebSocketMessage = JSON.parse(data);

            // 处理 pong 响应
            if (message.type === 'pong') {
                return;
            }

            // 触发对应类型的处理器
            const handlers = this.messageHandlers.get(message.type);
            if (handlers) {
                handlers.forEach(handler => {
                    try {
                        handler(message.data);
                    } catch (error) {
                        console.error(`[WebSocket] Handler error for ${message.type}:`, error);
                    }
                });
            }

            // 触发通用处理器
            const allHandlers = this.messageHandlers.get('*');
            if (allHandlers) {
                allHandlers.forEach(handler => handler(message));
            }

        } catch (error) {
            console.error('[WebSocket] Message parse error:', error);
        }
    }

    private updateStatus(status: ConnectionStatus): void {
        if (this.currentStatus !== status) {
            this.currentStatus = status;
            console.log(`[WebSocket] Status changed to: ${status}`);

            this.statusCallbacks.forEach(callback => {
                try {
                    callback(status);
                } catch (error) {
                    console.error('[WebSocket] Status callback error:', error);
                }
            });
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[WebSocket] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // 指数退避

        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.updateStatus('reconnecting');

        setTimeout(() => {
            this.connect();
        }, delay);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.heartbeatInterval = window.setInterval(() => {
            if (this.isConnected()) {
                this.send({ type: 'ping', timestamp: Date.now() });
            }
        }, 30000); // 每30秒发送一次心跳
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval !== null) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}