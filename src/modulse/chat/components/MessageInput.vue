<!-- chat/components/MessageInput.vue -->
<template>
  <div class="message-input">
    <!-- 工具栏 -->
    <div class="input-toolbar">
      <el-button text @click="handleEmojiPicker">
        <el-icon><ChatDotRound /></el-icon>
      </el-button>

      <el-upload
        :show-file-list="false"
        :before-upload="handleFileSelect"
        accept="*/*"
      >
        <el-button text>
          <el-icon><Paperclip /></el-icon>
        </el-button>
      </el-upload>

      <el-upload
        :show-file-list="false"
        :before-upload="handleFileSelect"
        accept="image/*"
      >
        <el-button text>
          <el-icon><Picture /></el-icon>
        </el-button>
      </el-upload>
      <el-upload
        :show-file-list="false"
        :before-upload="handleContractSelect"
        accept="*/*"
      >
        <el-button text>
          <el-icon><Document /></el-icon>
        </el-button>
      </el-upload>

      <!-- 快捷回复 -->
      <el-dropdown @command="insertQuickReply">
        <el-button text>
          <el-icon><Lightning /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="好的，收到">好的，收到</el-dropdown-item>
            <el-dropdown-item command="请稍等">请稍等</el-dropdown-item>
            <el-dropdown-item command="谢谢">谢谢</el-dropdown-item>
            <el-dropdown-item command="已发货">已发货</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <el-input
        ref="inputRef"
        v-model="messageText"
        type="textarea"
        :rows="3"
        :disabled="disabled"
        placeholder="输入消息... (Ctrl+Enter 发送)"
        resize="none"
        @keydown="handleKeydown"
      />
    </div>

    <!-- 底部操作 -->
    <div class="input-footer">
      <div class="footer-left">
        <el-text v-if="disabled" type="info" size="small">
          此订单已完成，无法发送消息
        </el-text>
        <el-text v-else-if="!isConnected" type="warning" size="small">
          <el-icon class="is-loading"><Loading /></el-icon> 连接中...
        </el-text>
      </div>
      <div class="footer-right">
        <el-button @click="handleClear">清空</el-button>
        <el-button
          type="primary"
          :disabled="!canSend"
          :loading="sending"
          @click="handleSend"
        >
          发送
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import {
  ChatDotRound,
  Paperclip,
  Picture,
  Lightning,
  Document,
  Loading,
} from "@element-plus/icons-vue";
import type { Order } from "../types/chat.types";

interface Props {
  order: Order;
  disabled?: boolean;
  isConnected?: boolean; // ✅ Connection status
}

interface Emits {
  (e: "send", content: string): void;
  (e: "send-file", file: File): void;
  (e: "send-contract", file: File): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const inputRef = ref();
const messageText = ref("");
const sending = ref(false);

const canSend = computed(
  () => messageText.value.trim().length > 0 && !props.disabled && props.isConnected
);

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && e.ctrlKey) {
    e.preventDefault();
    handleSend();
  }
}

async function handleSend() {
  if (!canSend.value || sending.value) return;

  const content = messageText.value.trim();

  try {
    sending.value = true;
    emit("send", content);
    messageText.value = "";

    // 聚焦输入框
    inputRef.value?.focus();
  } catch (error) {
    // 错误由父组件处理
  } finally {
    sending.value = false;
  }
}

function handleClear() {
  messageText.value = "";
  inputRef.value?.focus();
}

function insertQuickReply(text: string) {
  messageText.value = text;
  inputRef.value?.focus();
}

function handleEmojiPicker() {
  ElMessage.info("表情选择功能开发中");
}

function handleFileSelect(file: File) {
  // 检查文件大小（100MB限制）
  const maxSize = 100 * 1024 * 1024;
  if (file.size > maxSize) {
    ElMessage.error("文件大小不能超过 100MB");
    return false;
  }

  emit("send-file", file);
  return false; // 阻止默认上传
}
function handleContractSelect(file: File) {
  // 检查文件大小（100MB限制）
  const maxSize = 100 * 1024 * 1024;
  if (file.size > maxSize) {
    ElMessage.error("文件大小不能超过 100MB");
    return false;
  }

  emit("send-contract", file);
  return false; // 阻止默认上传
}
</script>

<style scoped>
.message-input {
  background: white;
  border-top: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.input-toolbar {
  height: 44px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid #f0f0f0;
}

.input-area {
  padding: 12px 16px;
}

.input-area :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  padding: 0;
  font-size: 14px;
}

.input-area :deep(.el-textarea__inner):focus {
  box-shadow: none;
}

.input-footer {
  height: 48px;
  padding: 0 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #f0f0f0;
}

.footer-right {
  display: flex;
  gap: 8px;
}
</style>
