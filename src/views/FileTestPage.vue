<template>
  <div class="file-transfer-container">
    <h2>文件端到端加密传输测试</h2>

    <!-- 环境状态 -->
    <div class="status-bar">
      <el-tag :type="environmentStatus.type">{{ environmentStatus.text }}</el-tag>
      <el-tag v-if="activeTransfers.length > 0" type="warning">
        {{ activeTransfers.length }} 个传输进行中
      </el-tag>
    </div>

    <el-row :gutter="20">
      <!-- 控制面板 -->
      <el-col :span="12">
        <el-card>
          <template #header>文件传输控制</template>

          <!-- 文件选择 -->
          <div class="section">
            <h4>选择文件</h4>
            <input
                type="file"
                ref="fileInputRef"
                @change="handleFileSelect"
                accept=".pdf,.doc,.docx,.txt,.jpg,.png,.zip"
                multiple
            />
            <div v-if="selectedFiles.length > 0" class="file-list">
              <div v-for="(file, index) in selectedFiles" :key="index" class="file-item">
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">({{ formatFileSize(file.size) }})</span>
                <el-button size="small" type="danger" @click="removeFile(index)">移除</el-button>
              </div>
            </div>
          </div>

          <el-divider />

          <!-- 传输方式选择 -->
          <div class="section">
            <h4>传输方式</h4>
            <el-radio-group v-model="transferMode">
              <el-radio label="p2p">一对一传输</el-radio>
              <el-radio label="group">群组传输</el-radio>
            </el-radio-group>

            <!-- 接收者选择 -->
            <div class="recipient-selection" v-if="transferMode === 'p2p'">
              <el-select v-model="selectedRecipient" placeholder="选择接收者">
                <el-option
                    v-for="user in availableUsers"
                    :key="user"
                    :label="user"
                    :value="user"
                />
              </el-select>
            </div>

            <!-- 群组选择 -->
            <div class="group-selection" v-if="transferMode === 'group'">
              <el-select v-model="selectedGroup" placeholder="选择群组">
                <el-option
                    v-for="group in availableGroups"
                    :key="group.id"
                    :label="group.name"
                    :value="group.id"
                />
              </el-select>
            </div>
          </div>

          <el-divider />

          <!-- 传输操作 -->
          <div class="section">
            <el-button
                type="primary"
                @click="startTransfer"
                :disabled="!canStartTransfer"
                :loading="isTransferring"
                style="width: 100%;"
            >
              {{ isTransferring ? '传输中...' : '开始加密传输' }}
            </el-button>
          </div>
        </el-card>
      </el-col>

      <!-- 状态显示 -->
      <el-col :span="12">
        <el-card>
          <template #header>传输状态</template>

          <!-- 活跃传输 -->
          <div class="section">
            <h4>当前传输</h4>
            <div v-if="activeTransfers.length === 0" class="no-transfers">
              暂无活跃传输
            </div>
            <div v-for="transfer in activeTransfers" :key="transfer.fileId" class="transfer-item">
              <div class="transfer-header">
                <span class="file-name">{{ transfer.fileName }}</span>
                <span class="transfer-stage">{{ getStageText(transfer.stage) }}</span>
              </div>
              <el-progress
                  :percentage="transfer.percentage"
                  :status="getProgressStatus(transfer.stage)"
              />
              <div class="transfer-details">
                <span>{{ formatFileSize(transfer.loaded) }} / {{ formatFileSize(transfer.total) }}</span>
                <span v-if="transfer.speed">{{ transfer.speed }}</span>
              </div>
            </div>
          </div>

          <el-divider />

          <!-- 接收的文件 -->
          <div class="section">
            <h4>接收到的文件</h4>
            <div v-if="receivedFiles.length === 0" class="no-files">
              暂无接收文件
            </div>
            <div v-for="file in receivedFiles" :key="file.fileId" class="received-file">
              <div class="file-header">
                <span class="file-name">{{ file.originalName }}</span>
                <span class="file-sender">来自: {{ file.senderId }}</span>
              </div>
              <div class="file-actions">
                <el-button size="small" @click="downloadFile(file)" :disabled="file.isDownloading">
                  {{ file.isDownloading ? '下载中...' : '下载' }}
                </el-button>
                <el-tag :type="file.isVerified ? 'success' : 'danger'" size="small">
                  {{ file.isVerified ? '已验证' : '未验证' }}
                </el-tag>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 传输日志 -->
    <el-card style="margin-top: 20px;">
      <template #header>
        <div class="card-header">
          <span>传输日志</span>
          <el-button size="small" @click="clearLogs">清空</el-button>
        </div>
      </template>
      <el-scrollbar height="200px">
        <div class="logs-container">
          <div v-for="(log, index) in transferLogs" :key="index" class="log-entry" :class="log.type">
            <span class="log-time">{{ log.timestamp }}</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </el-scrollbar>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { getFileRouter, type FileMessageRouter } from '../modulse/utils/file-message-router.ts';
import type { FileUploadProgress } from '../modulse/utils/file-encryption.service.ts';

// 状态定义
const fileInputRef = ref<HTMLInputElement>();
const selectedFiles = ref<File[]>([]);
const transferMode = ref<'p2p' | 'group'>('p2p');
const selectedRecipient = ref('');
const selectedGroup = ref('');
const isTransferring = ref(false);

// 用户数据
const currentUser = 'alice'; // 当前用户
const availableUsers = ['bob', 'carol', 'dave'];
const availableGroups = [
  { id: 'group1', name: '测试群组1' },
  { id: 'group2', name: '测试群组2' }
];

// 传输状态
const activeTransfers = ref<Array<{
  fileId: string;
  fileName: string;
  stage: FileUploadProgress['stage'];
  loaded: number;
  total: number;
  percentage: number;
  speed?: string;
  error?: string;
}>>([]);

// 接收文件
const receivedFiles = ref<Array<{
  fileId: string;
  originalName: string;
  senderId: string;
  mimeType: string;
  size: number;
  isVerified: boolean;
  isDownloading: boolean;
  downloadUrl?: string;
}>>([]);

// 日志
const transferLogs = ref<Array<{
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}>>([]);

// 路由器实例
const fileRouter: FileMessageRouter = getFileRouter(currentUser);

// 计算属性
const environmentStatus = computed(() => {
  if (isTransferring.value) {
    return { type: 'warning', text: '传输中' };
  } else if (activeTransfers.value.length > 0) {
    return { type: 'primary', text: '有活跃传输' };
  } else {
    return { type: 'success', text: '就绪' };
  }
});

const canStartTransfer = computed(() => {
  return selectedFiles.value.length > 0 &&
      !isTransferring.value &&
      ((transferMode.value === 'p2p' && selectedRecipient.value) ||
          (transferMode.value === 'group' && selectedGroup.value));
});

// 工具函数
const getTimestamp = () => new Date().toLocaleTimeString();

const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
  transferLogs.value.push({
    timestamp: getTimestamp(),
    message,
    type
  });
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getStageText = (stage: FileUploadProgress['stage']): string => {
  switch (stage) {
    case 'encrypting': return '加密中';
    case 'uploading': return '上传中';
    case 'complete': return '完成';
    case 'error': return '错误';
    default: return '处理中';
  }
};

const getProgressStatus = (stage: FileUploadProgress['stage']) => {
  switch (stage) {
    case 'complete': return 'success';
    case 'error': return 'exception';
    default: return undefined;
  }
};

// 事件处理
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files) {
    const newFiles = Array.from(target.files);
    selectedFiles.value.push(...newFiles);
    addLog(`选择了 ${newFiles.length} 个文件`);
  }
};

const removeFile = (index: number) => {
  const removed = selectedFiles.value.splice(index, 1);
  addLog(`移除文件: ${removed[0].name}`);
};

const startTransfer = async () => {
  if (!canStartTransfer.value) return;

  isTransferring.value = true;
  addLog(`开始传输 ${selectedFiles.value.length} 个文件`, 'info');

  try {
    for (const file of selectedFiles.value) {
      await transferSingleFile(file);
    }

    addLog('所有文件传输完成', 'success');
    ElMessage.success('文件传输完成！');

    // 清空选择
    selectedFiles.value = [];
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }

  } catch (error) {
    addLog(`传输失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
    ElMessage.error('文件传输失败！');
  } finally {
    isTransferring.value = false;
  }
};

const transferSingleFile = async (file: File): Promise<void> => {
  const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  // 初始化传输状态
  const transferState = reactive({
    fileId,
    fileName: file.name,
    stage: 'encrypting' as FileUploadProgress['stage'],
    loaded: 0,
    total: file.size,
    percentage: 0
  });

  activeTransfers.value.push(transferState);

  // 设置进度回调
  fileRouter.onUploadProgress(fileId, (progress: FileUploadProgress) => {
    transferState.stage = progress.stage;
    transferState.loaded = progress.loaded;
    transferState.percentage = Math.round((progress.loaded / progress.total) * 100);

    if (progress.error) {
      transferState.error = progress.error;
      addLog(`${file.name}: ${progress.error}`, 'error');
    }
  });

  try {
    let result;

    if (transferMode.value === 'p2p') {
      result = await fileRouter.sendP2PFile(file, selectedRecipient.value);
    } else {
      result = await fileRouter.sendGroupFile(file, selectedGroup.value);
    }

    if (result.success) {
      transferState.stage = 'complete';
      transferState.percentage = 100;
      addLog(`${file.name} 传输成功`, 'success');
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    transferState.stage = 'error';
    transferState.error = error instanceof Error ? error.message : String(error);
    addLog(`${file.name} 传输失败: ${transferState.error}`, 'error');
    throw error;
  } finally {
    // 3秒后移除完成的传输
    setTimeout(() => {
      const index = activeTransfers.value.findIndex(t => t.fileId === fileId);
      if (index >= 0) {
        activeTransfers.value.splice(index, 1);
      }
    }, 3000);
  }
};

const downloadFile = async (fileInfo: any) => {
  if (fileInfo.isDownloading) return;

  fileInfo.isDownloading = true;
  addLog(`开始下载: ${fileInfo.originalName}`, 'info');

  try {
    // 这里应该调用实际的下载逻辑
    const result = await fileRouter.downloadFile(
        fileInfo.filePackage,
        fileInfo.senderId,
        fileInfo.isGroup,
        fileInfo.groupId
    );

    if (result.success) {
      // 创建下载链接并触发下载
      const link = document.createElement('a');
      link.href = result.data.downloadUrl;
      link.download = result.data.originalName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addLog(`${fileInfo.originalName} 下载成功`, 'success');
      ElMessage.success('文件下载成功！');
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    addLog(`下载失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
    ElMessage.error('文件下载失败！');
  } finally {
    fileInfo.isDownloading = false;
  }
};

const clearLogs = () => {
  transferLogs.value = [];
};

// 模拟接收文件（实际应用中通过消息路由器触发）
const simulateReceiveFile = (filePackage: any, senderId: string, isGroup: boolean = false) => {
  receivedFiles.value.push({
    fileId: filePackage.fileId,
    originalName: filePackage.originalName || `文件_${filePackage.fileId}`,
    senderId,
    mimeType: filePackage.mimeType || 'application/octet-stream',
    size: filePackage.size || 0,
    isVerified: true,
    isDownloading: false,
    ...filePackage
  });

  addLog(`收到来自 ${senderId} 的文件: ${filePackage.originalName}`, 'info');
};

// 组件初始化
addLog('文件传输模块已初始化', 'info');
</script>

<style scoped>
.file-transfer-container {
  padding: 20px;
}

.status-bar {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
  align-items: center;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section {
  margin-bottom: 20px;
}

.section h4 {
  margin: 0 0 10px 0;
  color: #303133;
  font-size: 14px;
}

.file-list {
  margin-top: 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 10px;
}

.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f5f7fa;
}

.file-item:last-child {
  border-bottom: none;
}

.file-name {
  font-weight: 500;
  color: #303133;
}

.file-size {
  color: #909399;
  font-size: 12px;
  margin-left: 8px;
}

.recipient-selection, .group-selection {
  margin-top: 10px;
}

.no-transfers, .no-files {
  text-align: center;
  color: #909399;
  font-style: italic;
  padding: 20px;
}

.transfer-item {
  margin-bottom: 15px;
  padding: 15px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background-color: #fafafa;
}

.transfer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.transfer-stage {
  font-size: 12px;
  color: #606266;
}

.transfer-details {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 12px;
  color: #909399;
}

.received-file {
  margin-bottom: 10px;
  padding: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background-color: #fafafa;
}

.file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.file-sender {
  font-size: 12px;
  color: #909399;
}

.file-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.logs-container {
  padding: 10px;
}

.log-entry {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #f5f7fa;
  font-size: 13px;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: #909399;
  font-family: monospace;
  min-width: 70px;
}

.log-message {
  flex: 1;
}

.log-entry.success {
  color: #67c23a;
}

.log-entry.error {
  color: #f56c6c;
}

.log-entry.warning {
  color: #e6a23c;
}

.log-entry.info {
  color: #606266;
}
</style>