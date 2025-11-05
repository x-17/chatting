// chat/composables/useConversationInit.ts

import { useAuthStore } from '../../auth/services/auth.store';
import { getEnhancedP2PRouter } from '../../signal/services/p2p-message-router.enhanced';
import { getEnhancedGroupRouter } from '../../groupchat/services/enhanced-group-message-router';
import type { Order } from '../types/chat.types';

export function useConversationInit() {
    const authStore = useAuthStore();

    /**
     * 主动初始化会话 - 在用户打开订单时调用
     * 确保通信通道就绪，避免首次发送延迟
     */
    async function initConversation(order: Order): Promise<void> {
        console.log('[ConversationInit] Initializing:', order.conversationType, order.conversationId);

        try {
            if (order.conversationType === 'p2p') {
                await initP2PConversation(order);
            } else if (order.conversationType === 'group') {
                await initGroupConversation(order);
            } else {
                throw new Error(`Unknown conversation type: ${order.conversationType}`);
            }

            console.log('[ConversationInit] Initialization complete');
        } catch (error) {
            console.error('[ConversationInit] Failed:', error);
            throw error;
        }
    }

    /**
     * 初始化P2P会话
     * 策略：预建立Session（可选），至少确保WebSocket连接
     */
    async function initP2PConversation(order: Order): Promise<void> {
        const p2pRouter = getEnhancedP2PRouter(authStore.user!.id);

        // 1. 初始化WebSocket连接
        await p2pRouter.init();

        const otherUserId = order.otherParty.id;

        // 2. 检查是否已有Session
        const hasSession = await p2pRouter.hasSession(otherUserId);

        if (!hasSession) {
            console.log('[ConversationInit] No existing session, will build on first send');
            // ⚠️ 选项A：立即预建立Session（主动）
            // await p2pRouter.ensureSession(otherUserId);

            // ✅ 选项B：等待首次发送时建立（保持原逻辑）
            // 当前 sendMessage 已经自动处理，这里不需要额外操作
        } else {
            console.log('[ConversationInit] Session already exists');
        }
    }

    /**
     * 初始化群组会话
     * 必须：初始化路由器 + 同步SenderKey
     */
    async function initGroupConversation(order: Order): Promise<void> {
        const groupRouter = getEnhancedGroupRouter(authStore.user!.id);

        // 1. 初始化群组路由器（包含WebSocket）
        await groupRouter.init([order.conversationId]);

        // 2. 同步该群的所有SenderKey分发消息
        try {
            await groupRouter.syncGroupKeys(order.conversationId);
            console.log('[ConversationInit] Group keys synced');
        } catch (error) {
            console.warn('[ConversationInit] Failed to sync group keys:', error);
            // 不影响继续使用，首次发送时会自动创建
        }
    }

    return {
        initConversation
    };
}