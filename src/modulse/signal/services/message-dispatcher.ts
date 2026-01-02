// src/e2ee/services/message-dispatcher.ts

import { getWebSocketManager, WebSocketManager } from '../../signal/services/websocket-manager';
import { getEnhancedP2PRouter } from '../../signal/services/p2p-message-router.enhanced';
import { getGroupMessageRouter } from '../../groupchat/services/enhanced-group-message-router.ts';

/**
 * ✅ 统一消息分发器
 *
 * 职责：
 * 1. 作为 WebSocket 消息的唯一监听者
 * 2. 根据消息特征（recipientId）分发到不同的路由
 * 3. 避免 P2P 和 Group Router 重复监听
 */
export class MessageDispatcher {
    private wsManager: WebSocketManager;
    private myUserId: string;
    private isInitialized = false;

    constructor(userId: string) {
        this.myUserId = userId;
        this.wsManager = getWebSocketManager(userId);
    }

    /**
     * 初始化分发器
     */
    initialize(): void {
        if (this.isInitialized) {
            console.log('[Dispatcher] Already initialized');
            return;
        }

        this.setupUnifiedListener();
        this.isInitialized = true;

        console.log('[Dispatcher] Initialized for user:', this.myUserId);
    }

    /**
     * ✅ 核心：统一监听并分发消息
     */
    private setupUnifiedListener(): void {
        // ========== 1. 监听所有业务消息 ==========
        // WebSocketManager 会把所有业务消息（text/file/system/userIn/userOut）
        // 统一触发 'order_message' 事件

        this.wsManager.on('order_message', (data) => {
            console.log('[Dispatcher] Received order_message:', {
                type: data.messageType,
                orderId: data.orderId,
                recipientId: data.recipientId || 'none',
                senderId: data.senderId
            });

            // ✅ 根据消息类型和特征分发
            this.dispatchMessage(data);
        });

        console.log('[Dispatcher] Unified listener setup complete');
    }

    /**
     * ✅ 消息分发核心逻辑
     */
    private dispatchMessage(data: any): void {
        const { messageType, recipientId, orderId } = data;

        // ========== 分发规则 ==========

        // 1️⃣ 群聊系统广播消息（优先级最高）
        if (messageType === 'userIn' || messageType === 'userOut') {
            this.dispatchToGroup(messageType, data);
            return;
        }

        // 2️⃣ 系统消息（可能是群聊信令,目前没用）
        if (messageType === 'system') {
            this.dispatchToGroup(messageType, data);
            return;
        }

        // 3️⃣ 业务消息：根据 recipientId 区分 P2P 和群聊
        if (messageType === 'text' || messageType === 'file' || messageType === 'contract' || messageType === 'key_distribution') {
            // ✅ 关键判断：有 recipientId 且不为空 → P2P
            if (recipientId && recipientId !== null && recipientId !== '' && recipientId !== 'null') {
                this.dispatchToP2P(messageType, data);
            }
            // ✅ 无 recipientId → 群聊
            else if (orderId) {
                this.dispatchToGroup(messageType, data);
            }
            else {
                console.warn('[Dispatcher] Unknown message format:', data);
            }
            return;
        }

        // 4️⃣ 未知类型
        console.warn('[Dispatcher] Unknown message type:', messageType);
    }

    /**
     * ✅ 分发到 P2P 路由
     */
    private dispatchToP2P(messageType: string, data: any): void {
        console.log(`[Dispatcher] → P2P Router: ${messageType}`);

        try {
            const p2pRouter = getEnhancedP2PRouter(this.myUserId);

            switch (messageType) {
                case 'text':
                case 'file':
                case 'contract':
                    // ✅ 调用 P2P Router 的公共处理方法
                    p2pRouter.handleIncomingMessage(data);
                    break;

                case 'key_distribution':
                    // ✅ 密钥分发
                    p2pRouter.handleKeyDistributionMessage(data);
                    break;

                default:
                    console.warn(`[Dispatcher] Unhandled P2P message type: ${messageType}`);
            }
        } catch (error) {
            console.error('[Dispatcher] P2P dispatch error:', error);
        }
    }

    /**
     * ✅ 分发到群聊路由
     */
    private dispatchToGroup(messageType: string, data: any): void {
        console.log(`[Dispatcher] → Group Router: ${messageType}`);

        try {
            const groupRouter = getGroupMessageRouter(this.myUserId);

            switch (messageType) {
                case 'text':
                case 'file':
                    // ✅ 调用 Group Router 的公共处理方法
                    groupRouter.handleIncomingBusinessMessage(data);
                    break;

                case 'userIn':
                    groupRouter.handleUserInMessage(data);
                    break;

                case 'userOut':
                    groupRouter.handleUserOutMessage(data);
                    break;

                case 'system':
                    groupRouter.handleSystemMessage(data);
                    break;

                default:
                    console.warn(`[Dispatcher] Unhandled group message type: ${messageType}`);
            }
        } catch (error) {
            console.error('[Dispatcher] Group dispatch error:', error);
        }
    }

    /**
     * 清理资源
     */
    cleanup(): void {
        this.isInitialized = false;
        console.log('[Dispatcher] Cleaned up');
    }
}

// ========== 工厂函数 ==========

const dispatcherInstances = new Map<string, MessageDispatcher>();

export function getMessageDispatcher(userId: string): MessageDispatcher {
    if (!dispatcherInstances.has(userId)) {
        dispatcherInstances.set(userId, new MessageDispatcher(userId));
    }
    return dispatcherInstances.get(userId)!;
}

export function clearAllDispatchers(): void {
    dispatcherInstances.forEach(dispatcher => dispatcher.cleanup());
    dispatcherInstances.clear();
}