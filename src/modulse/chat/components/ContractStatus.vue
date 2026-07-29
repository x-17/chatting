<template>
  <el-dialog
    v-model="dialogVisible"
    title="合同状态"
    width="500px"
    destroy-on-close
    @close="handleClose"
  >
    <!-- ����״̬ -->
    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="4" animated />
    </div>

    <!-- ����״̬ -->
    <div v-else-if="errorMsg" class="error-container">
      <el-icon color="error" class="mr-2"><WarningFilled /></el-icon>
      <span>{{ errorMsg }}</span>
    </div>

    <!-- ��ͬ���� -->
    <div v-else-if="contractInfo" class="contract-content">
      <el-card>
        <div class="contract-header">
          <h3 class="contract-name">
            {{ contractName || "获取合同名称中..." }}
          </h3>
          <el-tag :type="statusType" size="small">
            {{ statusText }}
          </el-tag>
        </div>

        <el-descriptions title="合同信息" :column="1" border class="mt-4">
          <el-descriptions-item label="订单ID">
            {{ contractInfo.orderId }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatTime(contractInfo.createTime) }}
          </el-descriptions-item>
          <el-descriptions-item label="最后签署人ID">
            {{ contractInfo.lastSignUserId }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>

    <!-- �޺�ͬ���� -->
    <div v-else class="empty-container">
      <el-empty description="暂无合同信息" />
    </div>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
      <el-button
        type="primary"
        @click="handleViewContract"
        :disabled="!contractInfo?.fileId || !contractName"
      >
        查看合同
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { WarningFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import type { orderSignState } from "../../contracts/types/contract.types";
import { ContractApiService } from "../../contracts/services/contract-api.service";

// 组件属性接口
interface Props {
  visible: boolean; // 控制弹窗显示
  userId: string; // 订单ID，用于查询合同
  contractInfo: orderSignState | null; // 当前用户ID
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "triggerQueryContract");
}>();
const dialogVisible = ref(props.visible);

// 状态管理
const loading = ref(false);
const errorMsg = ref("");
const contractName = ref<string | null>(null);
const contractService = new ContractApiService();

// 计算属性：合同状态文本和样式
const statusText = computed(() => {
  // if (props.contractInfo === null) return "无合同";
  return props.contractInfo?.status === 1 ? "已签署" : "一方签署";
});

const statusType = computed(() => {
  return props.contractInfo?.status === 1 ? "success" : "info";
});

// 格式化时间
const formatTime = (time?: string) => {
  if (!time) return "";
  return new Date(time).toLocaleString();
};

// 获取合同名称
const fetchContractName = async (fileId: string) => {
  try {
    const name = await contractService.getFileDownloadName(fileId);
    contractName.value = name || "获取合同信息失败";
  } catch (err) {
    contractName.value = "查询合同状态失败，请重试";
    console.error("合同查询错误:", err);
  }
};

// �鿴��ͬ
const handleViewContract = () => {
  //   if (!props.contractInfo?.fileId) return;
  //   // �����滻Ϊʵ�ʵĺ�ͬ�鿴�߼������PDF���ӣ�
  //   window.open(`/contract/view?fileId=${contractInfo.value.fileId}`, "_blank");
};

// �رյ���
const handleClose = () => {
  emit("update:visible", false);
};

// 监听弹窗显示状态，加载数据
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      fetchContractName(String(props.contractInfo?.fileId) || "");
      emit("triggerQueryContract");
    } else {
      // �ر�ʱ��������
      // props.contractInfo = null;
      contractName.value = null;
      errorMsg.value = "";
    }
  },
);
watch(dialogVisible, (newVal) => {
  emit("update:visible", newVal);
});

// ������������ݵ� visible �仯��ͬ�����ڲ�״̬
watch(
  () => props.visible,
  (newVal) => {
    dialogVisible.value = newVal;
  },
);
</script>

<style scoped>
.loading-container {
  padding: 20px 0;
}

.error-container {
  color: #f56c6c;
  padding: 20px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.contract-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contract-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.empty-container {
  padding: 40px 0;
}
</style>
