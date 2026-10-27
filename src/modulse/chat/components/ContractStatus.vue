<template>
  <el-dialog
    v-model="dialogVisible"
    title="合同状态"
    width="560px"
    destroy-on-close
    @close="handleClose"
  >
    <div v-if="!contractInfo" class="empty-container">
      <el-empty description="暂无合同信息" />
    </div>

    <div v-else class="contract-content">
      <el-card shadow="never">
        <div class="contract-header">
          <h3 class="contract-name">{{ contractName || "合同文件" }}</h3>
          <el-tag :type="statusType" size="small">{{ statusText }}</el-tag>
        </div>

        <el-descriptions title="合同信息" :column="1" border class="mt-4">
          <el-descriptions-item label="订单ID">
            {{ contractInfo.orderId }}
          </el-descriptions-item>
          <el-descriptions-item label="文件ID">
            {{ contractInfo.fileId }}
          </el-descriptions-item>
          <el-descriptions-item label="最后签署人ID">
            {{ contractInfo.lastSignUserId }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatTime(contractInfo.createTime) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="isPending"
          class="mt-4"
          :type="isInitiator ? 'info' : 'warning'"
          :closable="false"
          :title="
            isInitiator
              ? '该合同由您发起，正在等待对方签署或拒签'
              : '对方已发起合同，等待您签署'
          "
          :description="
            isInitiator
              ? '即使聊天记录已清理或端到端会话重置，对方仍可在订单内通过本入口签署；对方签署后本合同才会完成。'
              : '即使原聊天消息已不可见，您仍可在此直接签署或拒绝该合同，不依赖本地聊天记录。'
          "
        />
        <el-alert
          v-else
          class="mt-4"
          type="success"
          :closable="false"
          title="合同已完成双方签署"
        />
      </el-card>
    </div>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
      <el-button
        v-if="canDownload"
        :loading="downloading"
        @click="handleDownload"
      >
        下载合同
      </el-button>
      <template v-if="canAct">
        <el-button type="danger" :loading="rejecting" @click="handleReject">
          拒绝签署
        </el-button>
        <el-button type="primary" :loading="signing" @click="handleSign">
          同意签署
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { orderSignState } from "../../contracts/types/contract.types";
import { ContractApiService } from "../../contracts/services/contract-api.service";
import { ContractService } from "../../contracts/services/contract.service";

interface Props {
  visible: boolean;
  userId: string; // 当前登录用户（租户）ID
  contractInfo: orderSignState | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "triggerQueryContract"): void;
}>();

const dialogVisible = ref(props.visible);
const contractName = ref("");
const downloading = ref(false);
const signing = ref(false);
const rejecting = ref(false);

const api = new ContractApiService();

const isPending = computed(() => props.contractInfo?.status === 0);
const isInitiator = computed(
  () =>
    String(props.contractInfo?.lastSignUserId ?? "") === String(props.userId),
);
const canAct = computed(
  () => !!props.contractInfo && isPending.value && !isInitiator.value,
);
const canDownload = computed(() => !!props.contractInfo?.fileId);
const statusText = computed(() => {
  if (!props.contractInfo) return "";
  if (props.contractInfo.status === 1) return "已完成";
  return isInitiator.value ? "等待对方签署" : "待您签署";
});
const statusType = computed(() =>
  props.contractInfo?.status === 1 ? "success" : "warning",
);

function formatTime(time?: string): string {
  if (!time) return "";
  const date = new Date(String(time).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(time);
  return date.toLocaleString();
}

async function loadContractName(): Promise<void> {
  const fileId = props.contractInfo?.fileId;
  if (!fileId) {
    contractName.value = "";
    return;
  }
  try {
    const name = await api.getFileDownloadName(String(fileId));
    contractName.value = name || "";
  } catch (error) {
    console.warn("[ContractStatus] 获取合同名称失败", error);
    contractName.value = "";
  }
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/octet-stream" });
}

async function handleDownload(): Promise<void> {
  const fileId = props.contractInfo?.fileId;
  if (!fileId || downloading.value) return;
  downloading.value = true;
  try {
    const data = await api.downloadFileContentBase64(Number(fileId));
    if (!data?.fileContent) {
      throw new Error("合同文件不存在或下载失败");
    }
    const blob = base64ToBlob(data.fileContent);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      data.fileName ||
      contractName.value ||
      `合同_${props.contractInfo?.orderId || fileId}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error: any) {
    ElMessage.error(error?.message || "下载合同失败");
  } finally {
    downloading.value = false;
  }
}

async function handleSign(): Promise<void> {
  const info = props.contractInfo;
  if (!info || !canAct.value || signing.value) return;
  signing.value = true;
  try {
    const service = new ContractService(String(props.userId));
    const res = await service.agreeOderSign(
      info.orderId,
      String(info.fileId),
    );
    if (res?.code === 1) {
      ElMessage.success("签署成功");
      emit("triggerQueryContract");
      emit("update:visible", false);
    } else {
      ElMessage.error(
        typeof res?.data === "string" ? res.data : res?.msg || "签署失败",
      );
    }
  } catch (error: any) {
    ElMessage.error(error?.message || "签署失败");
  } finally {
    signing.value = false;
  }
}

async function handleReject(): Promise<void> {
  const info = props.contractInfo;
  if (!info || !canAct.value || rejecting.value) return;
  try {
    await ElMessageBox.confirm(
      "拒绝后该待签合同记录将被删除，确定拒绝吗？",
      "拒绝签署",
      { type: "warning", confirmButtonText: "确定拒绝", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  rejecting.value = true;
  try {
    const service = new ContractService(String(props.userId));
    const res = await service.rejectOderSign(info.orderId);
    if (res?.code === 1) {
      ElMessage.success("已拒绝该合同");
      emit("triggerQueryContract");
      emit("update:visible", false);
    } else {
      ElMessage.error(
        typeof res?.data === "string" ? res.data : res?.msg || "拒绝失败",
      );
    }
  } catch (error: any) {
    ElMessage.error(error?.message || "拒绝失败");
  } finally {
    rejecting.value = false;
  }
}

function handleClose(): void {
  emit("update:visible", false);
}

watch(dialogVisible, (value) => {
  emit("update:visible", value);
});

watch(
  () => props.visible,
  (value) => {
    dialogVisible.value = value;
    if (value) {
      loadContractName();
      // 打开弹窗时向父组件请求一次服务端刷新，避免状态过期
      emit("triggerQueryContract");
    }
  },
);

watch(
  () => props.contractInfo?.fileId,
  () => {
    if (props.visible) {
      loadContractName();
    }
  },
);
</script>

<style scoped>
.contract-content {
  padding: 2px;
}

.contract-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.contract-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  word-break: break-all;
}

.mt-4 {
  margin-top: 16px;
}

.empty-container {
  padding: 24px 0;
}
</style>
