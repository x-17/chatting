<!-- chat/components/MessageArea.vue -->
<template>
  <div class="message-area">
    <!-- 消息区头部 -->
    <div class="message-header">
      <div class="header-left">
        <el-avatar :size="36">{{ otherPartyInitial }}</el-avatar>
        <div class="header-info">
          <h3>{{ order.otherParty.name }}</h3>
          <div class="order-meta">
            <el-tag
              :type="order.type === 'purchase' ? 'primary' : 'success'"
              size="small"
            >
              {{ order.type === "purchase" ? "我购买" : "我出售" }}
            </el-tag>
            <span class="order-id">订单 #{{ order.id.slice(-8) }}</span>
          </div>
        </div>
      </div>
      <div class="header-right">
        <el-button text @click="handleShowContracts">
          <el-icon><Document /></el-icon>
          合同
        </el-button>
      </div>
    </div>

    <!-- 消息列表 -->
    <el-scrollbar
      ref="scrollbarRef"
      class="message-list"
      @scroll="handleScroll"
    >
      <!-- 加载更多提示 -->
      <div v-if="loading" class="load-more">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>

      <!-- 消息 -->
      <div class="messages-wrapper">
        <template v-for="message in messages" :key="message.id">
          <!-- 系统消息 -->
          <SystemMessage v-if="message.type === 'system'" :message="message" />

          <!-- 文件消息 -->
          <FileMessage
            v-else-if="message.type === 'file' || message.type === 'image'"
            :message="message"
            :is-mine="message.senderId === currentUserId"
            @download="handleDownloadFile"
          />

          <!-- 文本消息 -->
          <MessageBubble
            v-else
            :message="message"
            :is-mine="message.senderId === currentUserId"
            :show-sender="isGroupChat"
          />
        </template>
      </div>

      <!-- 滚动到底部按钮 -->
      <transition name="fade">
        <div
          v-if="showScrollToBottom"
          class="scroll-to-bottom"
          @click="scrollToBottom"
        >
          <el-icon><ArrowDown /></el-icon>
        </div>
      </transition>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { Document, Loading, ArrowDown } from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import MessageBubble from "./MessageBubble.vue";
import FileMessage from "./FileMessage.vue";
import SystemMessage from "./SystemMessage.vue";
import type { Order } from "../types/chat.types";
import type { ChatMessage } from "../types/chat.types";
import router from "@/router";

interface Props {
  order: Order;
  messages: ChatMessage[];
  loading?: boolean;
}

interface Emits {
  (e: "load-more"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const scrollbarRef = ref();
const showScrollToBottom = ref(false);

const currentUserId = computed(() => authStore.user?.id || "");
const otherPartyInitial = computed(() =>
  props.order.otherParty.name.charAt(0).toUpperCase()
);
const isGroupChat = computed(() => props.order.conversationType === "group");

// 监听消息变化，自动滚动到底部
watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (!showScrollToBottom.value) {
      scrollToBottom(false);
    }
  }
);

function handleScroll({ scrollTop }: { scrollTop: number }) {
  // 距离底部超过100px显示按钮
  const scrollbarElement = scrollbarRef.value?.wrapRef;
  if (scrollbarElement) {
    const { scrollHeight, clientHeight } = scrollbarElement;
    showScrollToBottom.value = scrollHeight - scrollTop - clientHeight > 100;

    // 滚动到顶部时加载更多
    if (scrollTop < 50 && !props.loading) {
      emit("load-more");
    }
  }
}

function scrollToBottom(smooth = true) {
  const scrollbarElement = scrollbarRef.value?.wrapRef;
  if (scrollbarElement) {
    scrollbarElement.scrollTo({
      top: scrollbarElement.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }
}

function handleShowContracts() {
  // TODO: 显示合同列表
  router.push({ name: "ContractList", params: { orderId: props.order.id } });
}

function handleDownloadFile(message: ChatMessage) {
  // TODO: 下载文件逻辑
  console.log("Download file:", message);
}
</script>

<style scoped>
.message-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.message-header {
  height: 60px;
  padding: 0 20px;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-info h3 {
  margin: 0;
  font-size: 16px;
  color: #303133;
}

.order-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.order-id {
  font-size: 12px;
  color: #909399;
}

.message-list {
  flex: 1;
  background: #f5f7fa;
}

.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: #909399;
  font-size: 14px;
}

.messages-wrapper {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scroll-to-bottom {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 40px;
  height: 40px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
  z-index: 10;
}

.scroll-to-bottom:hover {
  background: #409eff;
  color: white;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
