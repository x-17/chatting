<template>
  <div class="login-container">
    <div class="login-wrapper">
      <!-- 错误提示 -->
      <div v-if="errorAlert.show" class="error-alert">
        <el-alert
          :type="errorAlert.type"
          :title="errorAlert.title"
          :description="errorAlert.description"
          show-icon
          :closable="true"
          @close="dismissError"
        />
      </div>

      <!-- 登录卡片 -->
      <el-card class="login-card" :class="{ loading: isLoading }">
        <template #header>
          <div class="card-header">
            <div class="logo-section">
              <div class="logo-icon">🔐</div>
              <span class="system-title">数据安全交易系统</span>
            </div>
            <div class="subtitle">基于端到端加密的安全通信平台</div>
          </div>
        </template>

        <!-- 登录说明及进度 -->
        <div class="login-content">
          <div class="login-info">
            <h3>上交统一身份认证</h3>
            <p class="login-description" v-if="isLoading && !hasError">
              正在处理来自上交统一身份认证的登录请求。
              验证成功后将自动为您建立端到端加密通信环境。
            </p>
            <p class="login-description" v-else-if="hasError">
              登录校验遇到问题。您可选择重新尝试。
            </p>
          </div>

          <!-- 加载状态展示 -->
          <div class="progress-section" v-if="isLoading && !hasError">
            <div class="spinner-container">
              <div class="loading-spinner"></div>
            </div>
            <div class="status-text">{{ loadingText }}</div>
          </div>

          <!-- 安全特性展示 (未开始，或出错时展示) -->
          <div class="security-features" v-if="!isLoading || hasError">
            <div class="feature-item">
              <div class="feature-icon">🛡️</div>
              <div class="feature-text">
                <div class="feature-title">端到端加密</div>
                <div class="feature-desc">消息内容完全加密保护</div>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-icon">🔑</div>
              <div class="feature-text">
                <div class="feature-title">密钥本地生成</div>
                <div class="feature-desc">加密密钥仅存储在本地</div>
              </div>
            </div>
          </div>

          <!-- 操作按钮：仅在出错时展示，正常流程自动登录 -->
          <div class="login-actions" v-if="hasError">
            <el-button
              type="primary"
              size="large"
              @click="retryLogin"
              class="login-button"
            >
              重新尝试
            </el-button>
          </div>
        </div>
      </el-card>

      <!-- 页面底部信息 -->
      <div class="footer-info">
        <div class="version-info">系统版本：v1.0.0</div>
        <div class="security-badge">🔒 采用Signal算法保障数据安全</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElButton, ElCard, ElAlert, ElMessage } from "element-plus";
import { useAuthStore } from "../services/auth.store";
import { OrderApiService } from "../../orders/services/order-api.service";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const orderApi = new OrderApiService();

// 记录本机已消费过的上交 ticket。门户 F5 后 URL 里仍是同一张已失效的旧票，
// 靠这个标记跳过换取 token，直接复用已建立的会话，避免拿废票反复请求。
// 存列表而不是单值：用户可能开多个标签页各自发起交易，单值会被互相覆盖。
const CONSUMED_TICKET_KEY = "sj_consumed_ticket";
const CONSUMED_TICKET_LIMIT = 5;

const readConsumedTickets = (): string[] => {
  try {
    const raw = localStorage.getItem(CONSUMED_TICKET_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 存储被写坏时按「没记录过」处理，走正常登录路径
    return [];
  }
};

const markTicketConsumed = (ticket: string) => {
  const tickets = readConsumedTickets().filter((item) => item !== ticket);
  tickets.push(ticket);
  localStorage.setItem(
    CONSUMED_TICKET_KEY,
    JSON.stringify(tickets.slice(-CONSUMED_TICKET_LIMIT)),
  );
};

const isLoading = ref(false);
const hasError = ref(false);
const currentStep = ref("verifying"); // verifying, keygen, order, success, error
// loginByTicket 是否已被服务端接受。一旦接受，这张一次性 ticket 就已核销，
// 即使后续步骤（密钥注册、建单）失败，也不能再拿它重新换取 token。
const ticketAccepted = ref(false);
// 当前这一轮走的是哪条路：用 ticket 换 token，还是复用已有会话。
// 失败时据此决定提示文案（票据被拒 vs 会话/密钥问题）。
const activeFlow = ref<"ticket" | "session">("ticket");

// 错误提示状态
const errorAlert = ref({
  show: false,
  type: "error" as "error" | "warning" | "info",
  title: "",
  description: "",
});

// 监听Pinia Store中的状态变化来改变内部进度状态
watch(
  () => authStore.status,
  (newStatus) => {
    if (newStatus === "loading") {
      currentStep.value = "verifying";
    } else if (newStatus === "settingUp") {
      // 走到这里说明 loginByTicket 已返回 code=0 + tenantId，票已被核销
      ticketAccepted.value = true;
      currentStep.value = "keygen";
    } else if (newStatus === "success") {
      // code=1，票已被核销
      ticketAccepted.value = true;
      currentStep.value = "order";
    } else if (newStatus === "error") {
      currentStep.value = "error";
      hasError.value = true;
      isLoading.value = false;

      const raw = authStore.errorMessage || "";
      // 原始信息多半是后端嵌套的错误字符串，对用户没有意义，留在控制台
      console.error("[ShangjiaoCallback] 登录失败，原始信息：", raw);

      if (activeFlow.value === "session") {
        // 复用会话失败（如密钥指纹不匹配），store 给出的原因更具体，原样透出
        showErrorAlert(
          "error",
          "登录失败",
          raw || "本地登录状态已失效，请返回交易系统重新发起交易。",
        );
      } else if (!ticketAccepted.value) {
        // 票在换取 token 这一步就被拒了
        showErrorAlert(
          "error",
          "登录失败",
          "当前登录凭证无效或已失效，请返回交易系统重新发起交易。",
        );
      } else {
        // 票没问题，是后续的密钥注册/校验出的问题
        showErrorAlert("error", "登录失败", raw || "安全验证失败，请稍后重试");
      }
    }
  },
);

// 状态文字提示
const loadingText = computed(() => {
  switch (currentStep.value) {
    case "verifying":
      return "正在安全验证登录凭证，请稍候...";
    case "keygen":
      return "首次登录，正在建立本地端到端加密通道...";
    case "order":
      return "密钥验证成功，正在进入磋商订单页面...";
    case "success":
      return "验证成功，正在跳转...";
    default:
      return "请稍候...";
  }
});

// 辅助函数：从route.query或URL hash手动解析参数（兼容不同门户的参数传递方式）
const getQueryParam = (key: string): string | undefined => {
  // 优先从 route.query 读取
  const fromRoute = route.query[key];
  if (fromRoute) {
    return Array.isArray(fromRoute) ? fromRoute[0] : String(fromRoute);
  }
  
  // 如果 route.query 读不到，从原始 hash 手动解析
  const hash = window.location.hash;
  const queryStart = hash.indexOf('?');
  if (queryStart !== -1) {
    const queryString = hash.substring(queryStart + 1);
    const urlParams = new URLSearchParams(queryString);
    return urlParams.get(key) || undefined;
  }
  
  return undefined;
};

onMounted(() => {
  validateParams();
  if (hasError.value) {
    return;
  }

  const ticket = getQueryParam('ticket') as string;

  // 门户 F5 或重复设置 iframe src 时，URL 里还是同一张已失效的旧票。
  // 这时不重新换取 token，直接复用本机已建立的会话。
  if (readConsumedTickets().includes(ticket)) {
    resumeExistingSession();
    return;
  }

  startTicketLoginFlow();
});

const validateParams = () => {
  const ticket = getQueryParam('ticket');
  const orderId = getQueryParam('orderId');

  if (!ticket || !orderId) {
    hasError.value = true;
    showErrorAlert(
      "error",
      "参数缺失",
      "无效的登录路径，缺少必要参数 ticket 或 orderId。",
    );
  }
};

/**
 * 票据已消费情况下（门户刷新、iframe 重建）的快速通道。
 * 不调用 loginByTicket，只用本机保存的会话来继续进入磋商。
 */
const resumeExistingSession = async () => {
  activeFlow.value = "session";
  isLoading.value = true;
  hasError.value = false;
  errorAlert.value.show = false;

  await authStore.initializeAuth();

  if (!authStore.isAuthenticated) {
    isLoading.value = false;
    hasError.value = true;
    currentStep.value = "error";

    // 密钥指纹不匹配这类失败，store 已经通过 watch 给出了更具体的原因，不覆盖它
    if (authStore.status !== "error") {
      showErrorAlert(
        "warning",
        "登录已过期",
        "本地登录状态已失效，当前登录凭证无法再次使用。请返回交易系统重新发起交易。",
      );
    }
    return;
  }

  await enterOrder();
};

const startTicketLoginFlow = async () => {
  activeFlow.value = "ticket";
  authStore.reset();
  isLoading.value = true;
  hasError.value = false;
  errorAlert.value.show = false;

  const ticket = getQueryParam('ticket') as string;
  const orderId = getQueryParam('orderId') as string;
  const parentOrderId = getQueryParam('parentOrderId') as string;

  if (!ticket || !orderId) {
    isLoading.value = false;
    hasError.value = true;
    showErrorAlert(
      "error",
      "参数缺失",
      "无效的登录路径，缺少必要参数 ticket 或 orderId。",
    );
    return;
  }

  try {
    // 1. 调用 ticket 登录及密钥注册流程
    const loginSuccess = await authStore.handleTicketCallback(
      ticket,
      orderId,
      parentOrderId,
    );

    // 票据已被服务端核销：无论后续成功与否都记下来，
    // 免得下次刷新时再拿这张废票去请求。
    if (ticketAccepted.value) {
      markTicketConsumed(ticket);
    }

    if (!loginSuccess) {
      isLoading.value = false;
      // 正常情况下 store 会把 status 置为 error，由 watch 负责弹出具体原因；
      // 兜底处理 status 未变更的早退分支（如并发请求被拒），避免界面卡住无提示
      if (authStore.status !== "error") {
        hasError.value = true;
        currentStep.value = "error";
        showErrorAlert("error", "登录失败", "登录流程未完成，请重新尝试。");
      }
      return;
    }

    // 2. 登录成功，创建订单并进入聊天页
    await enterOrder();
  } catch (err: any) {
    isLoading.value = false;
    hasError.value = true;
    currentStep.value = "error";
    showErrorAlert(
      "error",
      "初始化失败",
      err?.message || "登录成功但订单磋商环境初始化失败，请重试。",
    );
  }
};

/**
 * 创建订单并跳转聊天页。登录成功后的主路径与「票据已消费」快速通道共用。
 */
const enterOrder = async () => {
  const orderId = getQueryParam('orderId') as string;
  const parentOrderId = getQueryParam('parentOrderId') as string;

  currentStep.value = "order";
  isLoading.value = true;
  hasError.value = false;
  errorAlert.value.show = false;

  const bssOrderId = Number(orderId);
  const bssParentOrderId = parentOrderId ? Number(parentOrderId) : undefined;

  if (isNaN(bssOrderId) || bssOrderId <= 0) {
    isLoading.value = false;
    hasError.value = true;
    showErrorAlert(
      "error",
      "订单参数错误",
      "无效的订单 ID，请返回交易系统重新发起交易。",
    );
    return;
  }

  try {
    const res = await orderApi.createOrder(bssOrderId, bssParentOrderId);

    // 建单失败就不能进聊天页：/chat 依赖这里创建出来的订单
    if (res.code !== 0) {
      isLoading.value = false;
      hasError.value = true;
      currentStep.value = "error";
      showErrorAlert(
        "error",
        "订单初始化失败",
        res.msg || "无法进入磋商订单，请稍后重试。",
      );
      return;
    }

    ElMessage.success("进入磋商订单成功");
    currentStep.value = "success";

    // 3. 进入聊天页面
    router.replace({
      path: "/chat",
      query: { bssOrderId: bssOrderId.toString() },
    });
  } catch (err: any) {
    isLoading.value = false;
    hasError.value = true;
    currentStep.value = "error";
    showErrorAlert(
      "error",
      "初始化失败",
      err?.message || "订单磋商环境初始化失败，请重试。",
    );
  }
};

const retryLogin = async () => {
  hasError.value = false;
  errorAlert.value.show = false;

  // 登录其实已经成功，只是建单/跳转那一步失败 —— 不必重新换取 token
  if (authStore.isAuthenticated) {
    await enterOrder();
    return;
  }

  // 票已被核销（含换取 token 成功但后续步骤失败的情况），
  // 再拿它去请求只会被拒，改走会话恢复。
  const ticket = getQueryParam('ticket') as string;
  if (readConsumedTickets().includes(ticket)) {
    await resumeExistingSession();
    return;
  }

  await startTicketLoginFlow();
};

const showErrorAlert = (
  type: "error" | "warning" | "info",
  title: string,
  description: string,
) => {
  errorAlert.value = {
    show: true,
    type,
    title,
    description,
  };
};

const dismissError = () => {
  errorAlert.value.show = false;
};
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  width: 100vw;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  position: relative;
}

.login-wrapper {
  width: 100%;
  max-width: 500px;
  position: relative;
}

.error-alert {
  margin-bottom: 20px;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.login-card.loading {
  transform: scale(1.02);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
}

.card-header {
  text-align: center;
  padding: 10px 0;
}

.logo-section {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.logo-icon {
  font-size: 32px;
  margin-right: 12px;
}

.system-title {
  font-size: 24px;
  font-weight: bold;
  color: #2c3e50;
}

.subtitle {
  font-size: 14px;
  color: #7f8c8d;
  margin-top: 4px;
}

.login-content {
  padding: 20px 0;
}

.login-info {
  text-align: center;
  margin-bottom: 30px;
}

.login-info h3 {
  color: #34495e;
  margin-bottom: 12px;
  font-size: 18px;
}

.login-description {
  color: #7f8c8d;
  line-height: 1.6;
  font-size: 14px;
}

.progress-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 0;
}

.spinner-container {
  margin-bottom: 20px;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid rgba(102, 126, 234, 0.1);
  border-left-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status-text {
  font-size: 15px;
  color: #57606f;
  font-weight: 500;
  text-align: center;
}

.security-features {
  margin-bottom: 30px;
}

.feature-item {
  display: flex;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #f1f2f6;
}

.feature-item:last-child {
  border-bottom: none;
}

.feature-icon {
  font-size: 20px;
  margin-right: 12px;
  width: 32px;
  text-align: center;
}

.feature-text {
  flex: 1;
}

.feature-title {
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 4px;
  font-size: 14px;
}

.feature-desc {
  color: #7f8c8d;
  font-size: 12px;
}

.login-actions {
  margin-bottom: 20px;
}

.login-button,
.retry-button {
  width: 100%;
  height: 48px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  transition: all 0.3s ease;
}

.login-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(64, 158, 255, 0.3);
}

.footer-info {
  text-align: center;
  margin-top: 20px;
  padding-top: 20px;
}

.version-info,
.security-badge {
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  margin-bottom: 8px;
}

.security-badge {
  font-weight: 600;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .login-container {
    padding: 10px;
  }

  .login-card {
    border-radius: 12px;
  }

  .logo-icon {
    font-size: 28px;
    margin-right: 8px;
  }

  .system-title {
    font-size: 20px;
  }

  .login-info h3 {
    font-size: 16px;
  }

  .feature-item {
    padding: 10px 0;
  }

  .login-button,
  .retry-button {
    height: 44px;
    font-size: 15px;
  }
}

/* 暗黑模式适配 */
@media (prefers-color-scheme: dark) {
  .login-card {
    background: rgba(30, 30, 30, 0.95);
    color: #e9ecef;
  }

  .system-title,
  .login-info h3 {
    color: #e9ecef;
  }

  .subtitle,
  .login-description,
  .feature-desc {
    color: #adb5bd;
  }

  .feature-title {
    color: #e9ecef;
  }
}
</style>
