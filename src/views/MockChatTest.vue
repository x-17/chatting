<!-- src/views/MockChatTest.vue -->
<template>
  <div class="mock-test-container">
    <div class="test-header">
      <h1>💬 聊天系统UI测试</h1>
      <el-alert
          title="测试模式"
          type="info"
          :closable="false"
          show-icon
      >
        使用本地模拟数据，无需后端API
      </el-alert>
    </div>

    <div class="test-info">
      <el-descriptions title="当前测试用户" :column="2" border>
        <el-descriptions-item label="用户ID">
          {{ currentUser.id }}
        </el-descriptions-item>
        <el-descriptions-item label="用户名">
          {{ currentUser.userName }}
        </el-descriptions-item>
        <el-descriptions-item label="邮箱">
          {{ currentUser.email }}
        </el-descriptions-item>
        <el-descriptions-item label="信誉分">
          950
        </el-descriptions-item>
      </el-descriptions>

      <el-card class="test-data-card">
        <template #header>
          <h3>📊 模拟数据概览</h3>
        </template>
        <el-space direction="vertical" :size="16" style="width: 100%">
          <div class="data-item">
            <el-icon color="#409EFF" :size="24"><ShoppingCart /></el-icon>
            <span>订单数量: <strong>{{ mockOrders.length }}</strong></span>
          </div>
          <div class="data-item">
            <el-icon color="#67C23A" :size="24"><Message /></el-icon>
            <span>P2P会话: <strong>{{ Object.keys(mockP2PMessages).length }}</strong></span>
          </div>
          <div class="data-item">
            <el-icon color="#E6A23C" :size="24"><User /></el-icon>
            <span>群聊会话: <strong>{{ Object.keys(mockGroupMessages).length }}</strong></span>
          </div>
          <div class="data-item">
            <el-icon color="#F56C6C" :size="24"><Document /></el-icon>
            <span>合同数量: <strong>{{ mockContracts.length }}</strong></span>
          </div>
        </el-space>
      </el-card>
    </div>

    <div class="test-actions">
      <el-button
          type="primary"
          size="large"
          @click="enterChatSystem"
      >
        进入聊天系统
      </el-button>

      <el-button
          size="large"
          @click="viewContractList"
      >
        查看合同列表
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { ShoppingCart, Message, User, Document } from '@element-plus/icons-vue';
import { mockService } from '../modulse/mock/mock-service';
import {
  mockOrders,
  mockP2PMessages,
  mockGroupMessages,
  mockContracts
} from '../modulse/mock/mock-data';

const router = useRouter();
const currentUser = mockService.getCurrentUser();

function enterChatSystem() {
  // 模拟登录状态
  localStorage.setItem('auth_user_id', currentUser.id);
  localStorage.setItem('auth_user', JSON.stringify(currentUser));
  localStorage.setItem('auth_token', 'mock_token_' + Date.now());

  router.push('/chat');
}

function viewContractList() {
  localStorage.setItem('auth_user_id', currentUser.id);
  localStorage.setItem('auth_user', JSON.stringify(currentUser));

  router.push('/contracts');
}
</script>

<style scoped>
.mock-test-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.test-header {
  width: 100%;
  max-width: 800px;
  margin-bottom: 32px;
}

.test-header h1 {
  color: white;
  text-align: center;
  margin-bottom: 20px;
  font-size: 32px;
}

.test-info {
  width: 100%;
  max-width: 800px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 32px;
}

.test-data-card {
  background: white;
}

.data-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
}

.test-actions {
  display: flex;
  gap: 16px;
}
</style>