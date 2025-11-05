<template>
  <el-container class="test-page">
    <el-header>
      <h1>E2EE 加密模块功能测试平台 (1对1) - 改进版</h1>
      <div class="status-bar">
        <el-tag :type="connectionStatus.type">{{ connectionStatus.text }}</el-tag>
        <span class="user-info">当前环境: 本地模拟 | 用户: Alice & Bob</span>
      </div>
    </el-header>

    <el-main>
      <el-row :gutter="20">
        <!-- 控制面板 -->
        <el-col :span="10">
          <el-card>
            <template #header>
              <div class="card-header">
                <span>控制面板</span>
                <el-button @click="showDebugModal = true" size="small" type="info">调试信息</el-button>
              </div>
            </template>

            <!-- 环境管理 -->
            <div class="section">
              <h3>环境管理</h3>
              <el-button @click="initializeEnvironment" type="primary" :loading="isInitializing" style="width: 100%;">
                {{ isInitializing ? '正在初始化...' : '1. 初始化用户 & 清理环境' }}
              </el-button>
            </div>

            <el-divider />

            <!-- 1v1 聊天 -->
            <div class="section">
              <h3>1对1 聊天 (Signal Protocol)</h3>
              <el-input
                  v-model="p2pMessage"
                  placeholder="输入要发送的消息"
                  :disabled="!isEnvironmentReady"
                  @keyup.enter="sendQuickMessage"
              />
              <div class="button-group">
                <el-button
                    @click="sendMessage('alice', 'bob')"
                    :disabled="!isEnvironmentReady"
                    type="success"
                >
                  Alice → Bob
                </el-button>
                <el-button
                    @click="sendMessage('bob', 'alice')"
                    :disabled="!isEnvironmentReady"
                    type="warning"
                >
                  Bob → Alice
                </el-button>
              </div>
            </div>

            <el-divider />

            <!-- 会话状态观察 -->
            <div class="section">
              <h3>实时会话状态 (双棘轮观察)</h3>
              <div class="session-status">
                <el-scrollbar height="200px">
                  <div class="session-display">
                    <div v-if="sessionUpdates.length === 0" class="no-data">
                      暂无会话更新，请开始发送消息观察双棘轮状态
                    </div>
                    <div
                        v-for="(update, index) in sessionUpdates"
                        :key="index"
                        class="session-update"
                        :class="update.type"
                    >
                      <div class="update-header">
                        <span class="timestamp">{{ update.timestamp }}</span>
                        <span class="session-id">{{ update.sessionId }}</span>
                      </div>
                      <div class="update-content">{{ update.content }}</div>
                      <!-- 新增：棘轮状态指示器 -->
                      <div v-if="update.ratchetVisualization" class="ratchet-visualization">
                        <div class="ratchet-wheel" :class="{ rotating: update.ratchetVisualization.isRotating }">
                          ⚙️
                        </div>
                        <span class="ratchet-info">{{ update.ratchetVisualization.info }}</span>
                      </div>
                    </div>
                  </div>
                </el-scrollbar>
              </div>
            </div>

            <el-divider />

            <!-- 快捷操作 -->
            <div class="section">
              <h3>快捷测试</h3>
              <div class="quick-actions">
                <el-button @click="testContinuousMessages" size="small" :disabled="!isEnvironmentReady">
                  连续消息测试
                </el-button>
                <el-button @click="testCrossMessages" size="small" :disabled="!isEnvironmentReady">
                  交叉消息测试
                </el-button>
                <el-button @click="clearLogs" size="small">清空日志</el-button>
              </div>
            </div>
          </el-card>
        </el-col>

        <!-- 日志和状态显示 -->
        <el-col :span="14">
          <!-- 操作日志 -->
          <el-card style="margin-bottom: 20px;">
            <template #header>
              <div class="card-header">
                <span>操作日志</span>
                <div>
                  <el-tag size="small">{{ logs.length }} 条记录</el-tag>
                  <el-button @click="exportLogs" size="small" type="text">导出</el-button>
                </div>
              </div>
            </template>
            <el-scrollbar height="300px" ref="logScrollbarRef">
              <div class="logs-container">
                <div v-for="(log, index) in logs" :key="index" class="log-item" :class="log.type">
                  <div class="log-header">
                    <span class="log-time">{{ log.timestamp }}</span>
                    <span class="log-action">{{ log.action }}</span>
                  </div>
                  <div v-if="log.details" class="log-details">
                    <div v-if="log.from" class="log-meta">From: {{ log.from }} → To: {{ log.to }}</div>
                    <div v-if="log.data" class="log-data">{{ formatLogData(log.data) }}</div>
                  </div>
                </div>
              </div>
            </el-scrollbar>
          </el-card>

          <!-- 存储状态 -->
          <el-card>
            <template #header>
              <div class="card-header">
                <span>IndexedDB 存储状态</span>
                <div class="button-group">
                  <el-button @click="inspectStorage('alice')" size="small">Alice</el-button>
                  <el-button @click="inspectStorage('bob')" size="small">Bob</el-button>
                  <el-button @click="inspectAllStorage" size="small" type="info">全部</el-button>
                </div>
              </div>
            </template>
            <el-scrollbar height="250px">
              <pre class="storage-content">{{ storageContent }}</pre>
            </el-scrollbar>
          </el-card>
        </el-col>
      </el-row>
    </el-main>

    <!-- 调试模态框 -->
    <el-dialog v-model="showDebugModal" title="调试信息" width="70%">
      <el-tabs v-model="activeDebugTab">
        <el-tab-pane label="路由器状态" name="routers">
          <pre class="debug-content">{{ debugInfo.routers }}</pre>
        </el-tab-pane>
        <el-tab-pane label="会话统计" name="sessions">
          <pre class="debug-content">{{ debugInfo.sessions }}</pre>
        </el-tab-pane>
        <el-tab-pane label="性能指标" name="performance">
          <pre class="debug-content">{{ debugInfo.performance }}</pre>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, computed } from 'vue';
import type { ElScrollbar } from 'element-plus';
import { ElMessage } from 'element-plus';

// 导入服务
import { getP2PRouter, clearP2PRouters, type P2PMessageRouter } from '../modulse/signal/services/p2p-message-router';
import { uploadKeyBundleToServer } from '../modulse/signal/services/users.api.mock';
import { get, keys as idbKeys, clear as idbClear, createStore } from 'idb-keyval';
import type { SessionStateInfo } from '../modulse/signal/services/signal.store';

// 状态定义
const userIds = ['alice', 'bob'];
const routers = reactive<Record<string, P2PMessageRouter>>({});
const logs = ref<Array<{
  timestamp: string;
  action: string;
  type: 'info' | 'success' | 'error' | 'warning';
  from?: string;
  to?: string;
  data?: any;
  details?: boolean;
}>>([]);

const storageContent = ref('点击按钮查看 IndexedDB 存储状态');
const p2pMessage = ref('这是一条加密的1对1消息！');
const logScrollbarRef = ref<InstanceType<typeof ElScrollbar>>();

// 会话状态
const sessionUpdates = ref<Array<{
  timestamp: string;
  sessionId: string;
  content: string;
  type: 'new' | 'update' | 'error';
  ratchetVisualization?: {
    isRotating: boolean;
    info: string;
  };
}>>([]);

// UI 状态
const isInitializing = ref(false);
const isEnvironmentReady = ref(false);
const showDebugModal = ref(false);
const activeDebugTab = ref('routers');

// 计算属性
const connectionStatus = computed(() => {
  if (isInitializing.value) {
    return { type: 'warning', text: '初始化中...' };
  } else if (isEnvironmentReady.value) {
    return { type: 'success', text: '环境就绪' };
  } else {
    return { type: 'danger', text: '未初始化' };
  }
});

// 调试信息
const debugInfo = reactive({
  routers: '暂无数据',
  sessions: '暂无数据',
  performance: '暂无数据'
});

// 工具函数
const getTimestamp = () => new Date().toLocaleTimeString();

const addLog = (
    action: string,
    type: 'info' | 'success' | 'error' | 'warning' = 'info',
    details: any = {}
) => {
  logs.value.push({
    timestamp: getTimestamp(),
    action,
    type,
    details: !!details.data || !!details.from,
    ...details
  });

  nextTick(() => {
    if (logScrollbarRef.value) {
      logScrollbarRef.value.setScrollTop(logScrollbarRef.value.wrapRef?.scrollHeight ?? 0);
    }
  });
};

const formatLogData = (data: any): string => {
  if (!data) return '';
  const str = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
  return str.length > 200 ? str.substring(0, 200) + '...' : str;
};

// 会话状态处理
const handleSessionUpdate = (stateInfo: SessionStateInfo) => {
  const ratchetInfo = stateInfo.ratchetInfo;
  let content = '';
  let ratchetVisualization = null;

  if (stateInfo.isNew) {
    content = `🆕 新会话建立 | X3DH 密钥交换完成`;
    ratchetVisualization = {
      isRotating: true,
      info: '初始化密钥交换'
    };
  } else if (ratchetInfo) {
    const operation = ratchetInfo.operation === 'encrypt' ? '🔐 加密' : '🔓 解密';
    const ratchetStatus = ratchetInfo.isDoubleRatchetAdvanced ? '⚙️ 棘轮前进' : '📝 使用现有密钥';
    content = `${operation} | ${ratchetStatus} | 消息#${ratchetInfo.messageCount} | 会话龄${ratchetInfo.sessionAge}分钟`;

    if (ratchetInfo.isDoubleRatchetAdvanced) {
      ratchetVisualization = {
        isRotating: true,
        info: `${operation} - 棘轮推进到第${ratchetInfo.messageCount}步`
      };
    }
  } else {
    content = `🔄 会话更新 | ${stateInfo.hasPreKeyMessage ? 'PreKey消息' : '常规消息'}`;
  }

  const update = {
    timestamp: getTimestamp(),
    sessionId: `${stateInfo.metadata.userId} ↔ ${stateInfo.metadata.recipientId}`,
    content,
    type: stateInfo.isNew ? 'new' as const : 'update' as const,
    ratchetVisualization
  };

  sessionUpdates.value.push(update);

  // 保持最新50条记录
  if (sessionUpdates.value.length > 50) {
    sessionUpdates.value.shift();
  }

  addLog(`🔄 双棘轮状态`, 'info', {
    from: stateInfo.metadata.userId,
    to: stateInfo.metadata.recipientId,
    data: ratchetInfo ? `操作:${ratchetInfo.operation}, 消息数:${ratchetInfo.messageCount}, 棘轮推进:${ratchetInfo.isDoubleRatchetAdvanced}` : '基本更新'
  });
};

// 核心功能函数
async function initializeEnvironment() {
  isInitializing.value = true;
  isEnvironmentReady.value = false;

  try {
    addLog('🚀 开始环境初始化', 'info');

    // 清理现有状态
    logs.value = [];
    sessionUpdates.value = [];
    clearP2PRouters();

    // 清理 IndexedDB
    const stores = [
      createStore('e2ee-identity-store', 'identities'),
      createStore('e2ee-session-store', 'sessions'),
      createStore('e2ee-trust-store', 'trusted-keys')
    ];

    await Promise.all(stores.map(store => idbClear(store)));
    addLog('🧹 IndexedDB 清理完成', 'success');

    // 初始化用户路由器
    for (const userId of userIds) {
      routers[userId] = getP2PRouter(userId);

      // 注册会话状态回调
      routers[userId].onSessionUpdate(handleSessionUpdate);

      // 注册消息处理回调
      routers[userId].onMessage((msg, response) => {
        if (response.success) {
          addLog(`✅ ${userId} 处理消息成功: ${msg.type}`, 'success');
        } else {
          addLog(`❌ ${userId} 处理消息失败: ${response.error}`, 'error');
        }
      });

      // 初始化用户密钥
      const initResult = await routers[userId].initializeUser();
      if (initResult.success) {
        uploadKeyBundleToServer(initResult.data.publicKeyBundle);
        addLog(`✅ ${userId} 密钥初始化完成`, 'success');
      } else {
        throw new Error(`${userId} 初始化失败: ${initResult.error}`);
      }
    }

    isEnvironmentReady.value = true;
    addLog('🎉 环境初始化完成', 'success');
    ElMessage.success('环境初始化成功！');

  } catch (error) {
    addLog(`❌ 初始化失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
    ElMessage.error('环境初始化失败！');
  } finally {
    isInitializing.value = false;
  }
}

async function sendMessage(senderId: string, recipientId: string) {
  if (!isEnvironmentReady.value) return;

  const message = p2pMessage.value.trim();
  if (!message) return;

  try {
    addLog(`➡️ ${senderId} 准备发送消息给 ${recipientId}`, 'info', { from: senderId, to: recipientId });

    // 确保会话存在
    const sessionResult = await routers[senderId].ensureSessionWith(recipientId);
    if (!sessionResult.success) {
      throw new Error(sessionResult.error);
    }

    // 发送加密消息
    const encryptResult = await routers[senderId].sendEncryptedMessage(recipientId, message);
    if (!encryptResult.success) {
      throw new Error(encryptResult.error);
    }

    addLog(`🔐 ${senderId} 消息加密完成`, 'success', {
      from: senderId,
      to: recipientId,
      data: { messageType: encryptResult.data.ciphertext.type }
    });

    // 模拟网络传输延迟
    setTimeout(async () => {
      try {
        // 接收方解密消息
        const decryptResult = await routers[recipientId].receiveEncryptedMessage(
            senderId,
            encryptResult.data.ciphertext
        );

        if (decryptResult.success) {
          addLog(`✅ ${recipientId} 解密成功`, 'success', {
            from: senderId,
            to: recipientId,
            data: { plaintext: decryptResult.data.plaintext }
          });

          if (decryptResult.data.plaintext === message) {
            ElMessage.success(`消息传递成功！`);
          } else {
            throw new Error('解密内容与原文不符');
          }
        } else {
          throw new Error(decryptResult.error);
        }
      } catch (error) {
        addLog(`❌ ${recipientId} 解密失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
        ElMessage.error('消息解密失败！');
      }
    }, 100);

  } catch (error) {
    addLog(`❌ 消息发送失败: ${error instanceof Error ? error.message : String(error)}`, 'error', {
      from: senderId,
      to: recipientId
    });
    ElMessage.error('消息发送失败！');
  }
}

async function sendQuickMessage() {
  await sendMessage('alice', 'bob');
}

async function testContinuousMessages() {
  const messages = ['消息1', '消息2', '消息3', '消息4', '消息5'];

  for (let i = 0; i < messages.length; i++) {
    p2pMessage.value = messages[i];
    await sendMessage('alice', 'bob');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  ElMessage.info('连续消息测试完成');
}

async function testCrossMessages() {
  const aliceMessages = ['Alice消息1', 'Alice消息2'];
  const bobMessages = ['Bob回复1', 'Bob回复2'];

  for (let i = 0; i < 2; i++) {
    p2pMessage.value = aliceMessages[i];
    await sendMessage('alice', 'bob');
    await new Promise(resolve => setTimeout(resolve, 300));

    p2pMessage.value = bobMessages[i];
    await sendMessage('bob', 'alice');
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  ElMessage.info('交叉消息测试完成');
}

async function inspectStorage(userId: string) {
  try {
    let content = `=== ${userId.toUpperCase()} 的存储状态 ===\n\n`;

    const identityStore = createStore('e2ee-identity-store', 'identities');
    const sessionStore = createStore('e2ee-session-store', 'sessions');

    // 身份信息
    content += '--- 身份密钥 ---\n';
    const identity = await get(userId, identityStore);
    if (identity) {
      content += `用户: ${identity.userId}\n`;
      content += `身份密钥: ${identity.identityKeyPair.pubKey.substring(0, 32)}...\n`;
      content += `签名密钥: ${identity.signingKeyPair.pubKey.substring(0, 32)}...\n`;
      content += `PreKey数量: ${identity.oneTimePreKeys.length}\n\n`;
    } else {
      content += '(未初始化)\n\n';
    }

    // 会话信息
    content += '--- 会话记录 ---\n';
    const allSessionKeys = await idbKeys(sessionStore);
    const userSessions = allSessionKeys.filter(key =>
        userIds.some(id => String(key).includes(id))
    );

    if (userSessions.length > 0) {
      for (const key of userSessions) {
        const session = await get(key, sessionStore);
        if (session) {
          content += `会话: ${key}\n`;
          // 修复：检查数据类型
          if (typeof session === 'string') {
            content += `类型: 字符串\n`;
            content += `大小: ${session.length} 字符\n`;
            content += `数据: ${session.substring(0, 64)}...\n\n`;
          } else if (session instanceof ArrayBuffer) {
            content += `类型: ArrayBuffer\n`;
            content += `大小: ${session.byteLength} 字节\n`;
            content += `数据: [二进制数据]\n\n`;
          } else if (typeof session === 'object') {
            content += `类型: 对象\n`;
            content += `内容: ${JSON.stringify(session).substring(0, 100)}...\n\n`;
          } else {
            content += `类型: ${typeof session}\n`;
            content += `值: ${String(session).substring(0, 64)}...\n\n`;
          }
        }
      }
    } else {
      content += '(暂无会话)\n\n';
    }

    storageContent.value = content;

  } catch (error) {
    storageContent.value = `查询失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function inspectAllStorage() {
  let content = '=== 全部存储状态 ===\n\n';

  for (const userId of userIds) {
    await inspectStorage(userId);
    content += storageContent.value + '\n';
  }

  storageContent.value = content;
}

function clearLogs() {
  logs.value = [];
  sessionUpdates.value = [];
  ElMessage.info('日志已清空');
}

function exportLogs() {
  const logData = {
    timestamp: new Date().toISOString(),
    environment: 'E2EE Test Environment',
    logs: logs.value,
    sessionUpdates: sessionUpdates.value
  };

  const blob = new Blob([JSON.stringify(logData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `e2ee-test-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  ElMessage.success('日志已导出');
}

// 更新调试信息
const updateDebugInfo = () => {
  debugInfo.routers = JSON.stringify({
    activeRouters: Object.keys(routers),
    environmentReady: isEnvironmentReady.value,
    totalLogs: logs.value.length,
    sessionUpdates: sessionUpdates.value.length
  }, null, 2);

  debugInfo.sessions = JSON.stringify({
    recentSessions: sessionUpdates.value.slice(-10),
    userIds
  }, null, 2);

  debugInfo.performance = JSON.stringify({
    averageResponseTime: logs.value.length > 0 ? '< 100ms' : 'N/A',
    successRate: logs.value.length > 0 ? `${logs.value.filter(l => l.type === 'success').length}/${logs.value.length}` : 'N/A',
    totalMessages: logs.value.filter(l => l.action.includes('发送消息') || l.action.includes('解密')).length
  }, null, 2);
};

// 定期更新调试信息
setInterval(updateDebugInfo, 2000);
</script>

<style scoped>
.test-page {
  padding: 20px;
  background: #f5f7fa;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #e4e7ed;
}

.user-info {
  font-size: 14px;
  color: #606266;
}

.section {
  margin-bottom: 20px;
}

.section h3 {
  font-size: 16px;
  color: #303133;
  margin: 0 0 10px 0;
}

.button-group {
  margin-top: 10px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 会话状态显示 */
.session-status {
  background: #fafafa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
}

.session-display {
  padding: 10px;
}

.no-data {
  text-align: center;
  color: #909399;
  font-style: italic;
  padding: 20px;
}

.session-update {
  margin-bottom: 8px;
  padding: 8px;
  border-radius: 4px;
  font-size: 13px;
  border-left: 3px solid #e4e7ed;
}

.session-update.new {
  background: #f0f9ff;
  border-left-color: #409eff;
}

.session-update.update {
  background: #f5f7fa;
  border-left-color: #909399;
}

.session-update.error {
  background: #fef0f0;
  border-left-color: #f56c6c;
}

.update-header {
  display: flex;
  justify-content: space-between;
  font-weight: bold;
  margin-bottom: 4px;
}

.timestamp {
  color: #909399;
  font-size: 12px;
}

.session-id {
  color: #606266;
  font-size: 12px;
}

.update-content {
  color: #303133;
}

/* 日志样式 */
.logs-container {
  padding: 10px;
}

.log-item {
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 4px;
  border-left: 4px solid #e4e7ed;
  background: #fafafa;
  font-size: 14px;
}

.log-item.success {
  background: #f0f9ff;
  border-left-color: #67c23a;
}

.log-item.error {
  background: #fef0f0;
  border-left-color: #f56c6c;
}

.log-item.warning {
  background: #fdf6ec;
  border-left-color: #e6a23c;
}

.log-item.info {
  background: #f4f4f5;
  border-left-color: #909399;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
  margin-bottom: 5px;
}

.log-time {
  font-size: 12px;
  color: #909399;
  font-family: 'Courier New', monospace;
}

.log-action {
  color: #303133;
}

.log-details {
  margin-top: 8px;
}

.log-meta {
  font-size: 12px;
  color: #606266;
  margin-bottom: 4px;
}

.log-data {
  background: #f8f8f9;
  padding: 8px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 100px;
  overflow-y: auto;
}

/* 存储内容显示 */
.storage-content {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 15px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.4;
}

/* 调试内容 */
.debug-content {
  background: #f8f8f9;
  padding: 15px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #303133;
  max-height: 400px;
  overflow-y: auto;
}

/* 棘轮可视化样式 */
.ratchet-visualization {
  display: flex;
  align-items: center;
  margin-top: 8px;
  padding: 4px 8px;
  background: rgba(64, 158, 255, 0.1);
  border-radius: 4px;
  font-size: 12px;
}

.ratchet-wheel {
  margin-right: 8px;
  font-size: 16px;
  transition: transform 0.5s ease;
}

.ratchet-wheel.rotating {
  animation: rotate 1s linear;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ratchet-info {
  color: #606266;
  font-style: italic;
}
@media (max-width: 768px) {
  .el-row {
    flex-direction: column;
  }

  .button-group {
    flex-direction: column;
  }

  .quick-actions {
    flex-direction: column;
  }

  .status-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }
}
</style>