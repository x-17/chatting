<!-- chat/views/ChatMainView.vue -->
<template>
  <div class="chat-main-view">
    <!-- 顶部导航栏 -->
    <div class="top-navbar">
      <div class="navbar-left">
        <h2>订单磋商</h2>
      </div>
      <div class="navbar-right">
        <el-badge>
          <el-button text @click="graphVisible = true" title="交易图谱">
            <el-icon>
              <Connection />
            </el-icon>
          </el-button>
        </el-badge>
        <el-button
          text
          :icon="DataAnalysis"
          title="统计查询"
          @click="router.push({ name: 'OrderStatistics' })"
        >
          统计查询
        </el-button>
        <el-badge :value="totalUnreadCount" :hidden="totalUnreadCount === 0">
          <el-button text>
            <el-icon>
              <Message />
            </el-icon>
          </el-button>
        </el-badge>

        <el-dropdown @command="handleUserAction">
          <span class="user-info">
            <el-avatar :size="32">{{ userInitial }}</el-avatar>
            <span>{{ userName }}</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">个人信息</el-dropdown-item>
              <el-dropdown-item command="settings">设置</el-dropdown-item>
              <el-dropdown-item divided command="logout"
                >退出登录</el-dropdown-item
              >
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 三栏布局 -->
    <div class="chat-container">
      <!-- 左侧：订单列表 -->
      <div class="left-panel">
        <OrderList
          :orders="orders"
          :active-order-id="activeOrderId"
          :unread-count="totalUnreadCount"
          :purchase-active-count="purchaseActiveCount"
          :sale-active-count="saleActiveCount"
          @select="handleOrderSelect"
        />
      </div>

      <!-- 中间：聊天区域 -->
      <div class="center-panel">
        <template v-if="activeOrder">
          <MessageArea
            :order="activeOrder"
            :messages="currentMessages"
            :loading="messagesLoading"
            :load-image-preview="handleLoadImagePreview"
            @load-more="handleLoadMoreMessages"
            @is-agree-contract="handleIsAgreeContract"
            @download="handleDonloadFile"
            @preview="handlePreviewFile"
          />
          <MessageInput
            :order="activeOrder"
            :disabled="!canSendMessage"
            :is-connected="isWebSocketConnected"
            @send="handleSendMessage"
            @send-file="handleSendFile"
            @send-contract="handleSendContract"
          />
        </template>
        <div v-else class="empty-state">
          <el-empty description="请选择一个订单开始磋商" />
        </div>
      </div>

      <!-- 右侧：订单详情（可折叠） -->
      <div class="right-panel" :class="{ collapsed: !showOrderDetail }">
        <OrderDetail
          v-if="activeOrder"
          :order="activeOrder"
          @close="showOrderDetail = false"
          @create-contract="handleCreateContract"
        />
      </div>

      <!-- 折叠按钮 -->
      <div
        v-if="activeOrder"
        class="toggle-detail-btn"
        @click="showOrderDetail = !showOrderDetail"
      >
        <el-icon>
          <DArrowLeft v-if="showOrderDetail" />
          <DArrowRight v-else />
        </el-icon>
      </div>
    </div>
    <!-- 合同详情弹窗 -->
    <el-dialog
      v-model="contractFormVisible"
      title="填写合同详情"
      width="500px"
      :close-on-click-modal="false"
      @closed="handleContractDialogClosed"
    >
      <el-form
        ref="contractFormRef"
        :model="contractForm"
        :rules="contractFormRules"
        label-width="120px"
      >
        <el-form-item label="订单编号">
          <el-input :model-value="activeOrder?.id" disabled />
        </el-form-item>
        <el-form-item label="购买金额" prop="amount">
          <el-input-number
            v-model="contractForm.amount"
            :step="0.1"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="有效期限(天)">
          <el-input :model-value="effectiveUsageDaysText" disabled />
        </el-form-item>
        <el-form-item label="开始时间" prop="usageStartTime">
          <el-date-picker
            v-model="contractForm.usageStartTime"
            type="datetime"
            placeholder="选择开始时间"
            style="width: 100%"
            @change="handleUsageStartTimeChange"
          />
        </el-form-item>
        <el-form-item label="结束时间" prop="usageEndTime">
          <el-date-picker
            v-model="contractForm.usageEndTime"
            type="datetime"
            placeholder="选择结束时间"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="contractFormVisible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="contractSubmitting"
            @click="submitContract"
          >
            确认签署
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 文件预览弹窗 -->
    <el-dialog
      v-model="previewVisible"
      title="文件预览"
      width="80%"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div class="preview-container" v-loading="previewLoading">
        <iframe
          v-if="previewType === 'pdf' && previewUrl"
          :src="previewUrl"
          width="100%"
          height="600px"
          frameborder="0"
        ></iframe>
        <div
          v-else-if="previewType === 'docx'"
          ref="docxContainer"
          class="docx-container"
          style="padding: 0"
        ></div>
        <div v-else class="preview-error">
          <el-empty description="暂不支持预览此类型文件" />
        </div>
      </div>
    </el-dialog>

    <!-- 交易图谱弹窗 -->
    <el-dialog
      v-model="graphVisible"
      title="交易图谱"
      width="80%"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <TransactionGraph
        :orders="orders"
        :current-user-id="currentUserId"
        :current-user-name="userName"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import {
  Message,
  DArrowLeft,
  DArrowRight,
  Connection,
  DataAnalysis,
} from "@element-plus/icons-vue";
import TransactionGraph from "../components/TransactionGraph.vue";
import OrderList from "../components/OrderList.vue";
import MessageArea from "../components/MessageArea.vue";
import MessageInput from "../components/MessageInput.vue";
import OrderDetail from "../components/OrderDetail.vue";
import { useChat, type ContractDetails } from "../composables/useChat";
import { useOrderList } from "../composables/useOrderList";
import mockLogin from "../../../utils/mockLogin";
import type { ChatMessage } from "../types/chat.types";
import type { P2PMessage } from "../../signal/types/message.types";
import { useMessageHandlers } from "../composables/useMessageHandlers";
import { useAuthStore } from "../../auth/services/auth.store";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const showOrderDetail = ref(true);
const graphVisible = ref(false);

const currentUserId = computed(() => {
  const authId = sessionStorage.getItem("auth_current_user_id");
  if (authId) {
    const prefix = `auth_${authId}`;
    const user = JSON.parse(localStorage.getItem(`${prefix}_user`) || "{}");
    if (user.id) return String(user.id);
    if (user.userId) return String(user.userId);
  }
  return authId || "196";
});

// 使用 composables
const {
  orders,
  activeOrder,
  totalUnreadCount,
  activeOrderId,
  purchaseActiveCount,
  saleActiveCount,
  loadOrders,
  selectOrder,
} = useOrderList();

import { useOrderStore } from "../../orders/store/order.store";
const orderStore = useOrderStore();

// 初始化消息处理器，传入 activeOrderId 以便在当前会话时不增加未读数
const { isWebSocketConnected, syncOfflineMessages } =
  useMessageHandlers(activeOrderId);

const {
  currentMessages,
  messagesLoading,
  downLoadFile,
  sendMessage,
  sendFile,
  sendContractFile,
  loadConversationMessages,
  loadMoreMessages,
} = useChat();

//组件命名，用于keep-alive
defineOptions({ name: "ChatMainView" });

// 计算属性
const userName = computed(() => {
  const userId = sessionStorage.getItem("auth_current_user_id");
  const prefix = `auth_${userId}`;
  const user = JSON.parse(localStorage.getItem(`${prefix}_user`) || "{}");
  return user.userName || user.username || "用户";
});

//头像首字母
const userInitial = computed(() => userName.value.charAt(0).toUpperCase());

const canSendMessage = computed(() => {
  return activeOrder.value?.status === "active";
});

// 方法
async function handleOrderSelect(orderId: string) {
  console.log("[ChatMain] Order selected:", orderId);

  const order = orders.value.find((o) => o.id === orderId);
  if (!order) {
    console.error("[ChatMain] Order not found:", orderId);
    return;
  }

  try {
    // 选择订单
    await selectOrder(orderId);

    // 加载消息
    await loadConversationMessages(order);

    showOrderDetail.value = true;

    console.log(
      "[ChatMain] Order loaded, messages:",
      currentMessages.value.length,
    );
  } catch (error: any) {
    console.error("[ChatMain] Load order failed:", error);
    ElMessage.error("加载消息失败: " + error.message);
  }
}

async function handleSendMessage(content: string) {
  if (!activeOrder.value) {
    console.warn("[ChatMain] No active order");
    return;
  }

  console.log("[ChatMain] Sending message:", content);

  try {
    await sendMessage(activeOrder.value, content);
    ElMessage.success("消息发送成功");
  } catch (error: any) {
    ElMessage.error(error.message || "发送失败");
  }
}

async function handleSendFile(file: File) {
  if (!activeOrder.value) return;

  console.log("[ChatMain] Sending file:", file.name);

  try {
    await sendFile(activeOrder.value, file);
    ElMessage.success("文件发送成功");
  } catch (error: any) {
    ElMessage.error(error.message || "文件发送失败");
  }
}
async function handleLoadImagePreview(message: ChatMessage): Promise<string> {
  return await downLoadFile(message as any, false);
}

async function handleDonloadFile(message: Extract<ChatMessage, P2PMessage>) {
  try {
    const url = await downLoadFile(message);
    console.log("ccccccc", url);

    ElMessage.success("文件下载成功");
  } catch (error: any) {
    ElMessage.error(error.message || "文件下载失败");
  }
}
function handleLoadMoreMessages() {
  if (activeOrder.value) {
    loadMoreMessages(activeOrder.value);
  }
}

function canCurrentUserStartSigning(): boolean {
  const order = activeOrder.value;
  if (!order || order.conversationType !== "p2p") return true;

  const myScore = authStore.user?.reputationScore ?? 100;
  const otherScore = order.otherParty.reputationScore ?? 100;
  if (myScore < otherScore) {
    ElMessage.warning(
      `您的信誉度不足，只能等待对方发起签署（您的信誉分：${myScore}，对方信誉分：${otherScore}）`,
    );
    return false;
  }
  return true;
}

function handleCreateContract() {
  if (!activeOrder.value || !canCurrentUserStartSigning()) return;

  router.push({
    name: "ContractCreation",
    params: { orderId: activeOrder.value.id },
  });
}

function handleUserAction(command: string) {
  switch (command) {
    case "profile":
      router.push("/profile");
      break;
    case "settings":
      router.push("/settings");
      break;
    case "logout":
      localStorage.clear();
      router.push("/login");
      break;
  }
}

async function handleSendContract(file: File) {
  if (!activeOrder.value || !canCurrentUserStartSigning()) return;
  contractFile.value = file;
  contractFormVisible.value = true;
}

const contractFormVisible = ref(false);
const contractFile = ref<File | null>(null);
const contractFormRef = ref<FormInstance>();
const contractSubmitting = ref(false);
const contractForm = ref<ContractDetails>({
  amount: 0,
  usageStartTime: new Date(),
  usageEndTime: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
});

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

const effectiveUsageDays = computed(() => {
  const start = contractForm.value.usageStartTime;
  const end = contractForm.value.usageEndTime;
  if (!isValidDate(start) || !isValidDate(end)) return 0;

  const durationMillis = end.getTime() - start.getTime();
  if (durationMillis <= 0) return 0;
  return Math.ceil(durationMillis / (24 * 60 * 60 * 1000));
});

const effectiveUsageDaysText = computed(() =>
  effectiveUsageDays.value > 0 ? `${effectiveUsageDays.value} 天` : "请先选择有效的起止时间",
);

const contractFormRules: FormRules<ContractDetails> = {
  amount: [
    {
      validator: (_rule, value, callback) => {
        if (value === null || value === undefined) {
          callback(new Error("请输入购买金额"));
        } else if (!Number.isFinite(value) || value <= 0) {
          callback(new Error("购买金额必须大于0"));
        } else {
          callback();
        }
      },
      trigger: ["blur", "change"],
    },
  ],
  usageStartTime: [
    {
      validator: (_rule, value, callback) => {
        if (!isValidDate(value)) {
          callback(new Error("请选择开始时间"));
        } else {
          callback();
        }
      },
      trigger: "change",
    },
  ],
  usageEndTime: [
    {
      validator: (_rule, value, callback) => {
        if (!isValidDate(value)) {
          callback(new Error("请选择结束时间"));
        } else if (
          isValidDate(contractForm.value.usageStartTime) &&
          contractForm.value.usageStartTime.getTime() >= value.getTime()
        ) {
          callback(new Error("结束时间必须晚于开始时间"));
        } else {
          callback();
        }
      },
      trigger: "change",
    },
  ],
};

function handleUsageStartTimeChange() {
  if (contractForm.value.usageEndTime) {
    contractFormRef.value?.validateField("usageEndTime").catch(() => undefined);
  }
}

function handleContractDialogClosed() {
  contractFormRef.value?.clearValidate();
  contractFile.value = null;
}

async function submitContract() {
  if (!activeOrder.value) {
    ElMessage.warning("请选择订单");
    return;
  }
  if (!canCurrentUserStartSigning()) return;
  if (!contractFile.value) {
    ElMessage.warning("请选择合同文件");
    return;
  }
  if (!contractFormRef.value) return;

  const valid = await contractFormRef.value.validate().catch(() => false);
  if (!valid) {
    ElMessage.warning("请检查合同信息是否填写正确");
    return;
  }

  contractSubmitting.value = true;
  try {
    await sendContractFile(
      activeOrder.value,
      contractFile.value,
      contractForm.value,
    );
    ElMessage.success("合同文件发送成功");
    contractFormVisible.value = false;
  } catch (error: any) {
    ElMessage.error(error.message || "合同文件发送失败");
  } finally {
    contractSubmitting.value = false;
  }
}

function handleIsAgreeContract(isAgree: boolean, message: any) {
  console.log("handleIsAgreeContract", isAgree, message);
}

import { renderAsync } from "docx-preview";

// ... existing imports

const previewVisible = ref(false);
const previewUrl = ref("");
const previewLoading = ref(false);
const previewType = ref<"pdf" | "docx" | "unknown">("unknown");
const docxContainer = ref<HTMLElement | null>(null);

async function handlePreviewFile(message: ChatMessage) {
  previewVisible.value = true;
  previewLoading.value = true;
  previewUrl.value = "";
  previewType.value = "unknown";

  try {
    const fileName = message.metadata?.fileName?.toLowerCase() || "";
    if (fileName.endsWith(".pdf")) {
      previewType.value = "pdf";
    } else if (fileName.endsWith(".docx")) {
      previewType.value = "docx";
    }

    const url = await downLoadFile(message as any, false);
    if (url) {
      console.log("Preview URL:", url);
      previewUrl.value = url;

      if (previewType.value === "docx") {
        // Fetch blob and render
        const response = await fetch(url);
        const blob = await response.blob();
        if (docxContainer.value) {
          await renderAsync(blob, docxContainer.value);
        }
      }
    } else {
      ElMessage.warning("无法获取预览链接");
    }
  } catch (error: any) {
    ElMessage.error(error.message || "预览失败");
    console.error("Preview error:", error);
  } finally {
    previewLoading.value = false;
  }
}

// 初始化
onMounted(async () => {
  console.log("[ChatMain] Component mounted");

  await loadOrders();
  await syncOfflineMessages();

  console.log("[ChatMain] Orders loaded:", orders.value.length);

  // ===============================================

  // 处理从登录跳转过来的orderId或bssOrderId
  const initialOrderId = route.query.orderId as string;
  const initialBssOrderId = route.query.bssOrderId as string;

  if (initialOrderId) {
    await handleOrderSelect(initialOrderId);
    router.replace({ query: {} });
  } else if (initialBssOrderId) {
    const targetOrder = orderStore.orderList.find(
      (o) => o.bssOrderId === Number(initialBssOrderId),
    );
    if (targetOrder) {
      await handleOrderSelect(targetOrder.orderId);
    } else {
      ElMessage.warning("未找到匹配的订单");
    }
    router.replace({ query: {} });
  }
});
</script>

<style scoped>
.chat-main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f7fa;
}

.top-navbar {
  height: 60px;
  background-color: #fff;
  border-bottom: 1px solid #dcdfe6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  z-index: 10;
}

.navbar-left h2 {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.navbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #606266;
}

.chat-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-panel {
  width: 300px;
  background-color: #fff;
  border-right: 1px solid #dcdfe6;
  display: flex;
  flex-direction: column;
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #f5f7fa;
  position: relative;
}

.right-panel {
  width: 350px;
  background-color: #fff;
  border-left: 1px solid #dcdfe6;
  transition: width 0.3s ease;
  overflow: hidden;
}

.right-panel.collapsed {
  width: 0;
  border-left: none;
}

.empty-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.toggle-detail-btn {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 48px;
  background-color: #fff;
  border: 1px solid #dcdfe6;
  border-right: none;
  border-radius: 4px 0 0 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  z-index: 5;
  box-shadow: -2px 0 4px rgba(0, 0, 0, 0.05);
}

.toggle-detail-btn:hover {
  background-color: #f5f7fa;
}

.docx-container {
  width: 100%;
  height: 600px;
  overflow-y: auto;
  background: #fff;
  padding: 20px;
}

.group-chat-badge {
  margin-right: 16px;
}
</style>
