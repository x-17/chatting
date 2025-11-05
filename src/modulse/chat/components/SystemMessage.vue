<!-- chat/components/SystemMessage.vue -->
<template>
  <div class="system-message">
    <div class="message-content">
      <el-icon :color="iconColor" :size="16">
        <component :is="iconComponent" />
      </el-icon>
      <span class="message-text">{{ messageText }}</span>
      <span class="message-time">{{ formatTime(message.timestamp) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  InfoFilled,
  SuccessFilled,
  WarningFilled,
  CircleCheckFilled,
  User,
  Document
} from '@element-plus/icons-vue';
import type { ChatMessage } from '../types/chat.types';

interface Props {
  message: ChatMessage;
}

const props = defineProps<Props>();

const messageData = computed(() => {
  try {
    return JSON.parse(props.message.content);
  } catch {
    return { type: 'info', text: props.message.content };
  }
});

const iconComponent = computed(() => {
  const type = messageData.value.type || 'info';
  const iconMap: Record<string, any> = {
    info: InfoFilled,
    success: SuccessFilled,
    warning: WarningFilled,
    order_status: CircleCheckFilled,
    member_joined: User,
    member_left: User,
    contract_created: Document,
    contract_signed: CircleCheckFilled
  };
  return iconMap[type] || InfoFilled;
});

const iconColor = computed(() => {
  const type = messageData.value.type || 'info';
  const colorMap: Record<string, string> = {
    info: '#909399',
    success: '#67C23A',
    warning: '#E6A23C',
    order_status: '#409EFF',
    member_joined: '#67C23A',
    member_left: '#F56C6C',
    contract_created: '#409EFF',
    contract_signed: '#67C23A'
  };
  return colorMap[type] || '#909399';
});

const messageText = computed(() => {
  return messageData.value.text || props.message.content;
});

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
</script>

<style scoped>
.system-message {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.message-content {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
}

.message-text {
  line-height: 1.4;
}

.message-time {
  font-size: 11px;
  color: #909399;
  margin-left: 4px;
}
</style>