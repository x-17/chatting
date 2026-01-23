<!-- chat/components/MessageBubble.vue -->
<template>
  <div class="message-bubble-wrapper" :class="{ 'is-mine': isMine }">
    <!-- 发送者信息（群聊） -->
    <div v-if="showSender && !isMine" class="sender-name">
      {{ message.senderId }}
    </div>

    <div class="message-bubble">
      <!-- 头像 -->
      <el-avatar v-if="!isMine" :size="36" class="avatar">
        {{ senderInitial }}
      </el-avatar>

      <!-- 消息内容 -->
      <div class="bubble-content" :class="{ mine: isMine }">
        <div class="message-text">{{ message.content }}</div>
        <div class="message-meta">
          <span class="time">{{ formatTime(message.timestamp) }}</span>
          <template v-if="isMine">
            <el-icon v-if="message.status === 'pending'" class="is-loading">
              <Loading />
            </el-icon>
            <el-icon v-else-if="message.status === 'failed'" color="#F56C6C">
              <CircleClose />
            </el-icon>
            <el-icon v-else-if="message.status === 'sent'" color="#909399">
              <Check />
            </el-icon>
            <el-icon v-else-if="message.status === 'delivered'" color="#67C23A">
              <Check />
            </el-icon>
            <template v-else-if="message.status === 'read'">
              <el-icon color="#409EFF">
                <Check />
              </el-icon>
              <el-icon color="#409EFF" style="margin-left: -8px">
                <Check />
              </el-icon>
            </template>
          </template>
        </div>
      </div>

      <!-- 我的头像 -->
      <el-avatar v-if="isMine" :size="36" class="avatar">
        {{ currentUserInitial }}
      </el-avatar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { Loading, CircleClose, Check } from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import type { ChatMessage } from "../types/chat.types";

interface Props {
  message: ChatMessage;
  isMine: boolean;
  showSender?: boolean;
}

const props = defineProps<Props>();
const authStore = useAuthStore();

const currentUserInitial = computed(
  () => authStore.user?.userName?.charAt(0).toUpperCase() || "U"
);

const senderInitial = computed(() =>
  String(props.message.senderId).charAt(0).toUpperCase()
);

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}
onMounted(() => {
});
</script>

<style scoped>
.message-bubble-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.message-bubble-wrapper.is-mine {
  align-items: flex-end;
}

.sender-name {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
  padding-left: 48px;
}

.message-bubble {
  display: flex;
  gap: 8px;
  max-width: 70%;
}

.avatar {
  flex-shrink: 0;
}

.bubble-content {
  background: white;
  border-radius: 8px;
  padding: 10px 14px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  word-break: break-word;
}

.bubble-content.mine {
  background: #409eff;
  color: white;
}

.message-text {
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.time {
  font-size: 11px;
  opacity: 0.7;
}

.bubble-content.mine .time {
  color: white;
}
</style>
