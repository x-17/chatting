// services/p2p-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { PersistedP2PMessage } from '../types/message.types';

/**
 * P2P 消息 HTTP API 服务（基于订单） - 增强版本
 */
export class P2PApiService {
    private apiClient = createAuthenticatedApiClient();

    /**
     * 发送消息到服务器（用于离线用户）- 基于订单
     */
    async sendMessage(message: PersistedP2PMessage) {
        try {
            // 构建请求体符合文档规范
            const requestBody = {
                id: message.id,
                senderId: message.senderId,
                recipientId: message.recipientId,
                orderId: message.orderId,
                encryptedContent: message.encryptedContent,
                messageType: message.messageType,
                timestamp: message.timestamp,
                status: message.status,
                sequence: message.sequence,
                fileId: message.fileId
            };

            // 发送 POST 请求
            const response = await this.apiClient.post('/insert', requestBody);

            // 判断返回码
            if (response.data.code !== 1) {
                throw new Error(`发送失败: ${response.data.msg || '未知错误'}`);
            }

            console.log(
                `[P2PApi] Order message sent for order ${message.orderId}: ${response.data.data.id}`
            );

            // 返回 data 字段
            return response.data.data;

        } catch (error) {
            console.error('[P2PApi] Send order message error:', error);

            // 错误分类
            if (this.isNetworkError(error)) {
                throw new Error('网络连接失败，请检查网络后重试');
            } else if (this.isServerError(error)) {
                throw new Error('服务器暂时不可用，请稍后重试');
            } else if (this.isAuthError(error)) {
                throw new Error('身份验证失败，请重新登录');
            }

            throw new Error(`发送消息失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }


    /**
     * 获取离线消息 - 支持按订单过滤
     */
    async getOfflineMessages(since?: number, orderId?: string): Promise<PersistedP2PMessage[]> {
        try {
            const params: any = {};
            if (since) params.since = since;
            if (orderId) params.orderId = orderId;

            const response = await this.apiClient.get<{
                success: boolean;
                messages: PersistedP2PMessage[];
                hasMore: boolean;
                nextSince?: number;
            }>('/api/p2p/messages/offline', { params });

            console.log(`[P2PApi] Retrieved ${response.data.messages.length} offline messages${orderId ? ` for order ${orderId}` : ''}, hasMore: ${response.data.hasMore}`);
            return response.data.messages;

        } catch (error) {
            console.error('[P2PApi] Get offline messages error:', error);

            if (this.isAuthError(error)) {
                throw new Error('身份验证失败，请重新登录');
            }

            return [];
        }
    }

    /**
     * 更新消息状态（已送达/已读）
     */
    async updateMessageStatus(messageId: string, status: 'delivered' | 'read'): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.put<{ success: boolean }>(
                `/api/p2p/messages/${messageId}/status`,
                { status }
            );

            console.log(`[P2PApi] Updated message ${messageId} to ${status}`);
            return response.data;

        } catch (error) {
            console.error('[P2PApi] Update status error:', error);

            // 对于状态更新失败，不抛出错误，避免影响用户体验
            return { success: false };
        }
    }

    /**
     * 批量更新消息状态
     */
    async batchUpdateStatus(messageIds: string[], status: 'delivered' | 'read'): Promise<{ success: boolean; processed: number }> {
        try {
            const response = await this.apiClient.post<{
                success: boolean;
                processed: number;
                failed?: string[];
            }>('/api/p2p/messages/batch-status', {
                messageIds,
                status
            });

            console.log(`[P2PApi] Batch updated ${response.data.processed}/${messageIds.length} messages to ${status}`);
            return response.data;

        } catch (error) {
            console.error('[P2PApi] Batch update error:', error);

            // 部分失败时仍然返回成功处理的数量为0
            return { success: false, processed: 0 };
        }
    }

    /**
     * 获取订单的聊天历史（从服务器）
     */
    async getOrderMessages(orderId: string, since?: number, limit: number = 50): Promise<PersistedP2PMessage[]> {
        try {
            const params: any = { orderId, limit };
            if (since) params.since = since;

            const response = await this.apiClient.get<{
                success: boolean;
                messages: PersistedP2PMessage[];
                hasMore: boolean;
                oldestTimestamp?: number;
            }>('/api/p2p/messages/order', { params });

            console.log(`[P2PApi] Retrieved ${response.data.messages.length} messages for order ${orderId}, hasMore: ${response.data.hasMore}`);
            return response.data.messages;

        } catch (error) {
            console.error(`[P2PApi] Get order messages error for ${orderId}:`, error);

            if (this.isAuthError(error)) {
                throw new Error('身份验证失败，请重新登录');
            }

            return [];
        }
    }

    /**
     * 获取订单的消息同步状态
     */
    async getOrderSyncStatus(orderId: string): Promise<{
        success: boolean;
        lastMessageTimestamp: number;
        unreadCount: number;
        pendingCount: number;
    }> {
        try {
            const response = await this.apiClient.get<{
                success: boolean;
                lastMessageTimestamp: number;
                unreadCount: number;
                pendingCount: number;
            }>(`/api/p2p/orders/${orderId}/sync-status`);

            console.log(`[P2PApi] Retrieved sync status for order ${orderId}`);
            return response.data;

        } catch (error) {
            console.error(`[P2PApi] Get order sync status error for ${orderId}:`, error);

            // 返回默认状态
            return {
                success: false,
                lastMessageTimestamp: 0,
                unreadCount: 0,
                pendingCount: 0
            };
        }
    }

    /**
     * 检查服务器连接状态
     */
    async checkConnection(): Promise<{
        success: boolean;
        timestamp: number;
        serverTime: number;
        latency: number;
    }> {
        try {
            const startTime = Date.now();
            const response = await this.apiClient.get<{
                success: boolean;
                timestamp: number;
            }>('/api/p2p/health');
            const endTime = Date.now();

            return {
                success: response.data.success,
                timestamp: response.data.timestamp,
                serverTime: response.data.timestamp,
                latency: endTime - startTime
            };

        } catch (error) {
            console.error('[P2PApi] Connection check failed:', error);
            return {
                success: false,
                timestamp: Date.now(),
                serverTime: 0,
                latency: -1
            };
        }
    }

    /**
     * 上传文件到服务器
     */
    async uploadFile(fileData: FormData): Promise<{
        success: boolean;
        fileId: string;
        downloadUrl: string;
        uploadTime: number;
    }> {
        try {
            const response = await this.apiClient.post<{
                success: boolean;
                fileId: string;
                downloadUrl: string;
                uploadTime: number;
            }>('/api/p2p/files/upload', fileData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                },
                timeout: 300000 // 5分钟超时
            });

            console.log(`[P2PApi] File uploaded successfully: ${response.data.fileId}`);
            return response.data;

        } catch (error) {
            console.error('[P2PApi] File upload error:', error);

            if (this.isNetworkError(error)) {
                throw new Error('文件上传失败，网络连接异常');
            } else if (this.isServerError(error)) {
                throw new Error('服务器暂时不可用，请稍后重试');
            }

            throw new Error(`文件上传失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 下载文件从服务器
     */
    async downloadFile(fileId: string): Promise<ArrayBuffer> {
        try {
            const response = await this.apiClient.get<ArrayBuffer>(
                `/api/p2p/files/${fileId}/download`,
                {
                    responseType: 'arraybuffer',
                    timeout: 300000 // 5分钟超时
                }
            );

            console.log(`[P2PApi] File downloaded successfully: ${fileId}`);
            return response.data;

        } catch (error) {
            console.error(`[P2PApi] File download error for ${fileId}:`, error);

            if (this.isNetworkError(error)) {
                throw new Error('文件下载失败，网络连接异常');
            } else if (this.isNotFoundError(error)) {
                throw new Error('文件不存在或已过期');
            }

            throw new Error(`文件下载失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // ========== 错误类型判断辅助方法 ==========

    private isNetworkError(error: any): boolean {
        return error?.code === 'NETWORK_ERROR' ||
            error?.code === 'ECONNABORTED' ||
            error?.message?.includes('network') ||
            error?.message?.includes('timeout');
    }

    private isServerError(error: any): boolean {
        const status = error?.response?.status;
        return status >= 500 && status < 600;
    }

    private isAuthError(error: any): boolean {
        return error?.response?.status === 401;
    }

    private isNotFoundError(error: any): boolean {
        return error?.response?.status === 404;
    }
}