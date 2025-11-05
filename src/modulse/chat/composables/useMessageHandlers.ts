// chat/composables/useMessageHandlers.ts

import { onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '../../auth/services/auth.store';
import { getEnhancedP2PRouter } from '../../signal/services/p2p-message-router.enhanced';
import { getEnhancedGroupRouter } from '../../groupchat/services/enhanced-group-message-router';
import { useOrderStore } from '../../orders/store/order.store';
import { useChat } from './useChat';
import type { P2PMessage } from '../../signal/types/message.types';
import type { GroupMessage } from '../../groupchat/types/group-message.types';

export function useMessageHandlers() {
    const authStore = useAuthStore();
    const orderStore = useOrderStore();
    const { addMessageToConversation, updateMessageStatus } = useChat();

    let p2pRouter: ReturnType<typeof getEnhancedP2PRouter> | null = null;
    let groupRouter: ReturnType<typeof getEnhancedGroupRouter> | null = null;

    /**
     * 初始化消息监听
     */
    async function initializeHandlers(): Promise<void> {
        if (!authStore.user) {
            console.error('[MessageHandlers] No user authenticated');
            return;
        }

        try {
            // 初始化P2P路由器
            p2pRouter = getEnhancedP2PRouter(authStore.user.id);
            await p2pRouter.init();

            // 注册P2P消息处理器
            p2pRouter.onMessage((message: P2PMessage) => {
                handleP2PMessage(message);
            });

            // 注册P2P状态变化处理器
            p2pRouter.onStatusChange((status: string) => {
                console.log('[MessageHandlers] P2P connection status:', status);

                if (status === 'connected') {
                    // 连接成功后同步离线消息
                    syncOfflineMessages();
                }
            });

            // 初始化群组路由器
            groupRouter = getEnhancedGroupRouter(authStore.user.id);
            const orderList = orderStore.orderList;
            const groupIds = orderList
                .filter(order => order.conversationType === 'group')
                .map(order => order.conversationId);

            await groupRouter.init(groupIds);

            // 注册群组消息处理器
            groupRouter.onMessage((message: GroupMessage) => {
                handleGroupMessage(message);
            });

            // 注册群组状态变化处理器
            groupRouter.onStatusChange((status: string) => {
                console.log('[MessageHandlers] Group connection status:', status);
            });

            console.log('[MessageHandlers] Handlers initialized successfully');

        } catch (error) {
            console.error('[MessageHandlers] Initialization failed:', error);
        }
    }

    /**
     * 处理P2P消息
     */
    function handleP2PMessage(message: P2PMessage): void {
        console.log('[MessageHandlers] Received P2P message:', message.id);

        // 找到对应的订单/会话
        const order = orderStore.orderList.find(o =>
                o.conversationType === 'p2p' && (
                    o.buyerId === message.senderId ||
                    o.sellerId === message.senderId
                )
        );

        if (!order) {
            console.warn('[MessageHandlers] Order not found for P2P message');
            return;
        }

        // 添加到会话
        addMessageToConversation(order.conversationId, {
            ...message,
            __conversationType: 'p2p'
        });

        // 更新订单的未读数
        orderStore.updateOrderUnreadCount(order.id);

        // 显示系统通知（如果在后台）
        if (document.hidden) {
            showNotification(message, order);
        }
    }

    /**
     * 处理群组消息
     */
    function handleGroupMessage(message: GroupMessage): void {
        console.log('[MessageHandlers] Received group message:', message.id);

        // 找到对应的订单/会话
        const order = orderStore.orderList.find(o =>
            o.conversationType === 'group' &&
            o.conversationId === message.groupId
        );

        if (!order) {
            console.warn('[MessageHandlers] Order not found for group message');
            return;
        }

        // 添加到会话
        addMessageToConversation(order.conversationId, {
            ...message,
            __conversationType: 'group'
        });

        // 更新订单的未读数
        orderStore.updateOrderUnreadCount(order.id);

        // 显示系统通知（如果在后台）
        if (document.hidden && message.senderId !== authStore.user!.id) {
            showNotification(message, order);
        }
    }

    /**
     * 同步离线消息
     */
    async function syncOfflineMessages(): Promise<void> {
        console.log('[MessageHandlers] Syncing offline messages');

        try {
            // 同步P2P离线消息
            if (p2pRouter) {
                await p2pRouter.syncOfflineMessages();
            }

            // 同步群组离线消息
            if (groupRouter) {
                await groupRouter.syncAllOfflineMessages();
            }

            // 刷新订单未读数
            const orderIds = orderStore.orderList.map(o => o.id);
            await orderStore.updateUnreadCounts(orderIds);

        } catch (error) {
            console.error('[MessageHandlers] Sync offline messages failed:', error);
        }
    }

    /**
     * 显示系统通知
     */
    function showNotification(
        message: P2PMessage | GroupMessage,
        order: any
    ): void {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        const senderName = message.senderId === authStore.user!.id
            ? '我'
            : order.otherParty?.name || message.senderId;

        const title = `${order.title}`;
        const body = message.type === 'text'
            ? message.content
            : `[${message.type}]`;

        const notification = new Notification(title, {
            body: `${senderName}: ${body}`,
            icon: '/favicon.ico',
            tag: message.id
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }

    /**
     * 请求通知权限
     */
    async function requestNotificationPermission(): Promise<void> {
        if (!('Notification' in window)) {
            console.warn('[MessageHandlers] Notifications not supported');
            return;
        }

        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    }

    /**
     * 清理处理器
     */
    function cleanup(): void {
        if (p2pRouter) {
            p2pRouter.disconnect();
        }
        if (groupRouter) {
            groupRouter.disconnect();
        }
    }

    // 生命周期钩子
    onMounted(async () => {
        await initializeHandlers();
        await requestNotificationPermission();
    });

    onUnmounted(() => {
        cleanup();
    });

    return {
        syncOfflineMessages,
        requestNotificationPermission
    };
}