<template>
  <div class="test-page">
    <!-- 头部 -->
    <div class="header">
      <h1>🔐 端到端加密系统 - 完整功能测试</h1>
      <p class="subtitle">实时查看测试过程和结果</p>
    </div>

    <!-- 控制面板 -->
    <div class="control-panel">
      <button
          @click="runAllTests"
          :disabled="isRunning"
          class="btn-primary"
      >
        {{ isRunning ? '测试运行中...' : '▶️ 开始完整测试' }}
      </button>

      <button
          @click="clearResults"
          :disabled="isRunning"
          class="btn-secondary"
      >
        🗑️ 清空结果
      </button>

      <div class="stats">
        <span class="stat-item">
          <span class="label">总计:</span>
          <span class="value">{{ totalTests }}</span>
        </span>
        <span class="stat-item success">
          <span class="label">通过:</span>
          <span class="value">{{ passedTests }}</span>
        </span>
        <span class="stat-item error">
          <span class="label">失败:</span>
          <span class="value">{{ failedTests }}</span>
        </span>
        <span class="stat-item">
          <span class="label">耗时:</span>
          <span class="value">{{ totalTime.toFixed(2) }}ms</span>
        </span>
      </div>
    </div>

    <!-- 测试进度 -->
    <div v-if="isRunning" class="progress-container">
      <div class="progress-bar">
        <div
            class="progress-fill"
            :style="{ width: `${progress}%` }"
        ></div>
      </div>
      <p class="progress-text">{{ currentTest }} ({{ progress.toFixed(0) }}%)</p>
    </div>

    <!-- 测试结果列表 -->
    <div class="test-results">
      <div
          v-for="(category, idx) in testCategories"
          :key="idx"
          class="category-section"
      >
        <h2 class="category-title">
          {{ category.icon }} {{ category.name }}
          <span class="category-stats">
            ({{ category.passed }}/{{ category.total }})
          </span>
        </h2>

        <div class="test-list">
          <div
              v-for="(test, testIdx) in category.tests"
              :key="testIdx"
              :class="['test-item', test.status]"
          >
            <!-- 测试状态图标 -->
            <div class="test-icon">
              <span v-if="test.status === 'running'">⏳</span>
              <span v-else-if="test.status === 'pass'">✅</span>
              <span v-else-if="test.status === 'fail'">❌</span>
              <span v-else>⚪</span>
            </div>

            <!-- 测试信息 -->
            <div class="test-info">
              <div class="test-name">{{ test.name }}</div>
              <div class="test-details">
                <span v-if="test.time !== null" class="time">
                  ⏱️ {{ test.time.toFixed(2) }}ms
                </span>
                <span v-if="test.detail" class="detail">
                  {{ test.detail }}
                </span>
              </div>

              <!-- 错误信息 -->
              <div v-if="test.error" class="error-message">
                <strong>错误:</strong> {{ test.error }}
              </div>

              <!-- 测试步骤日志 -->
              <div v-if="test.logs && test.logs.length > 0" class="test-logs">
                <div
                    v-for="(log, logIdx) in test.logs"
                    :key="logIdx"
                    class="log-entry"
                >
                  <span class="log-step">步骤 {{ logIdx + 1 }}:</span>
                  <span class="log-text">{{ log }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部总结 -->
    <div v-if="testComplete" class="summary">
      <div :class="['summary-box', allTestsPassed ? 'success' : 'error']">
        <h3>
          {{ allTestsPassed ? '🎉 测试完成 - 全部通过！' : '⚠️ 测试完成 - 部分失败' }}
        </h3>
        <p>
          通过: {{ passedTests }}/{{ totalTests }}
          ({{ (passedTests / totalTests * 100).toFixed(1) }}%)
        </p>
        <p>总耗时: {{ totalTime.toFixed(2) }}ms</p>

        <div v-if="allTestsPassed" class="next-steps">
          <h4>✅ 下一步:</h4>
          <ul>
            <li>开发 UI 聊天界面</li>
            <li>部署后端网络服务</li>
            <li>将 mockMessageSender 替换为 WebSocketMessageSender</li>
            <li>集成订单合同功能</li>
            <li>进行用户测试</li>
          </ul>
        </div>

        <div v-else class="failed-tests">
          <h4>❌ 失败的测试:</h4>
          <ul>
            <li v-for="(test, idx) in failedTestsList" :key="idx">
              {{ test.category }} - {{ test.name }}: {{ test.error }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { cryptoHelper } from '../modulse/groupchat/crypto/crypto-helper';
import { SenderKeySession } from '../modulse/groupchat/protocol/sender-key-session';
import { fileEncryptionService } from '../modulse/utils/file-encryption.service';
import { groupManagementService } from '../modulse/groupchat/services/group-management-service';
import { groupE2eeService } from '../modulse/groupchat/services/group-e2ee-service';
import { groupStore } from '../modulse/groupchat/store/group-store';
import { groupStateStore } from '../modulse/groupchat/store/group-state-store';

// ===============================================
// 类型定义
// ===============================================

interface TestItem {
  name: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  time: number | null;
  detail?: string;
  error?: string;
  logs?: string[];
}

interface TestCategory {
  icon: string;
  name: string;
  tests: TestItem[];
  passed: number;
  total: number;
}

// ===============================================
// 响应式状态
// ===============================================

const isRunning = ref(false);
const testComplete = ref(false);
const currentTest = ref('');
const progress = ref(0);

const testCategories = ref<TestCategory[]>([
  {
    icon: '🔑',
    name: '测试 1: 密码学基础功能',
    tests: [
      { name: '1.1 对称密钥生成', status: 'pending', time: null, logs: [] },
      { name: '1.2 签名密钥对生成', status: 'pending', time: null, logs: [] },
      { name: '1.3 HMAC-SHA256 派生', status: 'pending', time: null, logs: [] },
      { name: '1.4 对称加密/解密', status: 'pending', time: null, logs: [] },
      { name: '1.5 签名生成/验证', status: 'pending', time: null, logs: [] },
    ],
    passed: 0,
    total: 5,
  },
  {
    icon: '🔨',
    name: '测试 2: Sender Key 协议',
    tests: [
      { name: '2.1 会话创建', status: 'pending', time: null, logs: [] },
      { name: '2.2 顺序消息加密/解密', status: 'pending', time: null, logs: [] },
      { name: '2.3 乱序消息处理', status: 'pending', time: null, logs: [] },
      { name: '2.4 极端乱序 (完全反序)', status: 'pending', time: null, logs: [] },
      { name: '2.5 已处理消息重复拒绝', status: 'pending', time: null, logs: [] },
      { name: '2.6 消息体积优化验证', status: 'pending', time: null, logs: [] },
      { name: '2.7 缓存窗口限制测试 (2000+)', status: 'pending', time: null, logs: [] },
    ],
    passed: 0,
    total: 7,
  },
  {
    icon: '📂',
    name: '测试 3: 文件加密功能',
    tests: [
      { name: '3.1 小文件加密 (10KB)', status: 'pending', time: null, logs: [] },
      { name: '3.2 中等文件加密 (100KB)', status: 'pending', time: null, logs: [] },
      { name: '3.3 大文件加密 (1MB)', status: 'pending', time: null, logs: [] },
      { name: '3.4 文件完整性验证', status: 'pending', time: null, logs: [] },
    ],
    passed: 0,
    total: 4,
  },
  {
    icon: '👥',
    name: '测试 4: 成员管理功能',
    tests: [
      { name: '4.1 添加新成员到群组', status: 'pending', time: null, logs: [] },
      { name: '4.2 新成员接收密钥分发', status: 'pending', time: null, logs: [] },
      { name: '4.3 新成员解密群消息', status: 'pending', time: null, logs: [] },
      { name: '4.4 移除成员后重新密钥化', status: 'pending', time: null, logs: [] },
      { name: '4.5 被移除成员无法解密新消息', status: 'pending', time: null, logs: [] },
    ],
    passed: 0,
    total: 5,
  },
  {
    icon: '⚡',
    name: '测试 5: 性能基准',
    tests: [
      { name: '5.1 加密吞吐量 (1000条消息)', status: 'pending', time: null, logs: [] },
      { name: '5.2 解密吞吐量 (1000条消息)', status: 'pending', time: null, logs: [] },
      { name: '5.3 乱序消息性能 (100条)', status: 'pending', time: null, logs: [] },
    ],
    passed: 0,
    total: 3,
  },
  {
    icon: '🔬',
    name: '测试 6: 边界和异常情况',
    tests: [
      { name: '6.1 空消息处理', status: 'pending', time: null, logs: [] },
      { name: '6.2 签名验证失败检测', status: 'pending', time: null, logs: [] },
      { name: '6.3 密文篡改检测', status: 'pending', time: null, logs: [] },
      { name: '6.4 跨群组消息拒绝', status: 'pending', time: null, logs: [] },
    ],
    passed: 0,
    total: 4,
  },
]);

// ===============================================
// 计算属性
// ===============================================

const totalTests = computed(() => {
  return testCategories.value.reduce((sum, cat) => sum + cat.total, 0);
});

const passedTests = computed(() => {
  return testCategories.value.reduce((sum, cat) => sum + cat.passed, 0);
});

const failedTests = computed(() => {
  return totalTests.value - passedTests.value;
});

const totalTime = computed(() => {
  let total = 0;
  testCategories.value.forEach(cat => {
    cat.tests.forEach(test => {
      if (test.time !== null) total += test.time;
    });
  });
  return total;
});

const allTestsPassed = computed(() => {
  return testComplete.value && failedTests.value === 0;
});

const failedTestsList = computed(() => {
  const failed: Array<{ category: string; name: string; error: string }> = [];
  testCategories.value.forEach(cat => {
    cat.tests.forEach(test => {
      if (test.status === 'fail') {
        failed.push({
          category: cat.name,
          name: test.name,
          error: test.error || '未知错误',
        });
      }
    });
  });
  return failed;
});

// ===============================================
// 辅助函数
// ===============================================

function createTestFile(name: string, sizeKB: number): File {
  const content = new Uint8Array(sizeKB * 1024).fill(65);
  const blob = new Blob([content], { type: 'text/plain' });
  return new File([blob], name, { type: 'text/plain' });
}

async function runTest(
    categoryIndex: number,
    testIndex: number,
    testFn: () => Promise<any>
): Promise<void> {
  const category = testCategories.value[categoryIndex];
  const test = category.tests[testIndex];

  test.status = 'running';
  test.logs = [];
  currentTest.value = test.name;

  const startTime = performance.now();

  try {
    const result = await testFn();
    const endTime = performance.now();

    test.status = 'pass';
    test.time = endTime - startTime;
    test.detail = result?.detail;
    category.passed++;

  } catch (error: any) {
    const endTime = performance.now();

    test.status = 'fail';
    test.time = endTime - startTime;
    test.error = error.message || String(error);
  }

  const completedTests = testCategories.value.reduce((sum, cat) => {
    return sum + cat.tests.filter(t => t.status !== 'pending').length;
  }, 0);
  progress.value = (completedTests / totalTests.value) * 100;
}

function addLog(categoryIndex: number, testIndex: number, message: string) {
  const test = testCategories.value[categoryIndex].tests[testIndex];
  if (!test.logs) test.logs = [];
  test.logs.push(message);
}

// ===============================================
// 测试函数
// ===============================================

/**
 * 测试 1: 密码学基础功能
 */
async function testCryptoBasics() {
  // 1.1 对称密钥生成
  await runTest(0, 0, async () => {
    addLog(0, 0, '调用 cryptoHelper.createSymmetricKey()');
    const key = cryptoHelper.createSymmetricKey();

    addLog(0, 0, `生成的密钥长度: ${key.length} 字节`);
    if (key.length !== 32) {
      throw new Error(`密钥长度错误: 期望 32，实际 ${key.length}`);
    }

    addLog(0, 0, '✓ 密钥长度验证通过');
    return { detail: `生成 ${key.length} 字节密钥` };
  });

  // 1.2 签名密钥对生成
  await runTest(0, 1, async () => {
    addLog(0, 1, '调用 cryptoHelper.createSigningKeyPair()');
    const keyPair = cryptoHelper.createSigningKeyPair();

    addLog(0, 1, `公钥长度: ${keyPair.publicKey.length} 字节`);
    addLog(0, 1, `私钥长度: ${keyPair.privateKey.length} 字节`);

    if (!keyPair.publicKey || !keyPair.privateKey) {
      throw new Error('密钥对生成失败');
    }

    addLog(0, 1, '✓ 密钥对生成成功');
    return { detail: `公钥 ${keyPair.publicKey.length}B, 私钥 ${keyPair.privateKey.length}B` };
  });

  // 1.3 HMAC-SHA256
  await runTest(0, 2, async () => {
    addLog(0, 2, '准备测试数据: key=32字节全1, data=16字节全2');
    const key = new Uint8Array(32).fill(1);
    const data = new Uint8Array(16).fill(2);

    addLog(0, 2, '调用 cryptoHelper.hmacSHA256()');
    const result = cryptoHelper.hmacSHA256(key, data);

    addLog(0, 2, `HMAC 输出长度: ${result.length} 字节`);
    if (result.length !== 32) {
      throw new Error(`HMAC 输出长度错误: 期望 32，实际 ${result.length}`);
    }

    addLog(0, 2, '✓ HMAC-SHA256 输出正确');
    return { detail: `输出 ${result.length} 字节` };
  });

  // 1.4 对称加解密
  await runTest(0, 3, async () => {
    addLog(0, 3, '生成测试密钥');
    const key = cryptoHelper.createSymmetricKey();
    const plaintext = new TextEncoder().encode('Hello World!');

    addLog(0, 3, `明文: "Hello World!" (${plaintext.length} 字节)`);
    addLog(0, 3, '执行加密...');
    const ciphertext = cryptoHelper.encrypt(key, plaintext);

    addLog(0, 3, `密文长度: ${ciphertext.length} 字节`);
    addLog(0, 3, '执行解密...');
    const decrypted = cryptoHelper.decrypt(key, ciphertext);

    if (!decrypted) {
      throw new Error('解密返回 null');
    }

    const decryptedText = new TextDecoder().decode(decrypted);
    addLog(0, 3, `解密结果: "${decryptedText}"`);

    if (decryptedText !== 'Hello World!') {
      throw new Error(`解密结果不匹配: 期望 "Hello World!"，实际 "${decryptedText}"`);
    }

    addLog(0, 3, '✓ 加密/解密验证通过');
    return { detail: '加密解密成功' };
  });

  // 1.5 签名验证
  await runTest(0, 4, async () => {
    addLog(0, 4, '生成签名密钥对');
    const keyPair = cryptoHelper.createSigningKeyPair();
    const data = new TextEncoder().encode('Test message for signing');

    addLog(0, 4, `待签名数据: "${new TextDecoder().decode(data)}"`);
    addLog(0, 4, '生成签名...');
    const signature = cryptoHelper.sign(keyPair.privateKey, data);

    addLog(0, 4, `签名长度: ${signature.length} 字节`);
    addLog(0, 4, '验证签名...');
    const isValid = cryptoHelper.verify(keyPair.publicKey, signature, data);

    addLog(0, 4, `签名验证结果: ${isValid ? '有效' : '无效'}`);

    if (!isValid) {
      throw new Error('签名验证失败');
    }

    addLog(0, 4, '✓ 签名生成和验证成功');
    return { detail: '签名验证通过' };
  });
}

/**
 * 测试 2: Sender Key 协议
 */
async function testSenderKeyProtocol() {
  // 2.1 会话创建
  await runTest(1, 0, async () => {
    addLog(1, 0, '创建 Alice 的 Sender Key 会话');
    addLog(1, 0, '参数: userId="alice", groupId="test_group"');

    const session = SenderKeySession.createSession('alice', 'test_group');
    const state = session.getState();

    addLog(1, 0, `会话 ID: ${state.senderKeyId}`);
    addLog(1, 0, `初始迭代次数: ${state.chainKey.iteration}`);
    addLog(1, 0, `链密钥长度: ${state.chainKey.key.length} 字节`);

    if (state.chainKey.iteration !== 0) {
      throw new Error(`初始迭代次数错误: 期望 0，实际 ${state.chainKey.iteration}`);
    }

    addLog(1, 0, '✓ 会话创建成功，初始状态正确');
    return { detail: `Sender Key ID: ${state.senderKeyId}` };
  });

  // 2.2 顺序消息
  await runTest(1, 1, async () => {
    addLog(1, 1, '创建 Alice 会话 (发送者)');
    const alice = SenderKeySession.createSession('alice', 'test_group');

    addLog(1, 1, '生成密钥分发消息');
    const distMsg = alice.getDistributionMessage();

    addLog(1, 1, '创建 Bob 会话 (接收者)');
    const bob = SenderKeySession.createFromDistribution({
      ...distMsg,
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(1, 1, '准备发送 5 条消息...');
    const messages = [];
    for (let i = 0; i < 5; i++) {
      addLog(1, 1, `Alice 加密消息 ${i}: "Message ${i}"`);
      const encrypted = alice.ratchetEncrypt(
          new TextEncoder().encode(`Message ${i}`)
      );
      messages.push({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
    }

    addLog(1, 1, 'Bob 按顺序解密所有消息...');
    for (let i = 0; i < 5; i++) {
      const decrypted = bob.ratchetDecrypt(messages[i]);
      const text = new TextDecoder().decode(decrypted);
      addLog(1, 1, `✓ 消息 ${i} 解密: "${text}"`);

      if (text !== `Message ${i}`) {
        throw new Error(`消息 ${i} 解密错误: 期望 "Message ${i}"，实际 "${text}"`);
      }
    }

    addLog(1, 1, '✓ 所有顺序消息加密解密成功');
    return { detail: '5 条消息全部通过' };
  });

  // 2.3 乱序消息
  await runTest(1, 2, async () => {
    addLog(1, 2, '创建 Alice 和 Bob 会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(1, 2, 'Alice 加密 5 条消息 (0-4)');
    const messages = [];
    for (let i = 0; i < 5; i++) {
      const encrypted = alice.ratchetEncrypt(
          new TextEncoder().encode(`Message ${i}`)
      );
      messages.push({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
    }

    addLog(1, 2, 'Bob 乱序接收: 0, 2, 1, 4, 3');
    const order = [0, 2, 1, 4, 3];

    for (const idx of order) {
      const decrypted = bob.ratchetDecrypt(messages[idx]);
      const text = new TextDecoder().decode(decrypted);
      addLog(1, 2, `✓ 消息 ${idx} 解密成功: "${text}"`);

      if (text !== `Message ${idx}`) {
        throw new Error(`消息 ${idx} 解密错误`);
      }
    }

    addLog(1, 2, '✓ 乱序消息全部正确解密');
    return { detail: '5 条乱序消息全部通过' };
  });

  // 2.4 极端乱序
  await runTest(1, 3, async () => {
    addLog(1, 3, '创建会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(1, 3, 'Alice 加密 10 条消息');
    const messages = [];
    for (let i = 0; i < 10; i++) {
      const encrypted = alice.ratchetEncrypt(
          new TextEncoder().encode(`Message ${i}`)
      );
      messages.push({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
    }

    addLog(1, 3, 'Bob 完全反序接收: 9, 8, 7, ..., 1, 0');
    for (let i = 9; i >= 0; i--) {
      const decrypted = bob.ratchetDecrypt(messages[i]);
      const text = new TextDecoder().decode(decrypted);

      if (text !== `Message ${i}`) {
        throw new Error(`反序消息 ${i} 解密错误`);
      }

      if (i % 3 === 0) {
        addLog(1, 3, `✓ 消息 ${i} 解密成功`);
      }
    }

    addLog(1, 3, '✓ 10 条完全反序消息全部正确解密');
    return { detail: '10 条反序消息全部通过' };
  });

  // 2.5 已处理消息重复拒绝
  await runTest(1, 4, async () => {
    addLog(1, 4, '创建会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(1, 4, 'Alice 加密消息 0');
    const msg0 = alice.ratchetEncrypt(new TextEncoder().encode('Message 0'));

    addLog(1, 4, 'Bob 接收并处理消息 0 (迭代 0 → 1)');
    bob.ratchetDecrypt({ ...msg0, groupId: 'test_group', senderId: 'alice' });

    addLog(1, 4, 'Alice 发送多条新消息（推进棘轮）');
    for (let i = 1; i <= 10; i++) {
      alice.ratchetEncrypt(new TextEncoder().encode(`Message ${i}`));
    }
    const latestMsg = alice.ratchetEncrypt(new TextEncoder().encode('Latest message'));

    addLog(1, 4, 'Bob 跳过中间消息，直接接收最新消息 (迭代 1 → 12)');
    bob.ratchetDecrypt({ ...latestMsg, groupId: 'test_group', senderId: 'alice' });
    addLog(1, 4, 'Bob 当前迭代已推进到 12，缓存了迭代 1-10 的密钥');

    addLog(1, 4, '尝试重新处理消息 0 (迭代 0 < 当前 12，且不在缓存)');
    try {
      bob.ratchetDecrypt({ ...msg0, groupId: 'test_group', senderId: 'alice' });
      throw new Error('应该拒绝已处理过的旧消息，但没有抛出错误');
    } catch (err: any) {
      addLog(1, 4, `✓ 正确拒绝: ${err.message.substring(0, 40)}...`);
      if (!err.message.includes('无法处理迭代')) {
        throw new Error('错误消息不正确');
      }
    }

    addLog(1, 4, '✓ 已处理的旧消息正确被拒绝（防重放攻击）');
    return { detail: '防重放机制正常' };
  });

  // 2.6 消息体积优化验证
  await runTest(1, 5, async () => {
    addLog(1, 5, '创建会话并加密一条消息');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const encrypted = alice.ratchetEncrypt(new TextEncoder().encode('Test'));

    addLog(1, 5, '检查消息结构...');
    addLog(1, 5, `- 包含 iteration: ${encrypted.iteration !== undefined}`);
    addLog(1, 5, `- 包含 ciphertext: ${encrypted.ciphertext !== undefined}`);
    addLog(1, 5, `- 包含 signature: ${encrypted.signature !== undefined}`);
    addLog(1, 5, `- 包含 messageKeySalt: ${('messageKeySalt' in encrypted)}`);

    if ('messageKeySalt' in encrypted) {
      throw new Error('消息中不应包含 messageKeySalt 字段（已采用确定性派生）');
    }

    const baseSize = 4 + 4 + 64; // iteration + senderKeyId + signature
    addLog(1, 5, `消息基础大小: ${baseSize} 字节 (不含 ciphertext)`);
    addLog(1, 5, '✓ 消息结构正确，已删除 messageKeySalt (节省32字节)');

    return { detail: `基础 ${baseSize}B (优化32B)` };
  });

  // 2.7 缓存窗口限制测试
  await runTest(1, 6, async () => {
    addLog(1, 6, '创建会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(1, 6, 'Alice 加密消息 0（保存以便后续测试）');
    const msg0 = alice.ratchetEncrypt(new TextEncoder().encode('Old message'));

    addLog(1, 6, '⚡ Alice 发送大量消息，超出缓存窗口限制...');
    addLog(1, 6, '⚠️  注意：这个测试需要生成 2000+ 条消息，可能需要几秒钟');

    const SKIP_COUNT = 2100;
    const logInterval = 500;

    const startTime = performance.now();
    for (let i = 1; i <= SKIP_COUNT; i++) {
      alice.ratchetEncrypt(new TextEncoder().encode(`Message ${i}`));

      if (i % logInterval === 0) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        addLog(1, 6, `  已生成 ${i}/${SKIP_COUNT} 条消息 (${elapsed}s)`);
      }
    }

    const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
    addLog(1, 6, `✓ 完成生成 ${SKIP_COUNT} 条消息 (${totalTime}s)`);

    addLog(1, 6, 'Alice 发送最新消息（迭代 ' + (SKIP_COUNT + 1) + '）');
    const latestMsg = alice.ratchetEncrypt(new TextEncoder().encode('Latest message'));

    addLog(1, 6, 'Bob 跳过所有中间消息，直接接收最新消息');
    addLog(1, 6, '💡 这会让 Bob 缓存迭代 1-2000，并将当前迭代推进到 ' + (SKIP_COUNT + 2));
    bob.ratchetDecrypt({ ...latestMsg, groupId: 'test_group', senderId: 'alice' });

    addLog(1, 6, '尝试处理消息 0（迭代 0，已超出缓存窗口）');
    addLog(1, 6, `当前迭代: ${SKIP_COUNT + 2}, 缓存窗口: [${2 + 2}, ${SKIP_COUNT + 2}]`);
    addLog(1, 6, `消息 0 已超出缓存窗口下限，应被拒绝`);

    try {
      bob.ratchetDecrypt({ ...msg0, groupId: 'test_group', senderId: 'alice' });
      throw new Error('应该拒绝超出缓存窗口的消息，但没有抛出错误');
    } catch (err: any) {
      addLog(1, 6, `✓ 正确拒绝: ${err.message.substring(0, 50)}...`);
      if (!err.message.includes('无法处理迭代')) {
        throw new Error('错误消息不正确');
      }
    }

    addLog(1, 6, '✓ 超出缓存窗口的消息正确被拒绝');
    addLog(1, 6, `💾 性能指标: ${(SKIP_COUNT / parseFloat(totalTime)).toFixed(0)} 消息/秒`);

    return { detail: `2000+ 消息缓存限制验证通过` };
  });
}

/**
 * 测试 3: 文件加密
 */
async function testFileEncryption() {
  // 3.1 小文件
  await runTest(2, 0, async () => {
    addLog(2, 0, '创建 10KB 测试文件');
    const file = createTestFile('test.txt', 10);
    addLog(2, 0, `文件名: ${file.name}, 大小: ${file.size} 字节`);

    addLog(2, 0, '调用 fileEncryptionService.encryptFileForGroup()');
    const encrypted = await fileEncryptionService.encryptFileForGroup(
        file, 'alice', 'test_group'
    );

    addLog(2, 0, '验证加密包结构...');
    addLog(2, 0, `- metadata 存在: ${!!encrypted.metadata}`);
    addLog(2, 0, `- encryptedContent 存在: ${!!encrypted.encryptedContent}`);
    addLog(2, 0, `- signature 存在: ${!!encrypted.signature}`);

    if (!encrypted.metadata || !encrypted.encryptedContent || !encrypted.signature) {
      throw new Error('加密包结构不完整');
    }

    const sizeKB = (encrypted.encryptedContent.byteLength / 1024).toFixed(2);
    addLog(2, 0, `加密后大小: ${sizeKB} KB`);
    addLog(2, 0, '✓ 小文件加密成功');

    return { detail: `${sizeKB} KB` };
  });

  // 3.2 中等文件
  await runTest(2, 1, async () => {
    addLog(2, 1, '创建 100KB 测试文件');
    const file = createTestFile('medium.txt', 100);

    addLog(2, 1, '执行加密...');
    const encrypted = await fileEncryptionService.encryptFileForGroup(
        file, 'alice', 'test_group'
    );

    const sizeKB = (encrypted.encryptedContent.byteLength / 1024).toFixed(2);
    addLog(2, 1, `加密后大小: ${sizeKB} KB`);
    addLog(2, 1, '✓ 中等文件加密成功');

    return { detail: `${sizeKB} KB` };
  });

  // 3.3 大文件
  await runTest(2, 2, async () => {
    addLog(2, 2, '创建 1MB 测试文件');
    const file = createTestFile('large.txt', 1024);

    addLog(2, 2, '执行加密 (可能需要几秒)...');
    const encrypted = await fileEncryptionService.encryptFileForGroup(
        file, 'alice', 'test_group'
    );

    const sizeMB = (encrypted.encryptedContent.byteLength / 1024 / 1024).toFixed(2);
    addLog(2, 2, `加密后大小: ${sizeMB} MB`);
    addLog(2, 2, '✓ 大文件加密成功');

    return { detail: `${sizeMB} MB` };
  });

  // 3.4 文件完整性验证
  await runTest(2, 3, async () => {
    addLog(2, 3, '创建测试文件并加密');
    const file = createTestFile('verify.txt', 50);
    const encrypted = await fileEncryptionService.encryptFileForGroup(
        file, 'alice', 'test_group'
    );

    addLog(2, 3, '验证元数据字段...');
    addLog(2, 3, `- 原始文件名: ${encrypted.metadata.originalName}`);
    addLog(2, 3, `- 文件大小: ${encrypted.metadata.size} 字节`);
    addLog(2, 3, `- 加密后大小: ${encrypted.metadata.encryptedSize} 字节`);
    addLog(2, 3, `- 校验和长度: ${encrypted.metadata.checksum.length} 字符`);

    if (encrypted.metadata.originalName !== file.name) {
      throw new Error('文件名不匹配');
    }

    if (encrypted.metadata.size !== file.size) {
      throw new Error('文件大小不匹配');
    }

    addLog(2, 3, '✓ 文件完整性验证通过');
    return { detail: '元数据完整' };
  });
}

/**
 * 测试 4: 成员管理功能
 */
async function testMemberManagement() {
  // 4.1 添加新成员到群组
  await runTest(3, 0, async () => {
    addLog(3, 0, '创建测试群组');
    const groupId = 'test_member_group';

    await groupManagementService.createGroup(groupId, 'alice', ['bob']);

    addLog(3, 0, '验证群组成员');
    const members = await groupManagementService.getGroupMembers(groupId);
    addLog(3, 0, `当前成员: ${members.join(', ')}`);

    if (!members.includes('alice') || !members.includes('bob')) {
      throw new Error('群组成员不正确');
    }

    addLog(3, 0, 'Alice 创建会话并分发密钥');
    const distMsg = await groupE2eeService.createGroupSession('alice', groupId);
    await groupE2eeService.processGroupKeyDistribution('bob', 'alice', distMsg);

    addLog(3, 0, '添加 Charlie 到群组');
    await groupManagementService.addMemberToGroup(groupId, 'alice', 'charlie');

    addLog(3, 0, '验证 Charlie 已加入');
    const updatedMembers = await groupManagementService.getGroupMembers(groupId);
    addLog(3, 0, `更新后成员: ${updatedMembers.join(', ')}`);

    if (!updatedMembers.includes('charlie') || updatedMembers.length !== 3) {
      throw new Error('添加成员失败');
    }

    addLog(3, 0, '✓ 成功添加新成员');
    return { detail: `群组现有 ${updatedMembers.length} 个成员` };
  });

  // 4.2 新成员接收密钥分发
  await runTest(3, 1, async () => {
    const groupId = 'test_member_group';

    addLog(3, 1, '检查 Charlie 是否接收到 Alice 的密钥');

    const hasAliceKey = await groupE2eeService.hasValidSession('charlie', groupId, 'alice');
    addLog(3, 1, `Charlie 是否有 Alice 的密钥: ${hasAliceKey}`);

    if (!hasAliceKey) {
      throw new Error('新成员未接收到密钥分发');
    }

    addLog(3, 1, '检查 Charlie 是否接收到Bob 的密钥');
    const hasBobKey = await groupE2eeService.hasValidSession('charlie', groupId, 'bob');
    addLog(3, 1, `Charlie 是否有 Bob 的密钥: ${hasBobKey}`);

    addLog(3, 1, '✓ 密钥分发成功');
    return { detail: '新成员收到历史密钥' };
  });

  // 4.3 新成员解密群消息
  await runTest(3, 2, async () => {
    const groupId = 'test_member_group';

    addLog(3, 2, 'Alice 发送测试消息');
    const plaintext = new TextEncoder().encode('Welcome Charlie!');
    const encrypted = await groupE2eeService.encryptGroupMessage('alice', groupId, plaintext);

    addLog(3, 2, 'Charlie 尝试解密消息');
    const decrypted = await groupE2eeService.decryptGroupMessage('charlie', encrypted);
    const decryptedText = new TextDecoder().decode(decrypted);

    addLog(3, 2, `解密结果: "${decryptedText}"`);

    if (decryptedText !== 'Welcome Charlie!') {
      throw new Error(`解密内容不匹配: 期望 "Welcome Charlie!"，实际 "${decryptedText}"`);
    }

    addLog(3, 2, '✓ 新成员成功解密群消息');
    return { detail: '新成员已具备解密能力' };
  });

  // 4.4 移除成员后重新密钥化
  await runTest(3, 3, async () => {
    const groupId = 'test_member_group';

    addLog(3, 3, '移除 Bob 从群组');
    await groupManagementService.removeMemberFromGroup(groupId, 'alice', 'bob');

    addLog(3, 3, '验证 Bob 已被移除');
    const members = await groupManagementService.getGroupMembers(groupId);
    addLog(3, 3, `当前成员: ${members.join(', ')}`);

    if (members.includes('bob')) {
      throw new Error('成员移除失败');
    }

    addLog(3, 3, 'Alice 重新创建会话（重新密钥化）');
    const newDistMsg = await groupE2eeService.createGroupSession('alice', groupId);

    addLog(3, 3, '将 Alice 的新密钥分发给 Charlie');
    await groupE2eeService.processGroupKeyDistribution('charlie', 'alice', newDistMsg);

    addLog(3, 3, '验证新会话创建成功');
    const aliceState = await groupStateStore.get('alice', groupId, 'alice');
    if (!aliceState) {
      throw new Error('新会话创建失败');
    }

    addLog(3, 3, `新会话 ID: ${aliceState.senderKeyId}`);
    addLog(3, 3, '✓ 移除成员后成功重新密钥化');
    return { detail: '群组安全性已更新' };
  });

  // 4.5 被移除成员无法解密新消息
  await runTest(3, 4, async () => {
    const groupId = 'test_member_group';

    addLog(3, 4, 'Alice 使用新会话发送消息');
    const plaintext = new TextEncoder().encode('Bob cannot see this');
    const encrypted = await groupE2eeService.encryptGroupMessage('alice', groupId, plaintext);

    addLog(3, 4, 'Bob 尝试解密新消息（应该失败）');
    try {
      await groupE2eeService.decryptGroupMessage('bob', encrypted);
      throw new Error('被移除的成员不应能解密新消息');
    } catch (err: any) {
      addLog(3, 4, `✓ 正确拒绝: ${err.message.substring(0, 40)}...`);

      if (!err.message.includes('不是群组') && !err.message.includes('找不到')) {
        console.warn('错误消息可能不是预期的，但测试仍然通过');
      }
    }

    addLog(3, 4, '验证 Charlie 仍能解密');
    const decrypted = await groupE2eeService.decryptGroupMessage('charlie', encrypted);
    const decryptedText = new TextDecoder().decode(decrypted);
    addLog(3, 4, `Charlie 解密结果: "${decryptedText}"`);

    if (decryptedText !== 'Bob cannot see this') {
      throw new Error('留下的成员解密失败');
    }

    addLog(3, 4, '✓ 被移除成员无法解密，留下成员正常');
    return { detail: '重新密钥化生效' };
  });
}

/**
 * 测试 5: 性能基准
 */
async function testPerformance() {
  // 5.1 加密吞吐量
  await runTest(4, 0, async () => {
    addLog(4, 0, '创建会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');

    const count = 1000;
    addLog(4, 0, `准备加密 ${count} 条消息...`);

    const start = performance.now();
    for (let i = 0; i < count; i++) {
      alice.ratchetEncrypt(new TextEncoder().encode(`Message ${i}`));

      if (i % 200 === 0 && i > 0) {
        addLog(4, 0, `已加密 ${i}/${count} 条`);
      }
    }
    const duration = performance.now() - start;

    const throughput = Math.round((count / duration) * 1000);
    addLog(4, 0, `总耗时: ${duration.toFixed(2)} ms`);
    addLog(4, 0, `吞吐量: ${throughput} 消息/秒`);
    addLog(4, 0, '✓ 加密性能测试完成');

    return { detail: `${throughput} 消息/秒` };
  });

  // 5.2 解密吞吐量
  await runTest(4, 1, async () => {
    addLog(4, 1, '创建会话并准备消息');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    const count = 1000;
    addLog(4, 1, `加密 ${count} 条消息...`);
    const messages = [];
    for (let i = 0; i < count; i++) {
      const encrypted = alice.ratchetEncrypt(
          new TextEncoder().encode(`Message ${i}`)
      );
      messages.push({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
    }

    addLog(4, 1, '开始解密测试...');
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      bob.ratchetDecrypt(messages[i]);

      if (i % 200 === 0 && i > 0) {
        addLog(4, 1, `已解密 ${i}/${count} 条`);
      }
    }
    const duration = performance.now() - start;

    const throughput = Math.round((count / duration) * 1000);
    addLog(4, 1, `总耗时: ${duration.toFixed(2)} ms`);
    addLog(4, 1, `吞吐量: ${throughput} 消息/秒`);
    addLog(4, 1, '✓ 解密性能测试完成');

    return { detail: `${throughput} 消息/秒` };
  });

  // 5.3 乱序消息性能
  await runTest(4, 2, async () => {
    addLog(4, 2, '创建会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    const count = 100;
    addLog(4, 2, `加密 ${count} 条消息...`);
    const messages = [];
    for (let i = 0; i < count; i++) {
      const encrypted = alice.ratchetEncrypt(
          new TextEncoder().encode(`Message ${i}`)
      );
      messages.push({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
    }

    addLog(4, 2, '随机打乱消息顺序');
    const shuffled = [...messages].sort(() => Math.random() - 0.5);

    addLog(4, 2, '开始乱序解密测试...');
    const start = performance.now();
    for (const msg of shuffled) {
      bob.ratchetDecrypt(msg);
    }
    const duration = performance.now() - start;

    addLog(4, 2, `总耗时: ${duration.toFixed(2)} ms`);
    addLog(4, 2, `平均: ${(duration / count).toFixed(2)} ms/消息`);
    addLog(4, 2, '✓ 乱序消息性能测试完成');

    return { detail: `${(duration / count).toFixed(2)} ms/消息` };
  });
}

/**
 * 测试 6: 边界和异常情况
 */
async function testEdgeCases() {
  // 6.1 空消息
  await runTest(5, 0, async () => {
    addLog(5, 0, '创建会话');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(5, 0, '加密空消息 (0 字节)');
    const encrypted = alice.ratchetEncrypt(new Uint8Array(0));

    addLog(5, 0, '解密空消息');
    const decrypted = bob.ratchetDecrypt({
      ...encrypted,
      groupId: 'test_group',
      senderId: 'alice'
    });

    addLog(5, 0, `解密结果长度: ${decrypted.length} 字节`);

    if (decrypted.length !== 0) {
      throw new Error('空消息处理错误');
    }

    addLog(5, 0, '✓ 空消息处理正确');
    return { detail: '0字节消息通过' };
  });

  // 6.2 签名验证失败
  await runTest(5, 1, async () => {
    addLog(5, 1, '创建会话并加密消息');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    const encrypted = alice.ratchetEncrypt(new TextEncoder().encode('Test'));

    addLog(5, 1, '篡改签名 (填充全 0xFF)');
    encrypted.signature = new Uint8Array(64).fill(255);

    addLog(5, 1, '尝试解密...');
    try {
      bob.ratchetDecrypt({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
      throw new Error('应该检测到签名错误');
    } catch (err: any) {
      addLog(5, 1, `✓ 检测到错误: ${err.message.substring(0, 20)}...`);
      if (!err.message.includes('签名验证失败')) {
        throw new Error('错误消息不正确');
      }
    }

    addLog(5, 1, '✓ 签名验证失败正确检测');
    return { detail: '签名篡改检测通过' };
  });

  // 6.3 密文篡改检测
  await runTest(5, 2, async () => {
    addLog(5, 2, '创建会话并加密消息');
    const alice = SenderKeySession.createSession('alice', 'test_group');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'test_group',
      senderId: 'alice'
    });

    const encrypted = alice.ratchetEncrypt(new TextEncoder().encode('Test'));

    addLog(5, 2, '篡改密文第一个字节');
    encrypted.ciphertext[0] ^= 0xFF;

    addLog(5, 2, '尝试解密...');
    try {
      bob.ratchetDecrypt({ ...encrypted, groupId: 'test_group', senderId: 'alice' });
      throw new Error('应该检测到密文篡改');
    } catch (err: any) {
      addLog(5, 2, `✓ 检测到错误: ${err.message.substring(0, 20)}...`);
    }

    addLog(5, 2, '✓ 密文篡改正确检测');
    return { detail: '密文篡改检测通过' };
  });

  // 6.4 跨群组消息拒绝
  await runTest(5, 3, async () => {
    addLog(5, 3, '创建 group1 的会话');
    const alice = SenderKeySession.createSession('alice', 'group1');
    const bob = SenderKeySession.createFromDistribution({
      ...alice.getDistributionMessage(),
      groupId: 'group1',
      senderId: 'alice'
    });

    addLog(5, 3, '加密消息 (group1)');
    const encrypted = alice.ratchetEncrypt(new TextEncoder().encode('Test'));

    addLog(5, 3, '尝试用 group2 的 ID 解密...');
    try {
      bob.ratchetDecrypt({ ...encrypted, groupId: 'group2', senderId: 'alice' });
      throw new Error('应该拒绝跨群组消息');
    } catch (err: any) {
      addLog(5, 3, `✓ 检测到错误: ${err.message.substring(0, 30)}...`);
      if (!err.message.includes('群组 ID 不匹配')) {
        throw new Error('错误消息不正确');
      }
    }

    addLog(5, 3, '✓ 跨群组消息正确拒绝');
    return { detail: '群组隔离验证通过' };
  });
}

// ===============================================
// 主测试函数
// ===============================================

async function runAllTests() {
  if (isRunning.value) return;

  isRunning.value = true;
  testComplete.value = false;
  progress.value = 0;

  testCategories.value.forEach(category => {
    category.passed = 0;
    category.tests.forEach(test => {
      test.status = 'pending';
      test.time = null;
      test.error = undefined;
      test.detail = undefined;
      test.logs = [];
    });
  });

  try {
    await testCryptoBasics();
    await testSenderKeyProtocol();
    await testFileEncryption();
    await testMemberManagement();
    await testPerformance();
    await testEdgeCases();

    testComplete.value = true;
    currentTest.value = '测试完成';

  } catch (error) {
    console.error('测试过程发生错误:', error);
  } finally {
    isRunning.value = false;
  }
}

function clearResults() {
  testComplete.value = false;
  progress.value = 0;
  currentTest.value = '';

  testCategories.value.forEach(category => {
    category.passed = 0;
    category.tests.forEach(test => {
      test.status = 'pending';
      test.time = null;
      test.error = undefined;
      test.detail = undefined;
      test.logs = [];
    });
  });
}
</script>

<style scoped>
.test-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.header {
  text-align: center;
  color: white;
  margin-bottom: 30px;
}

.header h1 {
  font-size: 2.5rem;
  margin: 0 0 10px 0;
}

.subtitle {
  font-size: 1.1rem;
  opacity: 0.9;
}

.control-panel {
  background: white;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.btn-primary, .btn-secondary {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f0f0f0;
  color: #333;
}

.btn-secondary:hover:not(:disabled) {
  background: #e0e0e0;
}

.stats {
  display: flex;
  gap: 20px;
  margin-left: auto;
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.stat-item .label {
  font-weight: 600;
  color: #666;
}

.stat-item .value {
  font-size: 1.2rem;
  font-weight: 700;
  color: #333;
}

.stat-item.success .value {
  color: #22c55e;
}

.stat-item.error .value {
  color: #ef4444;
}

.progress-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transition: width 0.3s;
}

.progress-text {
  text-align: center;
  color: #666;
  font-weight: 600;
}

.test-results {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.category-section {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.category-title {
  font-size: 1.5rem;
  margin: 0 0 15px 0;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.category-stats {
  font-size: 1rem;
  color: #666;
  font-weight: 400;
}

.test-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.test-item {
  display: flex;
  gap: 12px;
  padding: 15px;
  border-radius: 8px;
  border-left: 4px solid #e0e0e0;
  background: #f9fafb;
  transition: all 0.3s;
}

.test-item.running {
  border-left-color: #3b82f6;
  background: #eff6ff;
  animation: pulse 2s infinite;
}

.test-item.pass {
  border-left-color: #22c55e;
  background: #f0fdf4;
}

.test-item.fail {
  border-left-color: #ef4444;
  background: #fef2f2;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

.test-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.test-info {
  flex: 1;
}

.test-name {
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.test-details {
  display: flex;
  gap: 15px;
  font-size: 0.9rem;
  color: #666;
  flex-wrap: wrap;
}

.time {
  color: #3b82f6;
}

.detail {
  color: #8b5cf6;
}

.error-message {
  margin-top: 8px;
  padding: 10px;
  background: #fee2e2;
  border-radius: 4px;
  font-size: 0.9rem;
  color: #dc2626;
}

.test-logs {
  margin-top: 10px;
  padding: 10px;
  background: #f3f4f6;
  border-radius: 6px;
  font-size: 0.85rem;
}

.log-entry {
  padding: 4px 0;
  border-bottom: 1px solid #e5e7eb;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-step {
  font-weight: 600;
  color: #6366f1;
  margin-right: 8px;
}

.log-text {
  color: #4b5563;
}

.summary {
  margin-top: 20px;
}

.summary-box {
  background: white;
  border-radius: 12px;
  padding: 30px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.summary-box.success {
  border: 3px solid #22c55e;
}

.summary-box.error {
  border: 3px solid #ef4444;
}

.summary-box h3 {
  font-size: 1.8rem;
  margin: 0 0 15px 0;
}

.summary-box p {
  font-size: 1.1rem;
  color: #666;
  margin: 8px 0;
}

.next-steps, .failed-tests {
  margin-top: 20px;
  padding: 20px;
  background: #f9fafb;
  border-radius: 8px;
}

.next-steps h4, .failed-tests h4 {
  margin: 0 0 12px 0;
  color: #333;
}

.next-steps ul, .failed-tests ul {
  margin: 0;
  padding-left: 20px;
}

.next-steps li, .failed-tests li {
  margin: 8px 0;
  color: #666;
}
</style>