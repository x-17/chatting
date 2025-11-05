<template>
  <div></div>
</template>

<script setup lang="ts">
import { onMounted, watch, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElLoading, ElMessage } from "element-plus";
import { useAuthStore } from "../services/auth.store";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

// 存储ElLoading实例以便手动关闭
const loadingInstance = ref<any>(null);

// 根据Pinia状态计算不同的加载文本
const loadingText = computed(() => {
  switch (authStore.status) {
    case "loading":
      return "正在安全验证，请稍候...";
    case "settingUp":
      return "首次登录，正在为您建立端到端加密通道...";
    default:
      return "请稍候...";
  }
});

onMounted(() => {
  // 清理旧状态，以防万一
  authStore.reset();

  // 从URL获取code和state
  const { code, state } = route.query;

  // 简单的安全校验
  if (!code || !state) {
    ElMessage.error("无效的回调请求，缺少必要参数。");
    router.push("/error-page"); // 跳转到统一错误页
    return;
  }

  // TODO: 验证 state 与 sessionStorage 中存储的是否一致
  const savedState = sessionStorage.getItem("sso_state");
  if (state !== savedState) {
    ElMessage.error("安全验证失败(state mismatch)，请重新尝试。");
    router.push("/error-page");
    return;
  }
  sessionStorage.removeItem("sso_state");

  // 开始处理流程
  if (typeof code === "string") {
    authStore.handleSsoCallback(code);
  }
});

// 监听Pinia Store中的状态变化来控制UI
watch(
  () => authStore.status,
  (newStatus, oldStatus) => {
    // 当状态变为加载或设置时，显示Loading
    if (
      (newStatus === "loading" || newStatus === "settingUp") &&
      !loadingInstance.value
    ) {
      loadingInstance.value = ElLoading.service({
        lock: true,
        text: loadingText.value,
        background: "rgba(255, 255, 255, 0.85)",
      });
    }

    // 监听加载文本的变化
    if (
      loadingInstance.value &&
      (newStatus === "loading" || newStatus === "settingUp")
    ) {
      loadingInstance.value.setText(loadingText.value);
    }

    // 当流程成功时
    if (newStatus === "success") {
      if (loadingInstance.value) loadingInstance.value.close();
      ElMessage.success("欢迎回来！即将进入洽谈室。");

      // TODO: 从sessionStorage或Pinia中获取之前保存的上下文，如orderId
      const targetPath =
        sessionStorage.getItem("redirect_context_orderId") || "/";
      sessionStorage.removeItem("redirect_context_orderId");

      router.replace(targetPath); // 使用replace避免用户回退到callback页面
    }

    // 当流程失败时
    if (newStatus === "error") {
      if (loadingInstance.value) loadingInstance.value.close();
      // 使用ElMessage显示错误，也可以路由到专用的错误页面
      ElMessage.error(`登录失败: ${authStore.errorMessage}`);
      // 可选择跳转到一个公共的错误页面
      // router.replace('/login-failed');
    }
  },
  { immediate: true } // 立即执行一次，处理初始状态
);
</script>
