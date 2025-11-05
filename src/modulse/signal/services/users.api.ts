// services/users.api.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { PublicKeyBundle } from '../types';

/**
 * 用户密钥管理 API
 */
export class UsersApiService {
    private apiClient = createAuthenticatedApiClient();

    /**
     * 上传用户的公钥束到服务器，在登录时已经上传了密钥，这个也暂时不需要使用。
     */
    async uploadKeyBundle(bundle: PublicKeyBundle): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.post<{ success: boolean }>(
                '/api/users/key-bundle',
                bundle
            );

            console.log(`[UsersApi] Uploaded key bundle for user: ${bundle.userId}`);
            return response.data;

        } catch (error) {
            console.error('[UsersApi] Upload key bundle error:', error);
            throw error;
        }
    }

    /**
     * 从服务器获取指定用户的公钥束
     */
    async getKeyBundleForUser(userId: string): Promise<PublicKeyBundle> {
        try {
            const response = await this.apiClient.get<PublicKeyBundle>(
                `/api/users/${userId}/key-bundle`
            );

            console.log(`[UsersApi] Retrieved key bundle for user: ${userId}`);
            return response.data;

        } catch (error) {
            console.error(`[UsersApi] Get key bundle error for ${userId}:`, error);
            throw error;
        }
    }

    /**
     * 更新用户的公钥束（例如：PreKey 用完后补充新的。目前不做密钥管理所以不需要使用）
     */
    async updateKeyBundle(bundle: Partial<PublicKeyBundle> & { userId: string }): Promise<{ success: boolean }> {
        try {
            const response = await this.apiClient.put<{ success: boolean }>(
                `/api/users/${bundle.userId}/key-bundle`,
                bundle
            );

            console.log(`[UsersApi] Updated key bundle for user: ${bundle.userId}`);
            return response.data;

        } catch (error) {
            console.error('[UsersApi] Update key bundle error:', error);
            throw error;
        }
    }
    /**
     * 获取订单的参与者信息
     */
    async getOrderParticipants(orderId: string): Promise<{ participants: string[] }> {
        try {
            const response = await this.apiClient.get<{ participants: string[] }>(
                `/api/orders/${orderId}/participants`
            );

            console.log(`[UsersApi] Retrieved participants for order: ${orderId}`);
            return response.data;

        } catch (error) {
            console.error(`[UsersApi] Get order participants error for ${orderId}:`, error);
            throw error;
        }
    }

    /**
     * 获取用户的订单列表
     */
    async getUserOrders(userId: string): Promise<{ orderId: string; title: string; status: string }[]> {
        try {
            const response = await this.apiClient.get<{ orders: any[] }>(
                `/api/users/${userId}/orders`
            );

            console.log(`[UsersApi] Retrieved orders for user: ${userId}`);
            return response.data.orders;

        } catch (error) {
            console.error(`[UsersApi] Get user orders error for ${userId}:`, error);
            throw error;
        }
    }

}


// 默认导出实例和函数
const usersApiService = new UsersApiService();

export async function getKeyBundleForUser(userId: string): Promise<PublicKeyBundle> {
    return usersApiService.getKeyBundleForUser(userId);
}

export async function uploadKeyBundle(bundle: PublicKeyBundle): Promise<{ success: boolean }> {
    return usersApiService.uploadKeyBundle(bundle);
}

export async function updateKeyBundle(bundle: Partial<PublicKeyBundle> & { userId: string }): Promise<{ success: boolean }> {
    return usersApiService.updateKeyBundle(bundle);
}

export async function getOrderParticipants(orderId: string): Promise<{ participants: string[] }> {
    return usersApiService.getOrderParticipants(orderId);
}