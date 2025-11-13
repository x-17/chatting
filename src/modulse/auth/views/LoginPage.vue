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
              <span class="system-title">安全磋商系统</span>
            </div>
            <div class="subtitle">基于端到端加密的安全通信平台</div>
          </div>
        </template>

        <!-- 登录说明 -->
        <div class="login-content">
          <div class="login-info">
            <h3>统一身份认证登录</h3>
            <p class="login-description">
              系统采用北数所统一认证平台进行身份验证，确保账户安全。
              登录后将自动为您建立端到端加密通信环境。
            </p>
          </div>

          <!-- 安全特性展示 -->
          <div class="security-features">
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
            <div class="feature-item">
              <div class="feature-icon">🚫</div>
              <div class="feature-text">
                <div class="feature-title">零知识架构</div>
                <div class="feature-desc">服务器无法读取消息内容</div>
              </div>
            </div>
          </div>

          <!-- 登录按钮 -->
          <div class="login-actions">
            <el-button
              type="primary"
              size="large"
              @click="redirectToSso"
              :loading="isLoading"
              :disabled="!isConfigValid || cooldownRemaining > 0"
              class="login-button"
            >
              <span v-if="cooldownRemaining > 0">
                请等待 {{ cooldownRemaining }}s 后重试
              </span>
              <span v-else-if="isLoading">
                {{ loadingText }}
              </span>
              <span v-else> 前往统一认证平台登录 </span>
            </el-button>

            <!-- 重试按钮（错误时显示） -->
            <el-button
              v-if="hasError && !isLoading"
              @click="retryLogin"
              size="large"
              type="default"
              class="retry-button"
            >
              重试登录
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
import { onMounted, ref, computed, onUnmounted } from "vue";
import { ElButton, ElCard, ElAlert, ElMessage } from "element-plus";
import { useRoute } from "vue-router";

// 状态管理
const route = useRoute();
const isLoading = ref(false);
const hasError = ref(false);
const cooldownRemaining = ref(0);
const retryAttempts = ref(0);

// 错误提示状态
const errorAlert = ref({
  show: false,
  type: "error" as "error" | "warning" | "info",
  title: "",
  description: "",
});

// 配置验证
const isConfigValid = ref(true);
let cooldownTimer: number | null = null;

// 计算属性
const loadingText = computed(() => {
  const texts = [
    "正在跳转到认证平台...",
    "正在建立安全连接...",
    "正在验证系统配置...",
  ];
  return texts[Math.floor(Date.now() / 2000) % texts.length];
});

// 初始化
onMounted(() => {
  initializeLogin();
  validateEnvironment();
  handleRouteParams();
});

// 清理定时器
onUnmounted(() => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }
});

// 初始化登录页面
const initializeLogin = () => {
  // 检查是否从错误页面重定向过来
  const reason = route.query.reason as string;
  if (reason) {
    showErrorAlert("warning", "需要重新登录", getReasonText(reason));
  }

  // 恢复重试次数
  const savedRetryCount = sessionStorage.getItem("login_retry_count");
  if (savedRetryCount) {
    retryAttempts.value = parseInt(savedRetryCount);
  }
};

// 验证环境配置
const validateEnvironment = () => {
  const ssoBaseUrl = import.meta.env.VITE_SSO_BASE_URL;
  const clientId = import.meta.env.VITE_SSO_CLIENT_ID;

  if (!ssoBaseUrl || !clientId) {
    isConfigValid.value = false;
    showErrorAlert(
      "error",
      "系统配置错误",
      "认证平台配置缺失，请联系系统管理员"
    );
    return;
  }

  // 验证URL格式
  try {
    new URL(ssoBaseUrl);
  } catch {
    isConfigValid.value = false;
    showErrorAlert("error", "配置无效", "认证平台地址格式不正确");
  }
};

// 处理路由参数
const handleRouteParams = () => {
  const orderId = route.query.orderId;
  if (typeof orderId === "string" && orderId) {
    sessionStorage.setItem("redirect_context_orderId", orderId);
    console.log(`Context saved: orderId = ${orderId}`);

    // 显示上下文信息
    showErrorAlert("info", "业务上下文", `订单 ${orderId} 需要登录后继续处理`);
  }
};

// 获取错误原因文本
const getReasonText = (reason: string): string => {
  const reasonMap: Record<string, string> = {
    expired: "您的登录会话已过期，为保障安全需要重新登录",
    error: "系统检测到异常，建议重新登录以确保安全",
    logout: "您已成功登出系统",
  };
  return reasonMap[reason] || "需要重新验证身份";
};

// 显示错误提示
const showErrorAlert = (
  type: "error" | "warning" | "info",
  title: string,
  description: string
) => {
  errorAlert.value = {
    show: true,
    type,
    title,
    description,
  };
};

// 关闭错误提示
const dismissError = () => {
  errorAlert.value.show = false;
  hasError.value = false;
};

// 开始冷却计时
const startCooldown = (seconds: number) => {
  cooldownRemaining.value = seconds;
  cooldownTimer = setInterval(() => {
    cooldownRemaining.value--;
    if (cooldownRemaining.value <= 0) {
      clearInterval(cooldownTimer!);
      cooldownTimer = null;
    }
  }, 1000);
};

// 主要登录逻辑
const redirectToSso = async () => {
  if (!isConfigValid.value || isLoading.value || cooldownRemaining.value > 0) {
    return;
  }

  try {
    isLoading.value = true;
    hasError.value = false;
    dismissError();

    // 增加重试限制
    if (retryAttempts.value >= 5) {
      throw new Error("登录尝试次数过多，请稍后再试或联系技术支持");
    }

    // 获取配置
    // const ssoBaseUrl = import.meta.env.VITE_SSO_BASE_URL;
    const ssoBaseUrl = import.meta.env.VITE_SSO_MOCK_URL; //测试用
    const clientId = import.meta.env.VITE_SSO_CLIENT_ID;

    // 生成安全的state参数
    const state = generateSecureState();
    const timestamp = Date.now().toString();

    // 存储验证信息
    sessionStorage.setItem("sso_state", state);
    sessionStorage.setItem("sso_state_timestamp", timestamp);

    // 构建回调地址
    const redirectUri = `${window.location.origin}/auth/callback`;

    // 构建授权URL
    const params = new URLSearchParams({
      client_id: clientId,
      state: state,
      redirect_uri: redirectUri,
      response_type: "code",
    });

    const authorizationUrl = `${ssoBaseUrl}/#/login/oauth?${params.toString()}`;

    // 验证URL有效性
    try {
      new URL(authorizationUrl);
    } catch {
      throw new Error("生成的授权URL无效");
    }

    // 更新重试计数
    retryAttempts.value++;
    sessionStorage.setItem("login_retry_count", retryAttempts.value.toString());

    // 添加延迟以显示加载状态
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 跳转到SSO平台
    window.location.href = authorizationUrl;
  } catch (error: any) {
    handleLoginError(error);
  } finally {
    // 延迟重置加载状态，防止页面闪烁
    setTimeout(() => {
      isLoading.value = false;
    }, 500);
  }
};

// 生成安全的state参数
const generateSecureState = (): string => {
  // 使用Web Crypto API生成安全随机数
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

// 处理登录错误
const handleLoginError = (error: any) => {
  console.error("Login error:", error);
  hasError.value = true;

  let title = "登录失败";
  let description = error.message || "未知错误";
  let cooldown = 0;

  // 根据错误类型设置不同的处理策略
  if (error.message.includes("配置")) {
    title = "系统配置错误";
    description = "认证平台配置有误，请联系系统管理员";
  } else if (error.message.includes("网络")) {
    title = "网络连接错误";
    description = "无法连接到认证服务器，请检查网络连接";
    cooldown = 5;
  } else if (error.message.includes("次数过多")) {
    title = "尝试次数过多";
    description = error.message;
    cooldown = 30;
  } else {
    // 通用错误处理
    if (retryAttempts.value >= 3) {
      cooldown = Math.min(10 * retryAttempts.value, 60);
    }
  }

  showErrorAlert("error", title, description);

  if (cooldown > 0) {
    startCooldown(cooldown);
  }
};

// 重试登录
const retryLogin = () => {
  // 重置错误状态
  hasError.value = false;
  dismissError();

  // 如果重试次数过多，重置计数器
  if (retryAttempts.value >= 5) {
    retryAttempts.value = 0;
    sessionStorage.removeItem("login_retry_count");
    ElMessage.info("重试计数器已重置");
  }

  // 重新尝试登录
  redirectToSso();
};
</script>

<style scoped>
.login-container {
  min-height: 100vh;
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

.help-section {
  margin-top: 20px;
}

.help-content {
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
}

.help-content ul {
  margin: 12px 0;
  padding-left: 20px;
}

.help-content li {
  margin-bottom: 8px;
}

.contact-info {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e9ecef;
  font-weight: 600;
  color: #495057;
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

  .help-content {
    background: rgba(255, 255, 255, 0.05);
    color: #e9ecef;
  }
}
</style>
