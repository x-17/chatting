<template>
  <div class="contract-message-wrapper" :class="{ 'is-mine': isMine }">
    <div class="contract-message">
      <!-- 头像 -->
      <el-avatar v-if="!isMine" :size="36" class="avatar">
        {{ senderInitial }}
      </el-avatar>

      <!-- 合同卡片 -->
      <div class="contract-card" :class="{ mine: isMine }">
        <!-- 卡片头部 -->
        <div class="contract-header">
          <div class="header-content">
            <el-icon :size="16" class="header-icon">
              <DocumentChecked />
            </el-icon>
            <span class="header-title">合同文件</span>
          </div>
          <div class="header-status" v-if="contractState == 0">
            <el-tag size="small" type="warning" effect="plain">待签署</el-tag>
          </div>
          <div class="header-status" v-else-if="contractState == 1">
            <el-tag size="small" type="warning" effect="plain">已完成</el-tag>
          </div>
          <div class="header-status" v-if="contractState == 2">
            <el-tag size="small" type="warning" effect="plain">已失效</el-tag>
          </div>
        </div>

        <!-- 文件主体内容 -->
        <div class="contract-body">
          <div class="file-info-row">
            <div class="file-icon-wrapper">
              <el-icon :size="32" color="#409EFF">
                <Document />
              </el-icon>
            </div>
            <div class="file-details">
              <div class="file-name" :title="fileName">{{ fileName }}</div>
              <div class="file-size">{{ formatFileSize(fileSize) }}</div>
            </div>
          </div>

          <!-- 操作按钮区域 -->
          <div class="action-area">
            <div class="primary-actions">
              <el-button class="action-btn" :class="{ 'is-loading': downloading }" type="primary" link size="small"
                @click="handleDownload">
                <el-icon>
                  <Download />
                </el-icon>
                {{ downloading ? '下载中' : '下载' }}
              </el-button>
              <el-divider direction="vertical" />
              <el-button class="action-btn" type="primary" link size="small" @click="handlePreview">
                <el-icon>
                  <View />
                </el-icon>
                预览
              </el-button>
            </div>
          </div>

          <!-- 签署操作区域 -->
          <div class="sign-actions" v-if="contractState === 0 && !isMine" v-loading="contractLoading">
            <div class="sign-divider"></div>
            <div class="sign-buttons">
              <el-button type="success" plain size="small" class="sign-btn" @click="handleContract('agree')">
                同意签署
              </el-button>
              <el-button type="danger" plain size="small" class="sign-btn" @click="handleContract('refuse')">
                拒绝签署
              </el-button>
            </div>
          </div>
        </div>

        <!-- 消息元数据 -->
        <div class="message-meta">
          <span class="time">{{ formatTime(message.timestamp) }}</span>
          <template v-if="isMine">
            <el-icon v-if="message.status === 'sending'" class="is-loading">
              <Loading />
            </el-icon>
            <el-icon v-else-if="message.status === 'failed'" color="#F56C6C">
              <CircleClose />
            </el-icon>
            <el-icon v-else color="#67C23A">
              <Check />
            </el-icon>
          </template>
        </div>
      </div>

      <!-- 我的头像 -->
      <el-avatar v-if="isMine" :size="36" class="avatar">
        {{ currentUserInitial }}
      </el-avatar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import {
  Document,
  Download,
  Loading,
  CircleClose,
  Check,
  View,
  DocumentChecked,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import type { ChatMessage } from "../types/chat.types";
import { ContractService } from "../../contracts/services/contract.service";

interface Props {
  message: ChatMessage;
  isMine: boolean;
}

interface Emits {
  (e: "download", message: ChatMessage): void;
  (e: "preview", message: ChatMessage): void;
  (e: "trigger-contract", isAgree: boolean, message: ChatMessage): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const downloading = ref(false);
const contractLoading = ref(false);
let contractState = ref<0 | 1 | 2>();
const contractService = new ContractService(
  authStore.currentUserId ||
  sessionStorage.getItem("auth_current_user_id") ||
  ""
);

function getInitial(value: unknown, fallback = "U"): string {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.charAt(0).toUpperCase() : fallback;
}

const currentUserInitial = computed(() =>
  getInitial(authStore.user?.userName)
);

const senderInitial = computed(() =>
  getInitial(props.message.senderId)
);

const fileName = computed(() => props.message.metadata?.fileName || "未知文件");

const fileSize = computed(() => props.message.metadata?.fileSize || 0);

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

async function handleDownload() {
  if (downloading.value) return;

  try {
    downloading.value = true;
    emit("download", props.message);
  } catch (error) {
    ElMessage.error("下载失败");
    console.error(error);
  } finally {
    downloading.value = false;
  }
}

function handlePreview() {
  emit("preview", props.message);
}

async function handleContract(params: string) {
  if (contractLoading.value) return;
  contractLoading.value = true;
  try {
    if (params === "agree") {
      const contract_res = await contractService.agreeOderSign(
        props.message.orderId!,
        props.message.metadata.fileId
      );
      ElMessage.success(contract_res.data);
      if (contract_res.code === 1) {
        contractState.value = 1;
      }
    } else {
      const reject_res = await contractService.rejectOderSign(
        props.message.orderId
      );
      ElMessage.success(reject_res.data);
      if (reject_res.code === 1) {
        contractState.value = 1;
      }
    }
  } catch (error: any) {
    console.log(error);
    ElMessage.error("操作失败");
  } finally {
    contractLoading.value = false;
  }
}

onMounted(async () => {
  if (props.message.type === "contract") {
    try {
      let res = await contractService.queryOrderSignState(
        props.message.orderId
      );
      if (res.code === 1) {
        if (typeof res.data !== "string" ) {
          contractState.value = res.data.status;
        }
      }
      else {
        contractState.value = 2
      }
    } catch (error) {
      console.log(error);
    }
  }
});
</script>

<style scoped>
.contract-message-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.contract-message-wrapper.is-mine {
  align-items: flex-end;
}

.contract-message {
  display: flex;
  gap: 8px;
  max-width: 85%;
}

.avatar {
  flex-shrink: 0;
  margin-top: 2px;
}

.contract-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  min-width: 280px;
  overflow: hidden;
  border-top: 3px solid #409EFF;
  /* Blue border for contracts */
  transition: all 0.3s ease;
}

.contract-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.contract-card.mine {
  background: #ecf5ff;
  /* Light blue background for mine */
}

.contract-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(64, 158, 255, 0.1);
  border-bottom: 1px solid rgba(64, 158, 255, 0.2);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #409EFF;
  font-weight: 600;
  font-size: 13px;
}

.contract-body {
  padding: 12px;
}

.file-info-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.file-icon-wrapper {
  padding: 8px;
  background: #f5f7fa;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.file-name {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
  line-height: 1.4;
  margin-bottom: 4px;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.file-size {
  font-size: 12px;
  color: #909399;
}

.action-area {
  display: flex;
  justify-content: flex-end;
}

.primary-actions {
  display: flex;
  align-items: center;
}

.action-btn {
  font-size: 13px;
}

.sign-actions {
  margin-top: 8px;
}

.sign-divider {
  height: 1px;
  background: #ebeef5;
  margin: 8px 0;
}

.sign-buttons {
  display: flex;
  gap: 12px;
}

.sign-btn {
  flex: 1;
}

.message-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 0 12px 8px;
  margin-top: -4px;
}

.time {
  font-size: 11px;
  color: #909399;
}
</style>
