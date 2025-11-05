<template>
  <div class="simulator-container">
    <el-card class="simulator-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>🔧 本地 SSO 模拟器（仅开发环境可见）</span>
        </div>
      </template>

      <div class="tips">
        <p>点击按钮将自动生成 <code>code</code> 与 <code>state</code> 并跳转到
          <code>/auth/callback</code>，</p>
        <p>从而触发完整的「授权成功」流程，无需真实 SSO 平台。</p>
      </div>

      <el-form label-width="100px" class="form">
        <el-form-item label="用户身份">
          <el-radio-group v-model="mockUserType">
            <el-radio label="existing">已注册用户</el-radio>
            <el-radio label="new">新用户（触发密钥初始化）</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="Code">
          <el-input v-model="mockCode" placeholder="随机生成可修改" />
        </el-form-item>

        <el-form-item label="State">
          <el-input v-model="mockState" placeholder="随机生成可修改" />
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button type="primary" size="large" @click="simulateSuccess">
          模拟授权成功
        </el-button>

        <el-button type="warning" size="large" @click="simulateError">
          模拟授权失败
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

/* 表单数据 */
const mockUserType = ref<'existing' | 'new'>('existing');
const mockCode = ref('');
const mockState = ref('');

/* 生成安全随机串 */
const secureRand = (len = 16): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

/* 初始化默认值 */
onMounted(() => {
  mockCode.value = secureRand(12);
  mockState.value = secureRand(16);
  // 把 state 存起来，供 callback 页面校验
  sessionStorage.setItem('sso_state', mockState.value);
});

/* 模拟成功：跳转 callback */
const simulateSuccess = () => {
  sessionStorage.setItem('sso_state', mockState.value); // 同步 state
  const redirectUri = `${window.location.origin}/auth/callback`;
  const url = `${redirectUri}?code=${mockCode.value}&state=${mockState.value}${
      mockUserType.value === 'new' ? '&userType=new' : ''
  }`;
  window.location.href = url;
};

/* 模拟失败：跳转 callback 并带上 error */
const simulateError = () => {
  const redirectUri = `${window.location.origin}/auth/callback`;
  const url = `${redirectUri}?error=access_denied&error_description=用户拒绝了授权`;
  window.location.href = url;
};
</script>

<style scoped>
.simulator-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}
.simulator-card {
  width: 560px;
  padding: 24px;
}
.tips {
  margin-bottom: 20px;
  line-height: 1.6;
  color: #606266;
}
.tips code {
  background: #ecf0f1;
  padding: 2px 4px;
  border-radius: 4px;
}
.form {
  margin-top: 10px;
}
.actions {
  display: flex;
  justify-content: space-around;
  margin-top: 30px;
}
</style>