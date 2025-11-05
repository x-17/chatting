<template>
  <div class="main-container">
    <h1>完整群聊 E2EE 测试 - 包含成员管理</h1>
    <p>修复了新成员加入后的密钥同步问题，并添加了成员移除功能。</p>

    <fieldset class="global-controls">
      <legend>全局控制台</legend>
      <div class="control-buttons">
        <button @click="initializeSimulation" class="btn-init">
          ① 重置环境
        </button>
        <button @click="automateSetup" :disabled="isSetupComplete || setupInProgress" class="btn-setup">
          ② 创建群组
        </button>
        <button @click="showDebugInfo" class="btn-debug">
          🔍 调试信息
        </button>
      </div>
      <div class="network-log-container">
        <h3>网络活动日志</h3>
        <div class="network-log" ref="networkLogRef">
          <div v-for="(entry, i) in networkLog" :key="i" :class="['log-entry', entry.type]">
            <span class="timestamp">{{ entry.timestamp }}</span>
            {{ entry.message }}
          </div>
        </div>
        <button @click="clearNetworkLog" class="btn-clear-log">清空日志</button>
      </div>
    </fieldset>

    <div class="panels-container">
      <div v-for="user in users" :key="user.id" class="user-panel">
        <fieldset>
          <legend><h2>{{ user.name }}</h2></legend>

          <div class="user-status">
            <span :class="['status-badge', isReadyToChat(user.id) ? 'ready' : 'not-ready']">
              {{ isReadyToChat(user.id) ? '✓ 可聊天' : '✗ 未就绪' }}
            </span>
            <span v-if="groupInfo[user.id]?.isAdmin" class="admin-badge">管理员</span>
          </div>

          <div class="controls">
            <input
                type="text"
                v-model="messageInputs[user.id]"
                @keypress.enter="sendMessage(user.id)"
                placeholder="输入消息..."
                :disabled="!isReadyToChat(user.id)"
                class="message-input"
            />
            <button @click="sendMessage(user.id)" :disabled="!isReadyToChat(user.id)" class="btn-send">发送</button>
          </div>

          <!-- 管理员控制面板 -->
          <fieldset v-if="groupInfo[user.id]?.isAdmin" class="admin-controls">
            <legend>👑 管理员操作</legend>

            <!-- 添加成员 -->
            <div class="control-group">
              <input
                  type="text"
                  v-model="newUserIds[user.id]"
                  placeholder="新成员ID (如: dave, eve)"
                  class="member-input"
              />
              <button @click="addMemberUI(user.id)" class="btn-add" :disabled="!newUserIds[user.id]?.trim()">
                ➕ 添加成员
              </button>
            </div>

            <!-- 移除成员 -->
            <div class="control-group" v-if="getRemovableMembers(user.id).length > 0">
              <select v-model="memberToRemove[user.id]" class="member-select">
                <option disabled value="">选择要移除的成员</option>
                <option v-for="member in getRemovableMembers(user.id)" :key="member" :value="member">
                  {{ member }}
                </option>
              </select>
              <button @click="removeMemberUI(user.id)" class="btn-remove" :disabled="!memberToRemove[user.id]">
                🚫 移除成员
              </button>
            </div>

            <!-- 重新分发密钥 -->
            <div class="control-group">
              <button @click="redistributeKeys(user.id)" class="btn-rekey">
                🔄 重新分发所有密钥
              </button>
            </div>
          </fieldset>

          <div class="user-displays">
            <!-- 聊天记录 -->
            <div class="display-section">
              <h3>💬 聊天记录</h3>
              <div class="chat-log" :ref="el => chatLogRefs[user.id] = el">
                <div v-for="(msg, i) in chatLogs[user.id]" :key="i" :class="['log-entry', msg.type]">
                  <span class="msg-time">{{ msg.timestamp }}</span>
                  <span class="msg-content">{{ msg.text }}</span>
                </div>
              </div>
            </div>

            <!-- 群组信息 -->
            <div class="display-section">
              <h3>👥 群组状态</h3>
              <div class="info-display">
                <div v-if="groupInfo[user.id]">
                  <div><strong>群组ID:</strong> {{ groupInfo[user.id].groupId }}</div>
                  <div><strong>成员:</strong> {{ groupInfo[user.id].members.join(', ') }}</div>
                  <div><strong>管理员:</strong> {{ groupInfo[user.id].isAdmin ? '是' : '否' }}</div>
                  <div><strong>成员总数:</strong> {{ groupInfo[user.id].members.length }}</div>
                </div>
                <div v-else class="no-data">未加入群组</div>
              </div>
            </div>

            <!-- 密钥状态 -->
            <div class="display-section">
              <h3>🔐 密钥状态</h3>
              <div class="key-display">
                <div v-if="keyStates[user.id] && keyStates[user.id] !== '{}'">
                  <div v-for="(keyInfo, memberId) in JSON.parse(keyStates[user.id])" :key="memberId" class="key-info">
                    <div class="member-name">{{ memberId }}:</div>
                    <div v-if="keyInfo" class="key-details">
                      <span :class="['key-status', keyInfo.hasPrivateKey ? 'has-private' : 'no-private']">
                        {{ keyInfo.hasPrivateKey ? '🔑 发送密钥' : '👁️ 接收密钥' }}
                      </span>
                      <span class="key-iter">迭代: {{ keyInfo.chainIteration }}</span>
                      <span class="msg-keys">缓存: {{ keyInfo.messageKeysCached }}</span>
                    </div>
                    <div v-else class="no-key">❌ 无密钥</div>
                  </div>
                </div>
                <div v-else class="no-data">无密钥数据</div>
              </div>
            </div>
          </div>
        </fieldset>
      </div>
    </div>

    <!-- 调试模态框 -->
    <div v-if="showDebugModal" class="debug-modal" @click="closeDebugModal">
      <div class="debug-content" @click.stop>
        <h3>🐛 调试信息</h3>
        <button @click="closeDebugModal" class="close-btn">✕</button>
        <pre class="debug-text">{{ debugInfo }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, nextTick, computed } from 'vue';
import { clear } from 'idb-keyval';
import { MessageRouter } from '../modulse/groupchat/services/message-router';
import { mockMessageSender } from '../modulse/groupchat/services/mock-message-sender';
import { groupStateStore } from '../modulse/groupchat/store/group-state-store';
import { groupE2eeService } from '../modulse/groupchat/services/group-e2ee-service';

// 状态定义
const users = ref([
  { id: 'alice', name: 'Alice (管理员)' },
  { id: 'bob', name: 'Bob' },
  { id: 'carol', name: 'Carol' },
]);

const groupId = ref(`e2ee-test-group-${Math.floor(Math.random() * 1000)}`);
const routers = reactive({});
const messageInputs = reactive({});
const chatLogs = reactive({});
const networkLog = ref([]);
const keyStates = reactive({});
const groupInfo = reactive({});
const newUserIds = reactive({});
const memberToRemove = reactive({});
const isSetupComplete = ref(false);
const setupInProgress = ref(false);
const showDebugModal = ref(false);
const debugInfo = ref('');

const networkLogRef = ref(null);
const chatLogRefs = reactive({});
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// 增强的消息发送器
class EnhancedMockSender {
  constructor(originalSender) {
    this.originalSender = originalSender;
  }

  async sendToUser(userId, message) {
    await this.originalSender.sendToUser(userId, message);
    await this.handleSentMessage('user', userId, message);
  }

  async sendToGroup(groupId, message, senderId = 'system') {
    await this.originalSender.sendToGroup(groupId, message);
    await this.handleSentMessage('group', groupId, message, senderId);
  }

  async handleSentMessage(type, target, message, senderId = 'system') {
    logToNetwork(`📤 ${senderId} → ${target} (${type}): ${message.type}`, 'network');

    const recipients = type === 'user' ? [target] : users.value.map(u => u.id);

    for (const userId of recipients) {
      // 避免自己给自己发消息
      if (type === 'group' && userId === senderId) {
        continue;
      }

      if (routers[userId]) {
        try {
          const response = await routers[userId].handleMessage(message);
          if (response.success) {
            handleMessageResponse(userId, message, response);
          } else {
            logToChat(userId, `❌ 处理消息失败: ${response.error}`, 'error');
          }
        } catch (error) {
          logToChat(userId, `💥 消息处理异常: ${error.message}`, 'error');
        }
      }
    }

    await updateAllPanels();
  }

  clearMessages() { return this.originalSender.clearMessages(); }
  getAllMessages() { return this.originalSender.getAllMessages(); }
}

const enhancedSender = new EnhancedMockSender(mockMessageSender);

// 计算属性
const getRemovableMembers = (adminId) => {
  const info = groupInfo[adminId];
  if (!info || !info.isAdmin) return [];
  return info.members.filter(m => m !== adminId);
};

// 辅助函数
const getTimestamp = () => {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
};

const logToChat = (userId, text, type = 'info') => {
  if (!chatLogs[userId]) chatLogs[userId] = [];
  chatLogs[userId].push({
    text,
    type,
    timestamp: getTimestamp()
  });
  nextTick(() => {
    const el = chatLogRefs[userId];
    if (el) el.scrollTop = el.scrollHeight;
  });
};

const logToNetwork = (message, type = 'info') => {
  networkLog.value.push({
    message,
    type,
    timestamp: getTimestamp()
  });
  nextTick(() => {
    if (networkLogRef.value) networkLogRef.value.scrollTop = networkLogRef.value.scrollHeight;
  });
};

const resetState = () => {
  users.value.forEach(user => {
    messageInputs[user.id] = '';
    chatLogs[user.id] = [];
    keyStates[user.id] = '{}';
    groupInfo[user.id] = null;
    newUserIds[user.id] = '';
    memberToRemove[user.id] = '';
  });
  networkLog.value = [];
  isSetupComplete.value = false;
  setupInProgress.value = false;
};

const isReadyToChat = (userId) => {
  try {
    const keyData = JSON.parse(keyStates[userId] || '{}');
    return isSetupComplete.value && keyData[userId]?.hasPrivateKey;
  } catch {
    return false;
  }
};

// 处理消息响应
const handleMessageResponse = (userId, message, response) => {
  switch (message.type) {
    case 'ENCRYPTED_MESSAGE':
      if (response.data?.decrypted) {
        const decryptedText = textDecoder.decode(response.data.decrypted);
        logToChat(userId, `${response.data.senderId}: ${decryptedText}`, 'received');
      }
      break;
    case 'KEY_DISTRIBUTION':
      logToChat(userId, `🔑 收到 ${response.data?.senderId} 的密钥`, 'system');
      break;
    case 'MEMBER_JOINED':
      logToChat(userId, `👋 ${response.data?.memberId} 加入群组`, 'system');
      break;
    case 'MEMBER_REMOVED':
      logToChat(userId, `👋 ${response.data?.memberId} 离开群组`, 'system');
      break;
  }
};

// 核心功能函数
async function initializeSimulation() {
  logToNetwork('🔄 开始重置模拟环境...', 'system');

  try {
    await clear();
    logToNetwork('✅ IndexedDB 已清空', 'success');
  } catch (error) {
    logToNetwork(`❌ IndexedDB 清空失败: ${error.message}`, 'error');
    return;
  }

  resetState();
  groupId.value = `e2ee-test-group-${Math.floor(Math.random() * 1000)}`;

  // 初始化路由器
  users.value.forEach(user => {
    routers[user.id] = new MessageRouter(user.id);
    logToChat(user.id, '🔄 环境已重置，等待群组创建...', 'system');
  });

  logToNetwork('✅ 所有用户路由器已初始化', 'success');
}

async function automateSetup() {
  if (isSetupComplete.value || setupInProgress.value) return;

  setupInProgress.value = true;
  logToNetwork('🚀 开始创建群组...', 'system');

  const adminId = 'alice';
  const initialMembers = ['bob', 'carol'];

  try {
    // 1. 创建群组
    logToChat(adminId, '🏗️ 正在创建群组...', 'sent');
    const createResponse = await routers[adminId].handleMessage({
      type: 'CREATE_GROUP',
      payload: { groupId: groupId.value, initialMembers }
    });

    if (!createResponse.success) {
      throw new Error(`创建群组失败: ${createResponse.error}`);
    }

    logToNetwork('✅ 群组创建成功', 'success');

    // 2. 等待群组创建完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. 【关键修复】确保正确的会话初始化顺序
    // 先让管理员创建并分发密钥
    logToNetwork('🔑 管理员创建初始密钥...', 'system');
    await createAndDistributeSession(adminId);
    await new Promise(resolve => setTimeout(resolve, 800)); // 等待分发完成

    // 然后让其他初始成员创建并分发密钥
    for (const memberId of initialMembers) {
      logToNetwork(`🔑 ${memberId} 创建密钥...`, 'system');
      await createAndDistributeSession(memberId);
      await new Promise(resolve => setTimeout(resolve, 600)); // 避免并发冲突
    }

    // 4. 再次等待确保所有密钥分发完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    isSetupComplete.value = true;
    logToNetwork('🎉 群组设置完成！', 'success');

  } catch (error) {
    logToNetwork(`❌ 设置失败: ${error.message}`, 'error');
  } finally {
    setupInProgress.value = false;
    await updateAllPanels();
  }
}

// 【修复】创建并分发会话的函数 - 增加重试机制
async function createAndDistributeSession(userId, retryCount = 0) {
  const maxRetries = 3;

  try {
    logToChat(userId, '🔑 创建发送者会话...', 'sent');

    const sessionResponse = await routers[userId].handleMessage({
      type: 'CREATE_SENDER_SESSION',
      payload: { groupId: groupId.value }
    });

    if (sessionResponse.success) {
      // 向群组分发密钥
      await enhancedSender.sendToGroup(groupId.value, {
        type: 'KEY_DISTRIBUTION',
        payload: sessionResponse.data
      }, userId);

      logToChat(userId, '✅ 会话创建并分发完成', 'success');
      logToNetwork(`✅ ${userId} 密钥分发完成`, 'success');
    } else {
      throw new Error(sessionResponse.error);
    }
  } catch (error) {
    if (retryCount < maxRetries) {
      logToNetwork(`⚠️ ${userId} 密钥创建失败，重试中... (${retryCount + 1}/${maxRetries})`, 'warning');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return await createAndDistributeSession(userId, retryCount + 1);
    } else {
      logToChat(userId, `❌ 会话创建失败: ${error.message}`, 'error');
      logToNetwork(`❌ ${userId} 密钥创建最终失败: ${error.message}`, 'error');
      throw error;
    }
  }
}

async function sendMessage(senderId) {
  const text = messageInputs[senderId]?.trim();
  if (!text) return;

  logToChat(senderId, `You: ${text}`, 'sent');
  messageInputs[senderId] = '';

  try {
    const plaintext = textEncoder.encode(text);
    const encryptResponse = await routers[senderId].encryptMessage(groupId.value, plaintext);

    if (encryptResponse.success) {
      await enhancedSender.sendToGroup(groupId.value, {
        type: 'ENCRYPTED_MESSAGE',
        payload: encryptResponse.data
      }, senderId);
    } else {
      logToChat(senderId, `❌ 加密失败: ${encryptResponse.error}`, 'error');
    }
  } catch (error) {
    logToChat(senderId, `💥 发送失败: ${error.message}`, 'error');
  }
}

// 【修复】添加成员逻辑 - 完全自动化密钥分发
async function addMemberUI(adminId) {
  const newMemberId = newUserIds[adminId]?.trim();
  if (!newMemberId) return;

  // 检查是否已是成员
  if (groupInfo[adminId]?.members.includes(newMemberId)) {
    logToChat(adminId, `⚠️ ${newMemberId} 已经是群成员`, 'error');
    newUserIds[adminId] = '';
    return;
  }

  // 添加到用户列表（如果不存在）
  if (!users.value.find(u => u.id === newMemberId)) {
    users.value.push({
      id: newMemberId,
      name: newMemberId.charAt(0).toUpperCase() + newMemberId.slice(1)
    });
    routers[newMemberId] = new MessageRouter(newMemberId);

    // 初始化状态
    messageInputs[newMemberId] = '';
    chatLogs[newMemberId] = [];
    keyStates[newMemberId] = '{}';
    groupInfo[newMemberId] = null;
    newUserIds[newMemberId] = '';
    memberToRemove[newMemberId] = '';

    logToChat(newMemberId, '🎉 欢迎加入模拟环境！', 'system');
  }

  logToChat(adminId, `➕ 正在添加成员 ${newMemberId}...`, 'sent');
  logToNetwork(`🔄 开始完整的成员添加流程: ${newMemberId}`, 'system');

  try {
    // === 阶段1: 添加成员到群组 ===
    const response = await routers[adminId].handleMessage({
      type: 'ADD_MEMBER',
      payload: { groupId: groupId.value, newMemberId }
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    logToNetwork(`✅ ${newMemberId} 已添加到群组`, 'success');
    await new Promise(resolve => setTimeout(resolve, 500));

    // === 阶段2: 获取当前成员列表 ===
    await updateAllPanels();
    const allMembers = groupInfo[adminId]?.members || [];
    const existingMembers = allMembers.filter(m => m !== newMemberId);

    logToNetwork(`当前群组成员: ${allMembers.join(', ')}`, 'system');

    // === 阶段3: 清理并重建所有密钥会话（完全重置） ===
    logToNetwork(`🔄 清理现有密钥状态...`, 'system');

    // 清理所有成员的所有密钥状态
    for (const userId of allMembers) {
      for (const otherId of allMembers) {
        try {
          await groupStateStore.remove(userId, groupId.value, otherId);
        } catch (error) {
          // 忽略清理错误
        }
      }
    }

    logToNetwork(`🔑 为所有成员重新创建密钥会话...`, 'system');

    // === 阶段4: 为所有成员（包括新成员）重新创建会话 ===
    for (const memberId of allMembers) {
      if (routers[memberId]) {
        try {
          logToNetwork(`🔑 ${memberId} 创建新会话`, 'system');

          // 创建新会话
          const sessionResponse = await routers[memberId].handleMessage({
            type: 'CREATE_SENDER_SESSION',
            payload: { groupId: groupId.value }
          });

          if (sessionResponse.success) {
            // 向群组分发密钥
            await enhancedSender.sendToGroup(groupId.value, {
              type: 'KEY_DISTRIBUTION',
              payload: sessionResponse.data
            }, memberId);

            logToNetwork(`✅ ${memberId} 密钥分发完成`, 'success');
          } else {
            throw new Error(`${memberId} 会话创建失败: ${sessionResponse.error}`);
          }

          // 避免并发冲突
          await new Promise(resolve => setTimeout(resolve, 400));

        } catch (error) {
          logToNetwork(`❌ ${memberId} 密钥创建失败: ${error.message}`, 'error');
        }
      }
    }

    // === 阶段5: 等待所有密钥分发完成 ===
    logToNetwork(`⏳ 等待密钥分发完成...`, 'system');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // === 阶段6: 验证结果 ===
    await updateAllPanels();

    // 检查所有成员是否都有有效的密钥状态
    let allReady = true;
    for (const memberId of allMembers) {
      try {
        const keyData = JSON.parse(keyStates[memberId] || '{}');
        const hasOwnKey = keyData[memberId]?.hasPrivateKey;
        const hasOthersKeys = allMembers.filter(m => m !== memberId).every(m => keyData[m] !== null);

        if (!hasOwnKey || !hasOthersKeys) {
          allReady = false;
          logToNetwork(`⚠️ ${memberId} 密钥状态不完整`, 'warning');
        }
      } catch (error) {
        allReady = false;
        logToNetwork(`⚠️ ${memberId} 密钥状态检查失败`, 'warning');
      }
    }

    if (allReady) {
      logToChat(adminId, `✅ 成员 ${newMemberId} 加入完成，所有密钥已同步`, 'success');
      logToNetwork(`🎉 ${newMemberId} 完整加入流程成功完成`, 'success');
    } else {
      logToChat(adminId, `⚠️ 成员 ${newMemberId} 已加入，但部分密钥可能需要重新同步`, 'warning');
      logToNetwork(`⚠️ ${newMemberId} 加入完成，但存在密钥同步问题`, 'warning');
    }

  } catch (error) {
    logToChat(adminId, `❌ 添加成员失败: ${error.message}`, 'error');
    logToNetwork(`❌ 添加 ${newMemberId} 失败: ${error.message}`, 'error');
  }

  newUserIds[adminId] = '';
  await updateAllPanels();
}

// 【修复】移除成员逻辑 - 完全重新密钥化
async function removeMemberUI(adminId) {
  const memberId = memberToRemove[adminId];
  if (!memberId) return;

  logToChat(adminId, `🚫 正在移除成员 ${memberId}...`, 'sent');
  logToNetwork(`🚫 开始移除 ${memberId}`, 'system');

  try {
    // 1. 从群组移除成员
    const response = await routers[adminId].handleMessage({
      type: 'REMOVE_MEMBER',
      payload: { groupId: groupId.value, memberToRemoveId: memberId }
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    logToChat(adminId, `✅ 成员 ${memberId} 已被移除`, 'success');
    if (chatLogs[memberId]) {
      logToChat(memberId, '🚫 您已被管理员移出群组', 'system');
    }

    logToNetwork(`✅ ${memberId} 已从群组移除`, 'success');

    // 2. 等待移除操作完成
    await new Promise(resolve => setTimeout(resolve, 800));

    // 3. 【关键修复】为所有剩余成员重新创建和分发密钥
    await updateAllPanels();
    const remainingMembers = groupInfo[adminId]?.members || [];

    logToNetwork(`🔄 为剩余成员重新密钥化: ${remainingMembers.join(', ')}`, 'system');

    // 清理所有人的密钥存储（移除被删除成员的相关密钥）
    for (const userId of remainingMembers) {
      try {
        await groupStateStore.remove(userId, groupId.value, memberId);
        logToNetwork(`🗑️ 已清理 ${userId} 中关于 ${memberId} 的密钥`, 'system');
      } catch (error) {
        // 忽略清理错误
      }
    }

    // 为所有剩余成员重新创建会话
    for (const userId of remainingMembers) {
      if (routers[userId]) {
        logToNetwork(`🔑 ${userId} 重新创建会话`, 'system');
        try {
          await createAndDistributeSession(userId);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          logToNetwork(`❌ ${userId} 重新创建会话失败: ${error.message}`, 'error');
        }
      }
    }

    logToNetwork(`✅ 重新密钥化完成`, 'success');

  } catch (error) {
    logToChat(adminId, `❌ 移除成员失败: ${error.message}`, 'error');
    logToNetwork(`❌ 移除 ${memberId} 失败: ${error.message}`, 'error');
  }

  memberToRemove[adminId] = '';
  await updateAllPanels();
}

async function redistributeKeys(adminId) {
  logToChat(adminId, '🔄 开始重新分发所有密钥...', 'sent');
  logToNetwork('🔄 管理员触发全局密钥重分发', 'system');

  try {
    const members = groupInfo[adminId]?.members || [];
    logToNetwork(`重分发目标成员: ${members.join(', ')}`, 'system');

    // 清空所有密钥状态
    for (const userId of members) {
      for (const memberId of members) {
        try {
          await groupStateStore.remove(userId, groupId.value, memberId);
        } catch (error) {
          // 忽略清理错误
        }
      }
    }

    // 重新创建所有会话
    for (const memberId of members) {
      if (routers[memberId]) {
        logToNetwork(`🔑 为 ${memberId} 重新创建会话...`, 'system');
        await createAndDistributeSession(memberId);
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }

    logToChat(adminId, '✅ 密钥重新分发完成', 'success');
    logToNetwork('✅ 全局密钥重分发完成', 'success');

  } catch (error) {
    logToChat(adminId, `❌ 密钥重新分发失败: ${error.message}`, 'error');
    logToNetwork(`❌ 密钥重分发失败: ${error.message}`, 'error');
  }

  await updateAllPanels();
}

// 调试相关
async function showDebugInfo() {
  const info = {
    currentGroupId: groupId.value,
    users: users.value.map(u => u.id),
    setupComplete: isSetupComplete.value,
    groupInfo: Object.fromEntries(Object.entries(groupInfo).map(([k, v]) => [k, v])),
    keyStatesCount: Object.fromEntries(Object.entries(keyStates).map(([k, v]) => {
      try {
        const parsed = JSON.parse(v);
        return [k, Object.keys(parsed).length];
      } catch {
        return [k, 0];
      }
    })),
    networkLogCount: networkLog.value.length,
    routers: Object.keys(routers),
    lastFewNetworkLogs: networkLog.value.slice(-10).map(log => ({
      time: log.timestamp,
      type: log.type,
      message: log.message.substring(0, 100) + (log.message.length > 100 ? '...' : '')
    }))
  };

  debugInfo.value = JSON.stringify(info, null, 2);
  showDebugModal.value = true;
}

function closeDebugModal() {
  showDebugModal.value = false;
}

function clearNetworkLog() {
  networkLog.value = [];
  logToNetwork('📝 日志已清空', 'system');
}

// 更新面板状态
async function updateUserPanel(userId) {
  try {
    // 更新群组信息
    const infoResponse = await routers[userId].handleMessage({
      type: 'GET_GROUP_INFO',
      payload: { groupId: groupId.value }
    });

    if (infoResponse.success) {
      groupInfo[userId] = infoResponse.data;
    }

    // 更新密钥状态
    const members = groupInfo[userId]?.members || [];
    const keyData = {};

    for (const memberId of members) {
      const state = await groupStateStore.get(userId, groupId.value, memberId);
      if (state) {
        keyData[memberId] = {
          senderKeyId: state.senderKeyId,
          chainIteration: state.chainKey.iteration,
          hasPrivateKey: !!state.signingPrivateKey,
          messageKeysCached: state.messageKeys.size,
        };
      } else {
        keyData[memberId] = null;
      }
    }

    keyStates[userId] = JSON.stringify(keyData, null, 2);

  } catch (error) {
    keyStates[userId] = `[ERROR] ${error.message}`;
  }
}

async function updateAllPanels() {
  for (const user of users.value) {
    if (routers[user.id]) {
      await updateUserPanel(user.id);
    }
  }
}
</script>

<style scoped>
.main-container {
  max-width: 1800px;
  margin: auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: #f5f7fa;
}

h1 {
  text-align: center;
  color: #2c3e50;
  margin-bottom: 10px;
}

h2, h3 {
  color: #34495e;
  margin-bottom: 10px;
}

fieldset {
  border: 2px solid #e3e6ea;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
  background-color: white;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}

legend {
  font-weight: bold;
  padding: 0 15px;
  color: #2c3e50;
  background: white;
}

.global-controls {
  border-color: #3498db;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
}

.admin-controls {
  border: 2px dashed #f39c12;
  background: linear-gradient(135deg, #fff5e6 0%, #ffe8cc 100%);
  margin-top: 15px;
}

.control-buttons {
  display: flex;
  gap: 15px;
  justify-content: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.panels-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(550px, 1fr));
  gap: 25px;
}

.user-panel {
  min-height: 600px;
}

.user-status {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 15px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: bold;
}

.status-badge.ready {
  background-color: #d4edda;
  color: #155724;
}

.status-badge.not-ready {
  background-color: #f8d7da;
  color: #721c24;
}

.admin-badge {
  background-color: #fff3cd;
  color: #856404;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: bold;
}

.controls, .control-group {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
  align-items: center;
}

.message-input, .member-input {
  flex: 1;
  padding: 12px;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.message-input:focus, .member-input:focus {
  border-color: #3498db;
  outline: none;
}

.member-select {
  flex: 1;
  padding: 10px;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
}

button {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font-weight: bold;
  transition: all 0.2s;
  font-size: 14px;
}

button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-init { background: linear-gradient(135deg, #6c757d, #495057); }
.btn-init:hover:not(:disabled) { transform: translateY(-2px); }

.btn-setup { background: linear-gradient(135deg, #27ae60, #229954); }
.btn-setup:hover:not(:disabled) { transform: translateY(-2px); }

.btn-debug { background: linear-gradient(135deg, #8e44ad, #7d3c98); }
.btn-debug:hover:not(:disabled) { transform: translateY(-2px); }

.btn-send { background: linear-gradient(135deg, #3498db, #2980b9); }
.btn-send:hover:not(:disabled) { transform: translateY(-2px); }

.btn-add { background: linear-gradient(135deg, #17a2b8, #138496); }
.btn-add:hover:not(:disabled) { transform: translateY(-2px); }

.btn-remove { background: linear-gradient(135deg, #dc3545, #c82333); }
.btn-remove:hover:not(:disabled) { transform: translateY(-2px); }

.btn-rekey { background: linear-gradient(135deg, #fd7e14, #e55a00); }
.btn-rekey:hover:not(:disabled) { transform: translateY(-2px); }

.btn-clear-log {
  background: linear-gradient(135deg, #6c757d, #495057);
  margin-top: 10px;
  font-size: 12px;
  padding: 6px 12px;
}

.user-displays {
  display: grid;
  grid-template-rows: 1fr auto auto;
  gap: 15px;
  margin-top: 15px;
}

.display-section {
  background: #f8f9fa;
  border-radius: 8px;
  overflow: hidden;
}

.display-section h3 {
  background: #e9ecef;
  margin: 0;
  padding: 10px 15px;
  font-size: 14px;
  border-bottom: 1px solid #dee2e6;
}

.chat-log, .network-log {
  background: white;
  padding: 10px;
  height: 200px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.4;
}

.network-log {
  height: 250px;
}

.info-display, .key-display {
  background: white;
  padding: 15px;
  height: 120px;
  overflow-y: auto;
  font-size: 13px;
}

.key-info {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
  padding: 8px;
  background: #f8f9fa;
  border-radius: 5px;
  border-left: 4px solid #dee2e6;
}

.member-name {
  font-weight: bold;
  color: #495057;
  margin-bottom: 4px;
}

.key-details {
  display: flex;
  gap: 10px;
  font-size: 11px;
}

.key-status.has-private {
  background: #d4edda;
  color: #155724;
  padding: 2px 6px;
  border-radius: 3px;
}

.key-status.no-private {
  background: #cce5ff;
  color: #004085;
  padding: 2px 6px;
  border-radius: 3px;
}

.key-iter, .msg-keys {
  background: #e2e3e5;
  color: #495057;
  padding: 2px 6px;
  border-radius: 3px;
}

.no-key, .no-data {
  color: #6c757d;
  font-style: italic;
  text-align: center;
  padding: 20px;
}

.log-entry {
  margin: 3px 0;
  padding: 4px 8px;
  border-radius: 4px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.timestamp, .msg-time {
  font-size: 10px;
  color: #6c757d;
  flex-shrink: 0;
  min-width: 50px;
}

.msg-content {
  flex: 1;
}

.log-entry.sent {
  background-color: #e3f2fd;
  color: #1565c0;
  border-left: 3px solid #1976d2;
}

.log-entry.received {
  background-color: #e8f5e8;
  color: #2e7d32;
  border-left: 3px solid #4caf50;
}

.log-entry.system {
  background-color: #fff3e0;
  color: #ef6c00;
  border-left: 3px solid #ff9800;
}

.log-entry.error {
  background-color: #ffebee;
  color: #c62828;
  border-left: 3px solid #f44336;
}

.log-entry.success {
  background-color: #e8f5e8;
  color: #1b5e20;
  border-left: 3px solid #4caf50;
}

.log-entry.network {
  background-color: #f3e5f5;
  color: #6a1b9a;
  border-left: 3px solid #9c27b0;
}

/* 调试模态框样式 */
.debug-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.debug-content {
  background: white;
  border-radius: 10px;
  padding: 20px;
  max-width: 80vw;
  max-height: 80vh;
  overflow: auto;
  position: relative;
}

.debug-content h3 {
  margin-top: 0;
  color: #2c3e50;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 15px;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.debug-text {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 5px;
  padding: 15px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .panels-container {
    grid-template-columns: 1fr;
  }

  .control-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .controls, .control-group {
    flex-direction: column;
    gap: 8px;
  }

  .user-displays {
    grid-template-rows: auto auto auto;
  }

  .chat-log, .network-log {
    height: 150px;
  }

  .info-display, .key-display {
    height: 100px;
  }
}
</style>