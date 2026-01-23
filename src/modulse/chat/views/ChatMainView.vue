<!-- chat/views/ChatMainView.vue -->
<template>
  <div class="chat-main-view">
    <!-- 顶部导航栏 -->
    <div class="top-navbar">
      <div class="navbar-left">
        <h2>订单磋商</h2>
      </div>
      <div class="navbar-right">
        <el-badge :value="totalUnreadCount" :hidden="totalUnreadCount === 0">
          <el-button text @click="user2MockLogin">
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
              <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 三栏布局 -->
    <div class="chat-container">
      <!-- 左侧：订单列表 -->
      <div class="left-panel">
        <OrderList :orders="orders" :active-order-id="activeOrderId" :unread-count="totalUnreadCount"
          :purchase-active-count="purchaseActiveCount" :sale-active-count="saleActiveCount"
          @select="handleOrderSelect" />
      </div>

      <!-- 中间：聊天区域 -->
      <div class="center-panel">
        <template v-if="activeOrder">
          <MessageArea :order="activeOrder" :messages="currentMessages" :loading="messagesLoading"
            @load-more="handleLoadMoreMessages" @is-agree-contract="handleIsAgreeContract" @download="handleDonloadFile"
            @preview="handlePreviewFile" />
          <MessageInput :order="activeOrder" :disabled="!canSendMessage" :is-connected="isWebSocketConnected" @send="handleSendMessage"
            @send-file="handleSendFile" @send-contract="handleSendContract" />
        </template>
        <div v-else class="empty-state">
          <el-empty description="请选择一个订单开始磋商" />
        </div>
      </div>

      <!-- 右侧：订单详情（可折叠） -->
      <div class="right-panel" :class="{ collapsed: !showOrderDetail }">
        <OrderDetail v-if="activeOrder" :order="activeOrder" @close="showOrderDetail = false"
          @create-contract="handleCreateContract" />
      </div>

      <!-- 折叠按钮 -->
      <div v-if="activeOrder" class="toggle-detail-btn" @click="showOrderDetail = !showOrderDetail">
        <el-icon>
          <DArrowLeft v-if="showOrderDetail" />
          <DArrowRight v-else />
        </el-icon>
      </div>
    </div>
    <!-- 合同详情弹窗 -->
    <el-dialog v-model="contractFormVisible" title="填写合同详情" width="500px" :close-on-click-modal="false">
      <el-form :model="contractForm" label-width="120px">
        <el-form-item label="订单编号">
          <el-input :model-value="activeOrder?.id" disabled />
        </el-form-item>
        <el-form-item label="购买金额">
          <el-input-number v-model="contractForm.amount" :precision="2" :step="0.1" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="使用期限(月)">
          <el-input-number v-model="contractForm.usagePeriod" :min="1" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="开始时间">
          <el-date-picker v-model="contractForm.usageStartTime" type="datetime" placeholder="选择开始时间"
            style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker v-model="contractForm.usageEndTime" type="datetime" placeholder="选择结束时间"
            style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="contractFormVisible = false">取消</el-button>
          <el-button type="primary" @click="submitContract"> 确认签署 </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 文件预览弹窗 -->
    <el-dialog v-model="previewVisible" title="文件预览" width="80%" :close-on-click-modal="false" destroy-on-close>
      <div class="preview-container" v-loading="previewLoading">
        <iframe v-if="previewType === 'pdf' && previewUrl" :src="previewUrl" width="100%" height="600px"
          frameborder="0"></iframe>
        <div v-else-if="previewType === 'docx'" ref="docxContainer" class="docx-container" style="padding: 0;"></div>
        <div v-else class="preview-error">
          <el-empty description="暂不支持预览此类型文件" />
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Message, DArrowLeft, DArrowRight } from "@element-plus/icons-vue";
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

const route = useRoute();
const router = useRouter();

const showOrderDetail = ref(true);

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

import { useOrderStore } from '../../orders/store/order.store';
const orderStore = useOrderStore();


// 初始化消息处理器，传入 activeOrderId 以便在当前会话时不增加未读数
const { isWebSocketConnected, syncOfflineMessages } = useMessageHandlers(activeOrderId);

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
  return user.userName || "用户";
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
      currentMessages.value.length
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

function handleCreateContract() {
  if (!activeOrder.value) return;

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
      // router.push("/settings");
      router.push("/key-test");
      break;
    case "logout":
      localStorage.clear();
      router.push("/login");
      break;
  }
}
function user2MockLogin() {
  console.log("Mock login clicked");
}

async function handleSendContract(file: File) {
  if (!activeOrder.value) return;
  contractFile.value = file;
  contractFormVisible.value = true;
}

const contractFormVisible = ref(false);
const contractFile = ref<File | null>(null);
const contractForm = ref<ContractDetails>({
  amount: 0,
  usagePeriod: 12,
  usageStartTime: new Date(),
  usageEndTime: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
});

async function submitContract() {
  if (!activeOrder.value || !contractFile.value) return;

  try {
    await sendContractFile(
      activeOrder.value,
      contractFile.value,
      contractForm.value
    );
    ElMessage.success("合同文件发送成功");
    contractFormVisible.value = false;
  } catch (error: any) {
    ElMessage.error(error.message || "合同文件发送失败");
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
  // mockLogin(
  //   {
  //     id: "101",
  //     openId: "openid1",
  //     userName: "user1",
  //     tenantId: 101,
  //   },
  //   {
  //     token:
  //       "eyJhbGciOiJIUzI1NiJ9.eyJvcGVuSWQiOiJvcGVuaWQxIiwidGVuYW50SWQiOjEwMSwiaWQiOjEsImV4cCI6MTc2NDE2MzMyNCwidXNlcm5hbWUiOiJ1c2VyMSJ9.b_6asDOMYxlisrb4NVTtcDm5il7EkQqw7asC4VXSbMo",
  //   }
  // );
  // mockLogin(
  //   {
  //     id: "102",
  //     openId: "openid2",
  //     userName: "user2",
  //     tenantId: 102,
  //   },
  //   {
  //     token:
  //       "eyJhbGciOiJIUzI1NiJ9.eyJvcGVuSWQiOiJvcGVuaWQyIiwidGVuYW50SWQiOjEwMiwiaWQiOjIsImV4cCI6MTc2NDE2MzMyNSwidXNlcm5hbWUiOiJ1c2VyMiJ9.iLkSRhnR-_5BNjiQygU_j7obwMIfhXtk6uKTBCYiKG4",
  //   }
  // );
  // mockLogin(
  //   {
  //     id: "196",
  //     openId: "openid2",
  //     userName: "user2",
  //     tenantId: 196,
  //   },
  //   {
  //     token:
  //       "eyJhbGciOiJIUzI1NiJ9.eyJvcGVuSWQiOiI2NGQ0N2ZhNWU0YjA1YTA3N2JhMWQ1OTciLCJ0ZW5hbnRJZCI6MTk2LCJpZCI6MTcsImV4cCI6MTc2NDg2OTAxMCwidXNlcm5hbWUiOiJtYXRlbmd6aGFvIn0.cY_P6ALGVyxPrUtlfX4hqqo29pyW-yHdmc3NAsRdTTs",
  //   }
  // );
  console.log("[ChatMain] Component mounted");

  await loadOrders();
  await syncOfflineMessages();

  console.log("[ChatMain] Orders loaded:", orders.value.length);

  // 处理从登录跳转过来的orderId
  const initialOrderId = route.query.orderId as string;
  if (initialOrderId) {
    await handleOrderSelect(initialOrderId);
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
