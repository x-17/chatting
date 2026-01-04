<!-- chat/components/FileMessage.vue -->
<template>
  <div class="file-message-wrapper" :class="{ 'is-mine': isMine }">
    <div class="file-message">
      <!-- 头像 -->
      <el-avatar v-if="!isMine" :size="36" class="avatar">
        {{ senderInitial }}
      </el-avatar>

      <!-- 文件卡片 -->
      <div class="file-card" :class="{ mine: isMine }">
        <!-- 图片预览 -->
        <div v-if="isImage" class="image-preview">
          <el-image :src="imagePreviewUrl" :preview-src-list="[imagePreviewUrl]" fit="cover" lazy>
            <template #error>
              <div class="image-error">
                <el-icon>
                  <Picture />
                </el-icon>
                <span>加载失败</span>
              </div>
            </template>
            <template #placeholder>
              <div class="image-loading">
                <el-icon class="is-loading">
                  <Loading />
                </el-icon>
              </div>
            </template>
          </el-image>
        </div>

        <!-- 文件信息 -->
        <div class="file-info">
          <div class="file-header">
            <el-icon :size="24" color="#409EFF">
              <Document v-if="!isImage" />
              <Picture v-else />
            </el-icon>
            <div class="file-meta">
              <div class="file-name">{{ fileName }}</div>
              <div class="file-size">{{ formatFileSize(fileSize) }}</div>
            </div>
          </div>

          <!-- 下载按钮 -->
          <el-button v-if="!downloading" type="primary" size="small" :icon="Download" @click="handleDownload">
            下载
          </el-button>
          <el-button v-else type="info" size="small" :loading="true">
            下载中
          </el-button>
          <!-- 同意/拒绝按钮（仅非自己的文件显示） -->
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
  Picture,
  Download,
  Loading,
  CircleClose,
  Check,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import type { ChatMessage } from "../types/chat.types";
import { useOrderList } from "../../chat/composables/useOrderList";
import { el } from "element-plus/es/locales.mjs";
import { ContractService } from "../../contracts/services/contract.service";

interface Props {
  message: ChatMessage;
  isMine: boolean;
}

interface Emits {
  (e: "download", message: ChatMessage): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const authStore = useAuthStore();
const downloading = ref(false);
const contractLoading = ref(false);
let contractState = ref<boolean>(false);
const contractService = new ContractService(
  authStore.currentUserId ||
  sessionStorage.getItem("auth_current_user_id") ||
  ""
);

const currentUserInitial = computed(
  () => authStore.user?.userName.charAt(0).toUpperCase() || "U"
);

const senderInitial = computed(() =>
  props.message.senderId.charAt(0).toUpperCase()
);

const fileName = computed(() => props.message.metadata?.fileName || "未知文件");

const fileSize = computed(() => props.message.metadata?.fileSize || 0);

const isImage = computed(
  () =>
    props.message.type === "image" ||
    props.message.metadata?.mimeType?.startsWith("image/")
);
const isContract = computed(
  () => props.message.type === "contract"
  // props.message.metadata?.mimeType?.startsWith("image/")
);

const imagePreviewUrl = computed(() => {
  // 如果是图片消息，返回预览URL
  // 实际应该从服务器获取
  return props.message.metadata?.previewUrl || "";
});

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

    // 下载逻辑由父组件处理
    // 这里只显示加载状态
  } catch (error) {
    ElMessage.error("下载失败");
    console.error(error);
  } finally {
    downloading.value = false;
  }
}
onMounted(async () => {
  // 是否显示签署框
});
</script>

<style scoped>
.file-message-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.file-message-wrapper.is-mine {
  align-items: flex-end;
}

.file-message {
  display: flex;
  gap: 8px;
  max-width: 70%;
}

.avatar {
  flex-shrink: 0;
}

.file-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  min-width: 280px;
}

.file-card.mine {
  background: #ecf5ff;
}

.image-preview {
  width: 100%;
  max-width: 300px;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}

.image-preview :deep(.el-image) {
  width: 100%;
  height: 200px;
  display: block;
}

.image-error,
.image-loading {
  width: 100%;
  height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  color: #909399;
  gap: 8px;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.file-header {
  display: flex;
  gap: 12px;
  align-items: center;
}

.file-meta {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.time {
  font-size: 11px;
  color: #909399;
}

/* 按钮容器样式 */
.action-buttons {
  /* 按钮均匀排列 */
  display: flex;
  justify-content: space-around;
  /* 按钮之间的间距 */
  gap: 8px;
  /* 与上方文件信息区域的距离 */
  margin-top: 12px;
  /* 可选：增加底部内边距，避免紧贴容器边缘 */
  padding-bottom: 4px;
}

/* 可选：按钮悬停/激活状态微调（如需自定义） */
.action-buttons .el-button--success:hover {
  background-color: #41b883;
  /* 加深绿色 */
}

.action-buttons .el-button--danger:hover {
  background-color: #f56c6c;
  /* 加深红色 */
}
</style>
