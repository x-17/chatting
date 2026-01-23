<template>
    <div class="login-container">
        <div class="login-wrapper">
            <!-- 错误提示 -->
            <div v-if="errorAlert.show" class="error-alert">
                <el-alert :type="errorAlert.type" :title="errorAlert.title" :description="errorAlert.description"
                    show-icon :closable="true" @close="dismissError" />
            </div>

            <!-- 登录/注册卡片 -->
            <el-card class="login-card" :class="{ loading: isLoading }">
                <template #header>
                    <div class="card-header">
                        <div class="logo-section">
                            <div class="logo-icon">🔐</div>
                            <span class="system-title">安全磋商系统</span>
                        </div>
                        <div class="subtitle">端到端加密通信平台 - 账号登录</div>
                    </div>
                </template>

                <div class="login-content">
                    <!-- 登录/注册表单 -->
                    <el-form ref="formRef" :model="formData" :rules="rules" label-position="top"
                        @submit.prevent="handleSubmit">
                        <el-form-item label="用户名" prop="username">
                            <el-input v-model="formData.username" placeholder="请输入用户名" :prefix-icon="User" />
                        </el-form-item>

                        <el-form-item label="密码" prop="openId">
                            <el-input v-model="formData.openId" type="password" placeholder="请输入密码" :prefix-icon="Lock"
                                show-password />
                        </el-form-item>

                        <!-- 登录按钮 -->
                        <div class="login-actions">
                            <el-button type="primary" size="large" native-type="submit" :loading="isLoading"
                                class="login-button">
                                {{ isLoginMode ? "登录" : "注册" }}
                            </el-button>
                        </div>

                        <div class="toggle-mode">
                            <el-link type="primary" @click="toggleMode">
                                {{ isLoginMode ? "没有账号？点击注册" : "已有账号？点击登录" }}
                            </el-link>
                        </div>
                    </el-form>
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
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../services/auth.store";
import { User, Lock } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";

const router = useRouter();
const authStore = useAuthStore();

const isLoginMode = ref(true);
const isLoading = ref(false);
const formRef = ref<FormInstance>();

const formData = reactive({
    username: "",
    openId: "",
});

const rules = reactive<FormRules>({
    username: [
        { required: true, message: "请输入用户名", trigger: "blur" },
        { min: 3, max: 20, message: "长度在 3 到 20 个字符", trigger: "blur" },
    ],
    openId: [
        { required: true, message: "请输入密码", trigger: "blur" },
        { min: 6, message: "密码长度不能少于 6 个字符", trigger: "blur" },
    ],
});

const errorAlert = ref({
    show: false,
    type: "error" as "error" | "warning" | "info",
    title: "",
    description: "",
});

const toggleMode = () => {
    isLoginMode.value = !isLoginMode.value;
    formData.username = "";
    formData.openId = "";
    dismissError();
};

const dismissError = () => {
    errorAlert.value.show = false;
};

const showError = (title: string, description: string) => {
    errorAlert.value = {
        show: true,
        type: "error",
        title,
        description,
    };
};

const handleSubmit = async () => {
    if (!formRef.value) return;

    await formRef.value.validate(async (valid) => {
        if (valid) {
            isLoading.value = true;
            dismissError();

            try {
                let success = false;
                if (isLoginMode.value) {
                    success = await authStore.loginWithPassword(formData);
                } else {
                    success = await authStore.registerWithPassword(formData);
                }

                if (success) {
                    router.push("/chat");
                }
            } catch (error: any) {
                // Error handling is mostly done in store/view logic, but just in case
            } finally {
                isLoading.value = false;
                if (authStore.status === "error") {
                    showError(isLoginMode.value ? "登录失败" : "注册失败", authStore.errorMessage);
                }
            }
        }
    });
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
    max-width: 450px;
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

.login-actions {
    margin-top: 20px;
}

.login-button {
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

.toggle-mode {
    text-align: center;
    margin-top: 10px;
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
}
</style>
