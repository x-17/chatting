<!-- chat/views/ContractSigningView.vue -->
<template>
  <div class="contract-signing-container">
    <!-- 顶部导航 -->
    <div class="page-header">
      <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
      <h2>合同签署</h2>
      <div class="header-actions">
        <el-button
          v-if="contract && canVerify"
          :icon="DocumentChecked"
          @click="handleVerify"
        >
          验证签名
        </el-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading" :size="48"><Loading /></el-icon>
      <p>加载中...</p>
    </div>

    <!-- 合同内容 -->
    <div v-else-if="contract" class="contract-content">
      <!-- 左侧：合同文档 -->
      <div class="contract-document-area">
        <el-card class="document-card">
          <template #header>
            <div class="document-header">
              <div>
                <h3>{{ contract.title }}</h3>
                <el-text type="info" size="small">
                  订单: {{ contract.orderId.slice(-8) }}
                </el-text>
              </div>
              <el-tag :type="statusTagType" size="large">
                {{ statusText }}
              </el-tag>
            </div>
          </template>

          <!-- 文件预览区 -->
          <div class="document-viewer">
            <iframe
              v-if="contract.fileId"
              :src="filePreviewUrl"
              class="file-iframe"
              frameborder="0"
            />
            <div v-else class="text-content">
              <pre>{{ contract.content }}</pre>
            </div>
          </div>

          <!-- 文件信息 -->
          <div class="document-footer">
            <div class="file-info">
              <el-icon><Document /></el-icon>
              <span>文件哈希: {{ contract.fileHash.substring(0, 16) }}...</span>
              <el-button text size="small" @click="copyFileHash">
                复制完整哈希
              </el-button>
            </div>
            <div class="created-info">
              <el-text type="info" size="small">
                创建于 {{ formatDateTime(contract.createdAt) }}
              </el-text>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 右侧：签署信息 -->
      <div class="signature-area">
        <!-- 签署进度 -->
        <el-card class="progress-card">
          <template #header>
            <h4>签署进度</h4>
          </template>

          <el-steps
            direction="vertical"
            :active="contract.currentSignerIndex"
            finish-status="success"
          >
            <el-step
              v-for="(participant, index) in contract.participants"
              :key="participant.userId"
            >
              <template #icon>
                <el-icon
                  v-if="participant.hasSigned"
                  color="#67C23A"
                  :size="20"
                >
                  <CircleCheckFilled />
                </el-icon>
                <el-icon
                  v-else-if="index === contract.currentSignerIndex"
                  color="#409EFF"
                  :size="20"
                >
                  <EditPen />
                </el-icon>
                <el-icon v-else color="#C0C4CC" :size="20">
                  <Clock />
                </el-icon>
              </template>

              <template #title>
                <div class="step-title">
                  <span class="order-number">{{
                    participant.signatureOrder
                  }}</span>
                  <span class="participant-name">{{
                    participant.userName
                  }}</span>
                  <el-tag
                    :type="participant.role === 'buyer' ? 'primary' : 'success'"
                    size="small"
                  >
                    {{ participant.role === "buyer" ? "买方" : "卖方" }}
                  </el-tag>
                </div>
              </template>

              <template #description>
                <div class="step-description">
                  <div class="credit-score">
                    信誉分: {{ participant.creditScore }}
                  </div>
                  <div v-if="participant.hasSigned" class="signed-info">
                    <el-icon color="#67C23A"><Check /></el-icon>
                    已签署于
                    {{ formatDateTime(participant.signatureRecord!.signedAt) }}
                  </div>
                  <div
                    v-else-if="index === contract.currentSignerIndex"
                    class="waiting-info"
                  >
                    <el-icon color="#E6A23C"><Timer /></el-icon>
                    等待签署
                  </div>
                  <div v-else class="pending-info">
                    <el-text type="info" size="small">等待轮次</el-text>
                  </div>
                </div>
              </template>
            </el-step>
          </el-steps>
        </el-card>

        <!-- 操作区 -->
        <el-card class="action-card">
          <!-- 当前轮到自己签署 -->
          <template v-if="isMyTurn && !alreadySigned">
            <el-alert
              title="请仔细阅读合同"
              type="warning"
              :closable="false"
              show-icon
            >
              签署后将生成不可篡改的数字签名，请确保您同意合同所有条款
            </el-alert>

            <div class="sign-checklist">
              <el-checkbox v-model="confirmRead">
                我已仔细阅读并理解合同全部内容
              </el-checkbox>
              <el-checkbox v-model="confirmAgree">
                我同意合同的所有条款并自愿签署
              </el-checkbox>
              <el-checkbox v-model="confirmLegal">
                我了解此签名具有法律效力
              </el-checkbox>
            </div>

            <el-button
              type="primary"
              size="large"
              :disabled="!canSign"
              :loading="signing"
              @click="handleSign"
              block
            >
              <el-icon><EditPen /></el-icon>
              确认签署
            </el-button>
          </template>

          <!-- 等待其他人签署 -->
          <template v-else-if="!isMyTurn && !alreadySigned">
            <el-alert
              :title="`当前轮到 ${currentSigner?.userName} 签署`"
              type="info"
              :closable="false"
              show-icon
            >
              请等待对方完成签署
            </el-alert>
          </template>

          <!-- 已经签署 -->
          <template v-else-if="alreadySigned">
            <el-result icon="success" title="您已完成签署">
              <template #sub-title>
                签署时间: {{ formatDateTime(mySignatureRecord?.signedAt || 0) }}
              </template>
              <template #extra>
                <el-button @click="handleViewMySignature">
                  查看我的签名详情
                </el-button>
              </template>
            </el-result>
          </template>

          <!-- 合同已完成 -->
          <template v-if="contract.status === 'completed'">
            <el-divider />
            <el-result icon="success" title="合同签署完成">
              <template #sub-title>
                所有参与方已完成签署，合同正式生效
              </template>
              <template #extra>
                <el-space>
                  <el-button
                    type="primary"
                    :icon="Download"
                    @click="handleDownloadContract"
                  >
                    下载合同
                  </el-button>
                  <el-button :icon="DocumentChecked" @click="handleVerify">
                    验证签名
                  </el-button>
                </el-space>
              </template>
            </el-result>
          </template>
        </el-card>

        <!-- 过期提示 -->
        <el-alert
          v-if="isExpired"
          title="合同已过期"
          type="error"
          :closable="false"
          show-icon
        >
          过期时间: {{ formatDateTime(contract.expiresAt!) }}
        </el-alert>
      </div>
    </div>

    <!-- 加载失败 -->
    <div v-else class="error-container">
      <el-result icon="error" title="加载失败" sub-title="无法加载合同信息">
        <template #extra>
          <el-button type="primary" @click="loadContract">重试</el-button>
        </template>
      </el-result>
    </div>

    <!-- 签名验证对话框 -->
    <el-dialog v-model="showVerifyDialog" title="签名验证结果" width="600px">
      <div v-if="verifying" class="verify-loading">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <p>正在验证签名...</p>
      </div>

      <div v-else-if="verifyResult" class="verify-result">
        <!-- 整体验证结果 -->
        <el-result
          :icon="verifyResult.isValid ? 'success' : 'error'"
          :title="verifyResult.isValid ? '验证通过' : '验证失败'"
        >
          <template #sub-title>
            <div class="verify-summary">
              <div>
                文件完整性:
                <el-tag
                  :type="verifyResult.fileIntegrity ? 'success' : 'danger'"
                >
                  {{ verifyResult.fileIntegrity ? "完整" : "已被篡改" }}
                </el-tag>
              </div>
            </div>
          </template>
        </el-result>

        <!-- 每个签名的验证结果 -->
        <el-divider />
        <div class="signature-results">
          <h4>各方签名验证</h4>
          <el-table :data="verifyResult.signatureResults" border>
            <el-table-column prop="signerId" label="签署人ID" width="150" />
            <el-table-column label="验证结果" align="center">
              <template #default="{ row }">
                <el-tag :type="row.isValid ? 'success' : 'danger'">
                  {{ row.isValid ? "有效" : "无效" }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <template #footer>
        <el-button @click="showVerifyDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowLeft,
  Loading,
  Document,
  CircleCheckFilled,
  EditPen,
  Clock,
  Check,
  Timer,
  Download,
  // DocumentChecked,
  DocumentChecked,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { getContractService } from "../../contracts/services/contract.service";
import type { Contract } from "../../contracts/types/contract.types";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const loading = ref(true);
const contract = ref<Contract | null>(null);
const signing = ref(false);
const verifying = ref(false);
const showVerifyDialog = ref(false);
const verifyResult = ref<any>(null);

// 签署确认选项
const confirmRead = ref(false);
const confirmAgree = ref(false);
const confirmLegal = ref(false);

const contractService = computed(() => getContractService(authStore.user!.id));

const filePreviewUrl = computed(() =>
  contract.value?.fileId
    ? `/api/contracts/files/${contract.value.fileId}/preview`
    : ""
);

const statusTagType = computed(() => {
  const typeMap: Record<string, any> = {
    completed: "success",
    signing: "warning",
    pending_signatures: "warning",
    rejected: "danger",
    expired: "info",
  };
  return typeMap[contract.value?.status || ""] || "info";
});

const statusText = computed(() => {
  const textMap: Record<string, string> = {
    draft: "草稿",
    pending_signatures: "待签署",
    signing: "签署中",
    completed: "已完成",
    rejected: "已拒绝",
    expired: "已过期",
  };
  return textMap[contract.value?.status || ""] || "未知";
});

const currentSigner = computed(
  () => contract.value?.participants[contract.value.currentSignerIndex]
);

const isMyTurn = computed(
  () => currentSigner.value?.userId === authStore.currentUserId
);

const alreadySigned = computed(
  () =>
    contract.value?.participants.find(
      (p) => p.userId === authStore.currentUserId
    )?.hasSigned || false
);

const mySignatureRecord = computed(
  () =>
    contract.value?.participants.find(
      (p) => p.userId === authStore.currentUserId
    )?.signatureRecord
);

const canSign = computed(
  () =>
    isMyTurn.value &&
    confirmRead.value &&
    confirmAgree.value &&
    confirmLegal.value &&
    !alreadySigned.value
);

const canVerify = computed(() => contract.value?.status === "completed");

const isExpired = computed(
  () => contract.value?.expiresAt && Date.now() > contract.value.expiresAt
);

onMounted(async () => {
  await loadContract();
});

async function loadContract() {
  loading.value = true;
  try {
    const contractId = route.params.id as string;
    contract.value = await contractService.value.getContract(contractId);
  } catch (error: any) {
    ElMessage.error("加载合同失败: " + error.message);
  } finally {
    loading.value = false;
  }
}

async function handleSign() {
  if (!canSign.value) return;

  try {
    const confirmed = await ElMessageBox.confirm(
      "确认签署此合同？签署后将无法撤销。",
      "确认签署",
      {
        confirmButtonText: "确认签署",
        cancelButtonText: "取消",
        type: "warning",
      }
    );

    if (!confirmed) return;

    signing.value = true;

    const result = await contractService.value.signContract(contract.value!.id);

    contract.value = result.contract;

    ElMessage.success("签署成功");

    if (result.isCompleted) {
      await ElMessageBox.alert(
        "所有参与方已完成签署，合同正式生效！",
        "签署完成",
        {
          confirmButtonText: "知道了",
          type: "success",
        }
      );
    }
  } catch (error: any) {
    if (error !== "cancel") {
      ElMessage.error(error.message || "签署失败");
    }
  } finally {
    signing.value = false;
  }
}

async function handleVerify() {
  if (!contract.value) return;

  showVerifyDialog.value = true;
  verifying.value = true;
  verifyResult.value = null;

  try {
    const result = await contractService.value.verifyContract(
      contract.value.id
    );
    verifyResult.value = result;

    if (result.isValid) {
      ElMessage.success("验证通过，合同有效");
    } else {
      ElMessage.error("验证失败，签名无效");
    }
  } catch (error: any) {
    ElMessage.error("验证失败: " + error.message);
  } finally {
    verifying.value = false;
  }
}

function handleDownloadContract() {
  if (!contract.value?.fileId) {
    ElMessage.warning("无法下载，合同没有文件");
    return;
  }

  const url = `/api/contracts/files/${contract.value.fileId}/download`;
  window.open(url, "_blank");
}

function handleViewMySignature() {
  if (!mySignatureRecord.value) return;

  ElMessageBox.alert(
    `
    签署时间: ${formatDateTime(mySignatureRecord.value.signedAt)}
    IP地址: ${mySignatureRecord.value.ipAddress || "未记录"}
    设备: ${mySignatureRecord.value.deviceInfo || "未记录"}
    `,
    "我的签名详情",
    {
      confirmButtonText: "关闭",
    }
  );
}

function copyFileHash() {
  if (!contract.value) return;

  navigator.clipboard.writeText(contract.value.fileHash);
  ElMessage.success("文件哈希已复制");
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

function handleBack() {
  router.back();
}
</script>

<style scoped>
.contract-signing-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.page-header {
  height: 64px;
  background: white;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-header h2 {
  margin: 0;
  flex: 1;
  font-size: 18px;
}

.loading-container,
.error-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.contract-content {
  flex: 1;
  display: flex;
  gap: 20px;
  padding: 20px;
  overflow: hidden;
}

.contract-document-area {
  flex: 1;
  min-width: 0;
}

.document-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.document-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.document-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.document-header h3 {
  margin: 0 0 4px 0;
}

.document-viewer {
  flex: 1;
  overflow: hidden;
}

.file-iframe {
  width: 100%;
  height: 100%;
}

.text-content {
  height: 100%;
  overflow: auto;
  padding: 20px;
  background: white;
}

.text-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  line-height: 1.8;
}

.document-footer {
  padding: 16px 20px;
  border-top: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}

.signature-area {
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.progress-card,
.action-card {
  flex-shrink: 0;
}

.step-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.order-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #409eff;
  color: white;
  border-radius: 50%;
  font-size: 12px;
  font-weight: bold;
}

.participant-name {
  font-weight: 500;
}

.step-description {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.signed-info,
.waiting-info {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sign-checklist {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 0;
}

.verify-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px;
}

.verify-result {
  padding: 20px 0;
}

.verify-summary {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.signature-results {
  padding: 0 20px;
}

.signature-results h4 {
  margin: 0 0 16px 0;
}
</style>
