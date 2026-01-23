// services/users.api.ts

import { createAuthenticatedApiClient } from "../../utils/api-client";
import type { PublicKeyBundle } from "../types";

/**
 * 用户密钥管理 API - 增强版本
 */
export class UsersApiService {
  private apiClient = createAuthenticatedApiClient();

  /**
   * 上传用户的公钥束到服务器（现在不需要）
   */
  async uploadKeyBundle(bundle: PublicKeyBundle): Promise<{
    success: boolean;
    timestamp: number;
  }> {
    try {
      const response = await this.apiClient.post<{
        success: boolean;
        timestamp: number;
      }>("/api/users/key-bundle", bundle);

      console.log(`[UsersApi] Uploaded key bundle for user: ${bundle.userId}`);
      return response.data;
    } catch (error) {
      console.error("[UsersApi] Upload key bundle error:", error);

      if (this.isAuthError(error)) {
        throw new Error("身份验证失败，请重新登录后重试");
      } else if (this.isServerError(error)) {
        throw new Error("服务器暂时不可用，请稍后重试");
      }

      throw new Error(
        `上传密钥失败: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 从服务器获取指定用户的公钥束
   */
  async getKeyBundleForUser(tenantId: string) {
    try {
      // 1. 转换tenantId为number类型（匹配后端接口要求），并发起POST请求
      const response = await this.apiClient.post("/user/p2pGetUserKeys", {
        tenantId: Number(tenantId), // 转换为number传给后端
      });

      // 2. 处理后端返回的code状态
      if (response.data.code !== 1) {
        throw new Error(response.data.msg || "获取用户密钥失败");
      }

      const data = response.data.data;
      console.log("[UsersApi] Received key bundle data:", data);

      // 3. 映射后端数据到PublicKeyBundle（userId转为string，适配前端逻辑）
      const publicKeyBundle: PublicKeyBundle = {
        userId: data.userId.toString(), // 后端返回number，前端用string
        identityKey: data.identityKey,
        signedPreKey: {
          keyId: data.signedPreKeyId,
          publicKey: data.signedPreKeyPublicKey, // 对应后端signedPreKeyPublicKey
          signature: data.signedPreKeyPublicKeySignature, // 对应后端签名字段
        },
        preKey: {
          keyId: data.preKeyId,
          publicKey: data.preKeyPublicKey, // 对应后端preKeyPublicKey
        },
        signingPubKey: data.signingPubKey, // 对应后端signingPubKey
      };

      console.log(
        `[UsersApi] 成功获取用户 ${tenantId} 的密钥束，用户ID: ${publicKeyBundle.userId}`
      );
      return publicKeyBundle;
    } catch (error) {
      console.error(`[UsersApi] 获取用户 ${tenantId} 的密钥束失败:`, error);

      if (this.isNotFoundError(error)) {
        throw new Error(`租户 ${tenantId} 的密钥不存在或未注册`);
      } else if (this.isAuthError(error)) {
        throw new Error("身份验证失败，请重新登录");
      }

      throw new Error(
        `获取用户密钥失败: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  /**
   * 批量获取多个用户的公钥束（后续备用）
   */
  async getKeyBundlesForUsers(userIds: string[]): Promise<{
    success: boolean;
    bundles: {
      [userId: string]: PublicKeyBundle & {
        lastUpdated: number;
        isActive: boolean;
      };
    };
    failed: string[];
  }> {
    try {
      const response = await this.apiClient.post<{
        success: boolean;
        bundles: {
          [userId: string]: PublicKeyBundle & {
            lastUpdated: number;
            isActive: boolean;
          };
        };
        failed: string[];
      }>("/api/users/batch-key-bundles", { userIds });

      console.log(
        `[UsersApi] Retrieved key bundles for ${Object.keys(response.data.bundles).length
        } users, failed: ${response.data.failed.length}`
      );
      return response.data;
    } catch (error) {
      console.error("[UsersApi] Batch get key bundles error:", error);

      return {
        success: false,
        bundles: {},
        failed: userIds,
      };
    }
  }

  /**
   * 更新用户的公钥束（例如：PreKey 用完后补充新的。目前不需要）
   */
  async updateKeyBundle(
    bundle: Partial<PublicKeyBundle> & { userId: string }
  ): Promise<{
    success: boolean;
    timestamp: number;
  }> {
    try {
      const response = await this.apiClient.put<{
        success: boolean;
        timestamp: number;
      }>(`/api/users/${bundle.userId}/key-bundle`, bundle);

      console.log(`[UsersApi] Updated key bundle for user: ${bundle.userId}`);
      return response.data;
    } catch (error) {
      console.error("[UsersApi] Update key bundle error:", error);

      if (this.isAuthError(error)) {
        throw new Error("身份验证失败，请重新登录");
      } else if (this.isNotFoundError(error)) {
        throw new Error("用户密钥不存在，请先上传密钥");
      }

      throw new Error(
        `更新密钥失败: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取订单的参与者信息
   */
  async getOrderParticipants(orderId: string): Promise<{
    participants: string[];
    orderTitle?: string;
    orderStatus?: string;
    createdAt: number;
  }> {
    try {
      const response = await this.apiClient.get<{
        participants: string[];
        orderTitle?: string;
        orderStatus?: string;
        createdAt: number;
      }>(`/api/orders/${orderId}/participants`);

      console.log(`[UsersApi] Retrieved participants for order: ${orderId}`);
      return response.data;
    } catch (error) {
      console.error(
        `[UsersApi] Get order participants error for ${orderId}:`,
        error
      );

      if (this.isNotFoundError(error)) {
        throw new Error(`订单 ${orderId} 不存在或您无权访问`);
      } else if (this.isAuthError(error)) {
        throw new Error("身份验证失败，请重新登录");
      }

      throw new Error(
        `获取订单信息失败: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取用户的订单列表
   */
  async getUserOrders(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    orders: {
      orderId: string;
      title: string;
      status: string;
      lastMessageTime: number;
      unreadCount: number;
      otherUserId: string;
    }[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const response = await this.apiClient.get<{
        orders: any[];
        total: number;
        hasMore: boolean;
      }>(`/api/users/${userId}/orders`, {
        params: { page, limit },
      });

      console.log(
        `[UsersApi] Retrieved ${response.data.orders.length} orders for user: ${userId}`
      );
      return response.data;
    } catch (error) {
      console.error(`[UsersApi] Get user orders error for ${userId}:`, error);

      if (this.isAuthError(error)) {
        throw new Error("身份验证失败，请重新登录");
      }

      // 返回空订单列表
      return {
        orders: [],
        total: 0,
        hasMore: false,
      };
    }
  }

  /**
   * 检查用户在线状态（可以不需要）
   */
  async checkUserOnlineStatus(userIds: string[]): Promise<{
    online: string[];
    offline: string[];
    lastSeen: { [userId: string]: number };
  }> {
    try {
      const response = await this.apiClient.post<{
        online: string[];
        offline: string[];
        lastSeen: { [userId: string]: number };
      }>("/api/users/online-status", { userIds });

      console.log(
        `[UsersApi] Checked online status: ${response.data.online.length} online, ${response.data.offline.length} offline`
      );
      return response.data;
    } catch (error) {
      console.error("[UsersApi] Check online status error:", error);

      // 默认所有用户离线
      return {
        online: [],
        offline: userIds,
        lastSeen: {},
      };
    }
  }

  /**
   * 搜索用户（不需要）
   */
  async searchUsers(
    query: string,
    limit: number = 10
  ): Promise<{
    users: {
      userId: string;
      username: string;
      avatar?: string;
      lastSeen?: number;
    }[];
  }> {
    try {
      const response = await this.apiClient.get<{
        users: any[];
      }>("/api/users/search", {
        params: { query, limit },
      });

      console.log(
        `[UsersApi] Found ${response.data.users.length} users for query: ${query}`
      );
      return response.data;
    } catch (error) {
      console.error("[UsersApi] Search users error:", error);
      return { users: [] };
    }
  }

  // ========== 错误类型判断辅助方法 ==========

  private isNetworkError(error: any): boolean {
    return (
      error?.code === "NETWORK_ERROR" ||
      error?.code === "ECONNABORTED" ||
      error?.message?.includes("network") ||
      error?.message?.includes("timeout")
    );
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

// 默认导出实例和函数
const usersApiService = new UsersApiService();

export async function getKeyBundleForUser(
  tenantId: string
): Promise<PublicKeyBundle> {
  return usersApiService.getKeyBundleForUser(tenantId);
}

export async function uploadKeyBundle(bundle: PublicKeyBundle): Promise<{
  success: boolean;
  timestamp: number;
}> {
  return usersApiService.uploadKeyBundle(bundle);
}

export async function updateKeyBundle(
  bundle: Partial<PublicKeyBundle> & { userId: string }
): Promise<{
  success: boolean;
  timestamp: number;
}> {
  return usersApiService.updateKeyBundle(bundle);
}

export async function getOrderParticipants(orderId: string): Promise<{
  participants: string[];
  orderTitle?: string;
  orderStatus?: string;
  createdAt: number;
}> {
  return usersApiService.getOrderParticipants(orderId);
}

export async function getUserOrders(
  userId: string,
  page?: number,
  limit?: number
): Promise<{
  orders: {
    orderId: string;
    title: string;
    status: string;
    lastMessageTime: number;
    unreadCount: number;
    otherUserId: string;
  }[];
  total: number;
  hasMore: boolean;
}> {
  return usersApiService.getUserOrders(userId, page, limit);
}

export async function checkUserOnlineStatus(userIds: string[]): Promise<{
  online: string[];
  offline: string[];
  lastSeen: { [userId: string]: number };
}> {
  return usersApiService.checkUserOnlineStatus(userIds);
}

export async function searchUsers(
  query: string,
  limit?: number
): Promise<{
  users: {
    userId: string;
    username: string;
    avatar?: string;
    lastSeen?: number;
  }[];
}> {
  return usersApiService.searchUsers(query, limit);
}
