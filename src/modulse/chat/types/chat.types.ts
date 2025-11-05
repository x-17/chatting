// chat/types/chat.types.ts

import type { P2PMessage } from '../../signal/types/message.types';
import type { GroupMessage } from '../../groupchat/types/group-message.types';

export type ChatMessage = (P2PMessage | GroupMessage) & {
    __conversationType?: 'p2p' | 'group'; // 添加可选的会话类型标识
};

export interface Order {
    id: string;
    title: string;
    type: 'purchase' | 'sale';
    status: 'active' | 'completed';
    otherParty: {
        id: string;
        name: string;
        avatar?: string;
    };
    conversationId: string;
    conversationType: 'p2p' | 'group';
    amount?: number;
    currency?: string;
    createdAt: number;
    lastMessageTime?: number;
    lastMessageContent?: string;
    unreadCount: number;
}

export interface Conversation {
    id: string;
    orderId: string;
    type: 'p2p' | 'group';
    participantIds: string[];
    messages: ChatMessage[];
}