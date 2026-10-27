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
        <el-badge :value="contractNum" :hidden="contractNum === 0" class="item">
          <el-button text @click="handleShowContracts">
            <el-icon>
              <Document />
            </el-icon>
            合同
          </el-button>
        </el-badge>
      </div>
    </div>

    <!-- 待签合同提示：不依赖聊天消息，聊天记录/会话重置后依然可见 -->
    <div v-if="contractInfo && contractInfo.status === 0" class="pending-contract-banner">
      <el-icon color="#E6A23C" :size="16">
        <WarningFilled />
      </el-icon>
      <span class="pending-contract-text">
        {{
          isContractInitiator
            ? "您发起的合同正在等待对方签署"
            : "对方已发起合同，等待您签署"
        }}
        <template v-if="contractFileName">：{{ contractFileName }}</template>
      </span>
      <el-button type="primary" link @click="openContractDialog">
        查看并处理
      </el-button>
    </div>

    <!-- 消息列表 -->
    <el-scrollbar
      ref="scrollbarRef"
      class="message-list"
      @scroll="handleScroll"
    >
      <!-- 加载更多提示 -->
      <div v-if="loading" class="load-more">
        <el-icon class="is-loading">
          <Loading />
        </el-icon>
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
            :is-mine="String(message.senderId) === currentUserId"
            :current-user-name="currentUserName"
            :sender-name="getSenderName(message)"
            :preview-loader="props.loadImagePreview"
            @download="handleDownloadFile"
          />
          <ContractMessage
            v-else-if="message.type === 'contract'"
            :message="message"
            :is-mine="String(message.senderId) === currentUserId"
            :current-user-name="currentUserName"
            :sender-name="getSenderName(message)"
            @trigger-contract="handleContract"
            @preview="handlePreviewFile"
            @download="handleDownloadFile"
          />

          <!-- 文本消息 -->
          <MessageBubble
            v-else
            :message="message"
            :is-mine="String(message.senderId) === currentUserId"
            :current-user-name="currentUserName"
            :sender-name="getSenderName(message)"
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
          <el-icon>
            <ArrowDown />
          </el-icon>
        </div>
      </transition>
    </el-scrollbar>
    <!-- 引入合同状态弹窗 -->
    <ContractStatus
      v-model:visible="isContractDialogVisible"
      :user-id="String(currentUserId)"
      :contract-info="contractInfo"
      @trigger-query-contract="querycontract"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  reactive,
  onBeforeUpdate,
} from "vue";
import {
  Document,
  Loading,
  ArrowDown,
  WarningFilled,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import MessageBubble from "./MessageBubble.vue";
import FileMessage from "./FileMessage.vue";
import SystemMessage from "./SystemMessage.vue";
import ContractStatus from "./ContractStatus.vue";
import ContractMessage from "./ContractMessage.vue";
import type { Order } from "../types/chat.types";
import type { ChatMessage } from "../types/chat.types";
import router from "@/router";
import { ContractApiService } from "../../contracts/services/contract-api.service";
import { ElMessage } from "element-plus";
import { ContractService } from "../../contracts/services/contract.service";
import type { orderSignState } from "../../contracts/types/contract.types";

interface Props {
  order: Order;
  messages: ChatMessage[];
  loading?: boolean;
  loadImagePreview?: (message: ChatMessage) => Promise<string>;
}

interface Emits {
  (e: "load-more"): void;
  (e: "is-agree-contract", isAgree: boolean, message: ChatMessage): void;
  (e: "download", message: ChatMessage): void;
  (e: "preview", message: ChatMessage): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const scrollbarRef = ref();
const showScrollToBottom = ref(false);
const contractNum = ref(0);
// const contractInfo = ref<orderSignState>(null);
const contractInfo = ref<orderSignState>();
const contractFileName = ref("");

const currentUserId = computed(() =>
  String(
    authStore.currentUserId ||
      sessionStorage.getItem("auth_current_user_id") ||
      "",
  ),
);
const currentUserName = computed(() => {
  if (authStore.user?.userName) return authStore.user.userName;

  const userId = sessionStorage.getItem("auth_current_user_id");
  if (userId) {
    try {
      const storedUser = JSON.parse(
        localStorage.getItem(`auth_${userId}_user`) || "{}",
      );
      return storedUser.userName || storedUser.username || "??";
    } catch {
      // Ignore malformed cached user data and use the fallback below.
    }
  }

  return "??";
});

const otherPartyInitial = computed(() => {
  const name = String(props.order.otherParty?.name || "??").trim();
  return name.charAt(0).toUpperCase();
});

function getSenderName(message: ChatMessage): string {
  if (String(message.senderId) === currentUserId.value) {
    return currentUserName.value;
  }

  const metadata = message.metadata as Record<string, unknown> | undefined;
  const metadataName =
    metadata?.memberName ||
    metadata?.senderName ||
    metadata?.userName ||
    metadata?.username;

  return String(
    metadataName || props.order.otherParty?.name || message.senderId || "??",
  );
}
const isGroupChat = computed(() => props.order.conversationType === "group");
const isContractInitiator = computed(
  () =>
    String(contractInfo.value?.lastSignUserId ?? "") ===
    String(currentUserId.value),
);
const ContractServiceInstance = new ContractService(
  authStore.currentUserId ||
    sessionStorage.getItem("auth_current_user_id") ||
    "",
);
const isContractDialogVisible = ref(false);

// 监听消息变化，自动滚动到底部
watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (!showScrollToBottom.value) {
      scrollToBottom(false);
    }
  },
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
  // 弹窗打开时会触发 triggerQueryContract，向服务端刷新一次状态
  isContractDialogVisible.value = true;
}

function openContractDialog() {
  handleShowContracts();
}

function handleDownloadFile(message: ChatMessage) {
  // TODO: 下载文件逻辑
  console.log("Download file:", message);
  emit("download", message);
}

function handlePreviewFile(message: ChatMessage) {
  emit("preview", message);
}
async function handleContract(isAgree: boolean, message: ChatMessage) {
  console.log(isAgree);
  emit("is-agree-contract", isAgree, message);
}
async function loadContractFileName() {
  const fileId = contractInfo.value?.fileId;
  if (!fileId) {
    contractFileName.value = "";
    return;
  }
  try {
    const api = new ContractApiService();
    const name = await api.getFileDownloadName(String(fileId));
    contractFileName.value = name || "";
  } catch (error) {
    console.warn("[MessageArea] 获取合同名称失败", error);
    contractFileName.value = "";
  }
}

async function querycontract() {
  try {
    let res = await ContractServiceInstance.queryOrderSignState(props.order.id);
    if (res && res.code === 1) {
      if (typeof res.data !== "string" && res.data) {
        contractInfo.value = res.data;
        // 徽标只提示“待签”，已完成的合同不再打扰用户
        contractNum.value = res.data.status === 0 ? 1 : 0;
        await loadContractFileName();
        return;
      }
    }
    console.log(res?.data);
    contractInfo.value = undefined;
    contractFileName.value = "";
    contractNum.value = 0;
  } catch (error) {
    console.log(error);
    contractInfo.value = undefined;
    contractFileName.value = "";
    contractNum.value = 0;
  }
}
watch(
  () => props.order.id,
  () => {
    querycontract();
  },
  { immediate: true },
);

// 对方发起/更新合同时，即使消息无法解密，只要消息列表出现新的合同消息就向服务端刷新
watch(
  () => props.messages.filter((item) => item.type === "contract").length,
  () => {
    querycontract();
  },
);

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

.pending-contract-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: #fdf6ec;
  border-bottom: 1px solid #faecd8;
  color: #b88230;
  font-size: 13px;
}

.pending-contract-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
