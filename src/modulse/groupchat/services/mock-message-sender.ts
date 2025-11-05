// src/e2ee/services/mock-message-sender.ts

import type { IMessageSender } from './group-management-service';

/**
 * 模拟消息发送器，用于本地测试
 * 将发送的消息存储在内存中，以便测试代码可以验证
 */
export class MockMessageSender implements IMessageSender {
    // 存储发送的消息
    public sentMessages: Array<{
        type: 'user' | 'group';
        target: string;
        message: any;
        timestamp: number;
    }> = [];

    // 可选：注册消息处理回调函数
    private messageHandlers: Array<(message: any) => void> = [];

    /**
     * 发送消息给特定用户
     */
    async sendToUser(userId: string, message: any): Promise<void> {
        console.log(`[Mock] Sending to user ${userId}:`, message);

        this.sentMessages.push({
            type: 'user',
            target: userId,
            message,
            timestamp: Date.now()
        });

        // 模拟网络延迟
        await this.simulateNetworkDelay();

        // 如果有注册的消息处理程序，自动触发它们
        this.triggerMessageHandlers(message);
    }

    /**
     * 发送消息给群组
     */
    async sendToGroup(groupId: string, message: any): Promise<void> {
        console.log(`[Mock] Sending to group ${groupId}:`, message);

        this.sentMessages.push({
            type: 'group',
            target: groupId,
            message,
            timestamp: Date.now()
        });

        // 模拟网络延迟
        await this.simulateNetworkDelay();

        // 如果有注册的消息处理程序，自动触发它们
        this.triggerMessageHandlers(message);
    }

    /**
     * 模拟网络延迟
     */
    private async simulateNetworkDelay(): Promise<void> {
        // 添加随机延迟（10-100ms）来模拟网络不确定性
        const delay = Math.floor(Math.random() * 90) + 10;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * 注册消息处理回调
     */
    onMessage(handler: (message: any) => void): void {
        this.messageHandlers.push(handler);
    }

    /**
     * 触发所有注册的消息处理程序
     */
    private triggerMessageHandlers(message: any): void {
        for (const handler of this.messageHandlers) {
            try {
                handler(message);
            } catch (error) {
                console.error('Error in message handler:', error);
            }
        }
    }

    /**
     * 获取发送给特定用户的消息
     */
    getMessagesToUser(userId: string): any[] {
        return this.sentMessages
            .filter(m => m.type === 'user' && m.target === userId)
            .map(m => m.message);
    }

    /**
     * 获取发送给特定群组的消息
     */
    getMessagesToGroup(groupId: string): any[] {
        return this.sentMessages
            .filter(m => m.type === 'group' && m.target === groupId)
            .map(m => m.message);
    }

    /**
     * 获取所有发送的消息
     */
    getAllMessages(): any[] {
        return this.sentMessages.map(m => m.message);
    }

    /**
     * 清空消息记录
     */
    clearMessages(): void {
        this.sentMessages = [];
    }

    /**
     * 模拟接收消息（用于测试）
     */
    async simulateReceiveMessage(message: any): Promise<void> {
        console.log(`[Mock] Simulating received message:`, message);
        await this.simulateNetworkDelay();
        this.triggerMessageHandlers(message);
    }
}

// 创建默认的模拟消息发送器实例
export const mockMessageSender = new MockMessageSender();