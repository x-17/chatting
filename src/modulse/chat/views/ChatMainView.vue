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
          <el-button text>
            <el-icon><Message /></el-icon>
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
          :active-order-id="activeOrder?.id || null"
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
            @load-more="handleLoadMoreMessages"
          />
          <MessageInput
            :order="activeOrder"
            :disabled="!canSendMessage"
            @send="handleSendMessage"
            @send-file="handleSendFile"
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Message, DArrowLeft, DArrowRight } from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import OrderList from "../components/OrderList.vue";
import MessageArea from "../components/MessageArea.vue";
import MessageInput from "../components/MessageInput.vue";
import OrderDetail from "../components/OrderDetail.vue";
import { useChat } from "../composables/useChat";
import { useOrderList } from "../composables/useOrderList";
import mockLogin from "@/utils/mockLogin";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const showOrderDetail = ref(true);

// 使用 composables
const { orders, activeOrder, totalUnreadCount, loadOrders, selectOrder } =
  useOrderList();

const {
  currentMessages,
  messagesLoading,
  sendMessage,
  sendFile,
  loadConversationMessages,
  loadMoreMessages,
} = useChat();

//组件命名，用于keep-alive
defineOptions({ name: 'ChatMainView' });

// 计算属性
const userName = computed(() => {
  const userId=sessionStorage.getItem('auth_current_user_id');
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

function handleLoadMoreMessages() {
  if (activeOrder.value) {
    loadMoreMessages(activeOrder.value.conversationId);
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
      router.push("/settings");
      break;
    case "logout":
      localStorage.clear();
      router.push("/login");
      break;
  }
}

// 初始化
onMounted(async () => {
  mockLogin({
    id: "user_alice",
    openid: "dev-openid",
    userName: "本地开发",
    password: "",
  });
  console.log("[ChatMain] Component mounted");

  await loadOrders();

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
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.top-navbar {
  height: 60px;
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.navbar-left h2 {
  margin: 0;
  font-size: 20px;
  color: #303133;
}

.navbar-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 4px;
  transition: background 0.3s;
}

.user-info:hover {
  background: #f5f7fa;
}

.chat-container {
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
}

.left-panel {
  width: 320px;
  background: white;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  overflow: hidden;
}

.right-panel {
  width: 360px;
  background: white;
  border-left: 1px solid #e4e7ed;
  transition: all 0.3s;
  overflow-y: auto;
}

.right-panel.collapsed {
  width: 0;
  border: none;
  overflow: hidden;
}

.toggle-detail-btn {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 48px;
  background: white;
  border: 1px solid #e4e7ed;
  border-right: none;
  border-radius: 4px 0 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
  z-index: 10;
}

.toggle-detail-btn:hover {
  background: #f5f7fa;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 响应式 */
@media (max-width: 1200px) {
  .right-panel {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  }
}

@media (max-width: 768px) {
  .left-panel {
    width: 280px;
  }

  .right-panel {
    width: 100%;
  }
}
</style>