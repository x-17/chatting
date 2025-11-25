// src/mock/mock-service.ts

import {
  mockOrders,
  mockP2PMessages,
  mockGroupMessages,
  mockContracts,
  mockUsers,
  MOCK_CURRENT_USER_ID,
} from "./mock-data";

/**
 * Mock 服务 - 模拟后端API
 */
export const mockService = {
  // 是否启用 Mock
  enabled: false,

  /**
   * 获取我的订单列表
   */
  async getMyOrders(): Promise<typeof mockOrders> {
    await this.delay(500);

    // 过滤当前用户相关的订单
    return mockOrders;
  },

  /**
   * 获取订单详情
   */
  async getOrder(orderId: string) {
    await this.delay(300);
    const order = mockOrders.find((o) => o.orderId === orderId);
    if (!order) throw new Error("Order not found");
    return order;
  },

  /**
   * 获取P2P会话消息
   */
  async getP2PMessages(orderId: string) {
    await this.delay(400);
    return mockP2PMessages[orderId] || [];
  },

  /**
   * 获取群组消息
   */
  async getGroupMessages(groupId: string) {
    await this.delay(400);
    return mockGroupMessages[groupId] || [];
  },

  /**
   * 获取订单的合同列表
   */
  async getContractsByOrder(orderId: string) {
    await this.delay(300);
    return mockContracts.filter((c) => c.orderId === orderId);
  },

  /**
   * 获取合同详情
   */
  async getContract(contractId: string) {
    await this.delay(300);
    const contract = mockContracts.find((c) => c.id === contractId);
    if (!contract) throw new Error("Contract not found");
    return contract;
  },

  /**
   * 获取用户信息
   */
  async getUser(userId: string) {
    await this.delay(200);
    return mockUsers[userId as keyof typeof mockUsers];
  },

  /**
   * 获取当前用户
   */
  getCurrentUser() {
    return mockUsers[MOCK_CURRENT_USER_ID as keyof typeof mockUsers];
  },

  /**
   * 模拟延迟
   */
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
