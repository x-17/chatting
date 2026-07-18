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
              <span class="system-title">安全交易系统</span>
            </div>
            <div class="subtitle">基于端到端加密的安全通信平台</div>
          </div>
        </template>

        <!-- 登录说明及进度 -->
        <div class="login-content">
          <div class="login-info">
            <h3>上交统一身份认证</h3>
            <p class="login-description" v-if="!isInitiated && !hasError">
              系统检测到您已通过上交身份验证，请点击下方“确认登录”按钮进入安全磋商系统。
            </p>
            <p class="login-description" v-else-if="isLoading && !hasError">
              正在处理来自上交统一身份认证的登录请求。
              验证成功后将自动为您建立端到端加密通信环境。
            </p>
            <p class="login-description" v-else-if="hasError">
              登录校验遇到问题。您可选择重新验证。
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

          <!-- 操作按钮 -->
          <div class="login-actions">
            <!-- 初始点击登录 -->
            <el-button
              v-if="!isInitiated && !hasError"
              type="primary"
              size="large"
              @click="confirmLogin"
              class="login-button"
            >
              确认登录
            </el-button>

            <!-- 出错时展示的重试和返回 -->
            <template v-if="hasError">
              <el-button
                type="primary"
                size="large"
                @click="retryLogin"
                class="login-button"
              >
                重新尝试验证
              </el-button>
              <!-- <el-button
                size="large"
                type="default"
                @click="goToMainLogin"
                class="retry-button"
                style="margin-left: 0"
              >
                返回普通登录
              </el-button> -->
            </template>
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

const isInitiated = ref(false);
const isLoading = ref(false);
const hasError = ref(false);
const currentStep = ref("verifying"); // verifying, keygen, order, success, error

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
      currentStep.value = "keygen";
    } else if (newStatus === "success") {
      currentStep.value = "order";
    } else if (newStatus === "error") {
      currentStep.value = "error";
      hasError.value = true;
      isLoading.value = false;
      showErrorAlert(
        "error",
        "登录失败",
        authStore.errorMessage || "安全验证失败，请稍后重试",
      );
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

onMounted(() => {
  // 只在挂载时做参数预检，但不自动触发登录
  validateParams();
});

const validateParams = () => {
  const ticket = route.query.ticket as string;
  const orderId = route.query.orderId as string;

  if (!ticket || !orderId) {
    hasError.value = true;
    showErrorAlert(
      "error",
      "参数缺失",
      "无效的登录路径，缺少必要参数 ticket 或 orderId。",
    );
  }
};

const confirmLogin = () => {
  isInitiated.value = true;
  startTicketLoginFlow();
};

const startTicketLoginFlow = async () => {
  authStore.reset();
  isLoading.value = true;
  hasError.value = false;
  errorAlert.value.show = false;

  const ticket = route.query.ticket as string;
  const orderId = route.query.orderId as string;
  const parentOrderId = route.query.parentOrderId as string;

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
    if (!loginSuccess) {
      return;
    }

    // 2. 登录成功后，创建订单
    currentStep.value = "order";
    const bssOrderId = Number(orderId);
    const bssParentOrderId = parentOrderId ? Number(parentOrderId) : undefined;

    if (isNaN(bssOrderId) || bssOrderId <= 0) {
      throw new Error("无效的订单ID");
    }

    const msg = await orderApi.createOrder(bssOrderId, bssParentOrderId);
    ElMessage.success(msg || "进入磋商订单成功");
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
      err?.message || "登录成功但订单磋商环境初始化失败，请重试。",
    );
  }
};

const retryLogin = () => {
  confirmLogin();
};

const goToMainLogin = () => {
  router.push("/login");
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
