<template>
  <div class="key-test-container">
    <h1>E2EE 密钥生成测试</h1>

    <!-- 调试信息 -->
    <div class="debug-section">
      <h3>调试信息</h3>
      <button @click="checkIndexedDB" class="debug-btn">检查 IndexedDB</button>
      <button @click="clearAllData" class="debug-btn">清空所有数据</button>

      <div v-if="debugInfo" class="debug-info">
        <h4>IndexedDB 状态:</h4>
        <pre>{{ debugInfo }}</pre>
      </div>
    </div>

    <!-- 用户密钥生成区域 -->
    <div class="key-generation-section">
      <div class="user-section">
        <h2>用户 1 (user1)</h2>
        <div class="button-group">
          <button
            @click="generateKeys('101')"
            :disabled="user1KeysExist"
            class="generate-btn"
          >
            {{ user1KeysExist ? "✓ 密钥已生成" : "生成密钥" }}
          </button>
          <button
            @click="showKeys('101')"
            :disabled="!user1KeysExist"
            class="show-btn"
          >
            查看密钥
          </button>
          <button @click="checkUserKeys('101')" class="check-btn">
            检查状态
          </button>
        </div>
        <div v-if="user1Status" class="user-status">
          {{ user1Status }}
        </div>
      </div>

      <div class="user-section">
        <h2>用户 2 (user2)</h2>
        <div class="button-group">
          <button
            @click="generateKeys('102')"
            :disabled="user2KeysExist"
            class="generate-btn"
          >
            {{ user2KeysExist ? "✓ 密钥已生成" : "生成密钥" }}
          </button>
          <button
            @click="showKeys('102')"
            :disabled="!user2KeysExist"
            class="show-btn"
          >
            查看密钥
          </button>
          <button @click="checkUserKeys('102')" class="check-btn">
            检查状态
          </button>
        </div>
        <div v-if="user2Status" class="user-status">
          {{ user2Status }}
        </div>
      </div>
    </div>

    <!-- 密钥展示区域 -->
    <div v-if="displayedKeys" class="key-display-section">
      <h3>{{ displayedUser }} 的密钥信息</h3>

      <div class="key-info">
        <div class="key-item">
          <label>用户ID:</label>
          <span>{{ displayedKeys.userId }}</span>
        </div>

        <div class="key-item">
          <label>身份公钥:</label>
          <div class="key-value">
            {{ formatKey(displayedKeys.identityKey) }}
          </div>
        </div>

        <div class="key-item">
          <label>签名公钥:</label>
          <div class="key-value">
            {{ formatKey(displayedKeys.signingPubKey) }}
          </div>
        </div>

        <div v-if="displayedKeys.signedPreKey" class="key-item">
          <label>签名预密钥:</label>
          <div class="key-details">
            <div>
              <strong>密钥ID:</strong> {{ displayedKeys.signedPreKey.keyId }}
            </div>
            <div>
              <strong>公钥:</strong>
              {{ formatKey(displayedKeys.signedPreKey.publicKey) }}
            </div>
            <div>
              <strong>签名:</strong>
              {{ formatKey(displayedKeys.signedPreKey.signature) }}
            </div>
          </div>
        </div>

        <div v-if="displayedKeys.preKey" class="key-item">
          <label>一次性预密钥:</label>
          <div class="key-details">
            <div><strong>密钥ID:</strong> {{ displayedKeys.preKey.keyId }}</div>
            <div>
              <strong>公钥:</strong>
              {{ formatKey(displayedKeys.preKey.publicKey) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作日志 -->
    <div class="logs-section">
      <h3>操作日志</h3>
      <div class="logs">
        <div v-for="(log, index) in logs" :key="index" class="log-entry">
          [{{ log.time }}] {{ log.message }}
        </div>
      </div>
      <button @click="clearLogs" class="clear-btn">清空日志</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { e2eeService } from "../modulse/signal/services/e2ee.service";

// 响应式状态
const user1KeysExist = ref(false);
const user2KeysExist = ref(false);
const user1Status = ref("");
const user2Status = ref("");
const displayedKeys = ref(null);
const displayedUser = ref("");
const logs = ref([]);
const debugInfo = ref("");

// 初始化检查
onMounted(async () => {
  addLog("页面初始化完成");
  await checkExistingKeys();
});

// 方法
async function checkExistingKeys() {
  try {
    user1KeysExist.value = await e2eeService.keysExistForUser("101");
    user2KeysExist.value = await e2eeService.keysExistForUser("102");

    if (user1KeysExist.value) addLog("用户1密钥已存在");
    if (user2KeysExist.value) addLog("用户2密钥已存在");

    user1Status.value = user1KeysExist.value ? "密钥存在" : "未生成密钥";
    user2Status.value = user2KeysExist.value ? "密钥存在" : "未生成密钥";
  } catch (error) {
    addLog(`检查密钥失败: ${error.message}`);
  }
}

async function generateKeys(userId) {
  try {
    addLog(`正在为${userId}生成密钥...`);

    // 重置状态
    if (userId === "101") {
      user1Status.value = "生成中...";
    } else {
      user2Status.value = "生成中...";
    }

    const publicKeys = await e2eeService.initializeKeysForUser(userId);

    if (userId === "101") {
      user1KeysExist.value = true;
      user1Status.value = "密钥生成成功";
    } else {
      user2KeysExist.value = true;
      user2Status.value = "密钥生成成功";
    }

    addLog(`${userId}密钥生成成功`);

    // 自动显示生成的密钥
    displayedKeys.value = publicKeys;
    displayedUser.value = userId;

    // 重新检查状态
    await checkExistingKeys();
  } catch (error) {
    const errorMsg = `${userId}密钥生成失败: ${error.message}`;
    addLog(errorMsg);
    if (userId === "user1") {
      user1Status.value = errorMsg;
    } else {
      user2Status.value = errorMsg;
    }
  }
}

async function showKeys(userId) {
  try {
    addLog(`正在获取${userId}的完整密钥信息...`);

    // 重新生成密钥包来获取完整信息（因为getUserPublicKeys只返回部分）
    const publicKeys = await e2eeService.initializeKeysForUser(userId);

    displayedKeys.value = publicKeys;
    displayedUser.value = userId;
    addLog(`已显示${userId}的完整密钥信息`);
  } catch (error) {
    addLog(`获取${userId}密钥失败: ${error.message}`);
  }
}

async function checkUserKeys(userId) {
  try {
    addLog(`检查${userId}密钥状态...`);
    const exists = await e2eeService.keysExistForUser(userId);

    if (userId === "101") {
      user1KeysExist.value = exists;
      user1Status.value = exists ? "密钥存在" : "密钥不存在";
    } else {
      user2KeysExist.value = exists;
      user2Status.value = exists ? "密钥存在" : "密钥不存在";
    }

    addLog(`${userId}密钥状态: ${exists ? "存在" : "不存在"}`);
  } catch (error) {
    addLog(`检查${userId}密钥状态失败: ${error.message}`);
  }
}

async function checkIndexedDB() {
  try {
    addLog("正在检查 IndexedDB 状态...");

    // 检查数据库是否存在
    const databases = await window.indexedDB.databases();
    const e2eeDb = databases.find((db) => db.name === "e2ee-identity-store");

    if (!e2eeDb) {
      debugInfo.value = "未找到 e2ee-identity-store 数据库";
      addLog("未找到 E2EE 数据库");
      return;
    }

    debugInfo.value = `数据库信息:
名称: ${e2eeDb.name}
版本: ${e2eeDb.version}
对象存储: identities, sessions, trusted-keys`;

    addLog("IndexedDB 检查完成");
  } catch (error) {
    debugInfo.value = `检查 IndexedDB 失败: ${error.message}`;
    addLog(`IndexedDB 检查失败: ${error.message}`);
  }
}

async function clearAllData() {
  try {
    addLog("正在清空所有 E2EE 数据...");

    // 这里需要根据你的实际实现来清空数据
    // 可能需要调用 e2eeService 中的清理方法

    user1KeysExist.value = false;
    user2KeysExist.value = false;
    user1Status.value = "数据已清空";
    user2Status.value = "数据已清空";
    displayedKeys.value = null;

    addLog("所有 E2EE 数据已清空");
  } catch (error) {
    addLog(`清空数据失败: ${error.message}`);
  }
}

function formatKey(key) {
  if (!key) return "N/A";
  if (key.length > 50) {
    return key.substring(0, 50) + "...";
  }
  return key;
}

function addLog(message) {
  const time = new Date().toLocaleTimeString();
  logs.value.unshift({
    time,
    message,
  });

  // 限制日志数量
  if (logs.value.length > 20) {
    logs.value = logs.value.slice(0, 20);
  }
}

function clearLogs() {
  logs.value = [];
  addLog("日志已清空");
}
</script>

<style scoped>
.key-test-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

h1 {
  text-align: center;
  color: #333;
  margin-bottom: 30px;
}

.debug-section {
  margin-bottom: 30px;
  padding: 15px;
  border: 1px solid #ff9800;
  border-radius: 8px;
  background: #fff3e0;
}

.debug-section h3 {
  margin-top: 0;
  color: #e65100;
}

.debug-btn {
  padding: 8px 15px;
  margin-right: 10px;
  background: #ff9800;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.debug-info {
  margin-top: 15px;
  padding: 10px;
  background: white;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.key-generation-section {
  display: flex;
  justify-content: space-around;
  margin-bottom: 30px;
  gap: 20px;
}

.user-section {
  flex: 1;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #f9f9f9;
}

.user-section h2 {
  margin-top: 0;
  color: #555;
  text-align: center;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 15px;
}

.generate-btn,
.show-btn,
.check-btn {
  padding: 10px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.generate-btn {
  background: #4caf50;
  color: white;
}

.generate-btn:disabled {
  background: #81c784;
  cursor: not-allowed;
}

.show-btn {
  background: #2196f3;
  color: white;
}

.show-btn:disabled {
  background: #90caf9;
  cursor: not-allowed;
}

.check-btn {
  background: #9c27b0;
  color: white;
}

.user-status {
  padding: 8px;
  background: white;
  border-radius: 4px;
  text-align: center;
  font-weight: bold;
}

.key-display-section {
  margin: 20px 0;
  padding: 20px;
  border: 1px solid #4caf50;
  border-radius: 8px;
  background: #e8f5e8;
}

.key-display-section h3 {
  margin-top: 0;
  color: #2e7d32;
}

.key-info {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.key-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.key-item label {
  font-weight: bold;
  color: #555;
}

.key-value {
  background: white;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #ccc;
  word-break: break-all;
  font-family: monospace;
  font-size: 12px;
}

.key-details {
  background: white;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #ccc;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
}

.logs-section {
  margin: 20px 0;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #f9f9f9;
}

.logs-section h3 {
  margin-top: 0;
}

.logs {
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 10px;
  padding: 10px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.log-entry {
  margin: 5px 0;
  padding: 3px 0;
  border-bottom: 1px solid #eee;
}

.clear-btn {
  padding: 8px 15px;
  background: #ff9800;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .key-generation-section {
    flex-direction: column;
  }
}
</style>
