<!-- chat/components/OrderItem.vue -->
<template>
  <div
      class="order-item"
      :class="{
      active: active,
      completed: completed,
      unread: order.unreadCount > 0
    }"
  >
    <div class="order-icon">
      <el-icon :size="20" :color="iconColor">
        <ShoppingCart v-if="order.type === 'purchase'" />
        <Sell v-else />
      </el-icon>
    </div>

    <div class="order-content">
      <div class="order-header">
        <span class="order-title">{{ order.title }}</span>
        <span class="order-time">{{ formatTime(order.lastMessageTime) }}</span>
      </div>

      <div class="order-info">
        <span class="other-party">{{ order.otherParty.name }}</span>
        <el-tag :type="order.type === 'purchase' ? 'primary' : 'success'" size="small">
          {{ order.type === 'purchase' ? '买入' : '卖出' }}
        </el-tag>
        <el-tag v-if="order.conversationType === 'group'" size="small" type="warning" effect="dark">
            群聊
        </el-tag>
        <el-tag v-if="order.parentOrderId" size="small" type="danger" effect="dark">
            争议
        </el-tag>
      </div>

      <div class="last-message">
        {{ order.lastMessageContent || '暂无消息' }}
      </div>
    </div>

    <div class="order-badge">
      <el-badge
          v-if="order.unreadCount > 0"
          :value="order.unreadCount"
          :max="99"
          type="danger"
      />
      <el-icon v-if="completed" color="#909399" :size="16">
        <CircleCheck />
      </el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ShoppingCart, Sell, CircleCheck } from '@element-plus/icons-vue';
import type { Order } from '../types/chat.types';

interface Props {
  order: Order;
  active?: boolean;
  completed?: boolean;
}

const props = defineProps<Props>();

const iconColor = computed(() => {
  if (props.completed) return '#909399';
  return props.order.type === 'purchase' ? '#409EFF' : '#67C23A';
});

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';

  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
</script>

<style scoped>
.order-item {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.3s;
  border-left: 3px solid transparent;
  position: relative;
}

.order-item:hover {
  background: #f5f7fa;
}

.order-item.active {
  background: #ecf5ff;
  border-left-color: #409eff;
}

.order-item.completed {
  opacity: 0.7;
}

.order-item.unread .order-title {
  font-weight: bold;
}

.order-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
}

.order-item.active .order-icon {
  background: white;
}

.order-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.order-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.order-title {
  font-size: 14px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-time {
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
  margin-left: 8px;
}

.order-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.other-party {
  font-size: 13px;
  color: #606266;
}

.last-message {
  font-size: 13px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
</style>