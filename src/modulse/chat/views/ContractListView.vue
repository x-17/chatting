<!-- chat/views/ContractListView.vue -->
<template>
  <div class="contract-list-view">
    <!-- 顶部导航 -->
    <div class="page-header">
      <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
      <h2>合同列表</h2>
    </div>

    <!-- 筛选和搜索 -->
    <div class="filter-bar">
      <el-input
          v-model="searchKeyword"
          placeholder="搜索合同标题或订单"
          :prefix-icon="Search"
          clearable
          style="width: 300px;"
      />

      <el-select
          v-model="filterStatus"
          placeholder="状态筛选"
          clearable
          style="width: 150px;"
      >
        <el-option label="全部" value="" />
        <el-option label="待签署" value="pending_signatures" />
        <el-option label="签署中" value="signing" />
        <el-option label="已完成" value="completed" />
        <el-option label="已拒绝" value="rejected" />
        <el-option label="已过期" value="expired" />
      </el-select>

      <el-select
          v-model="filterOrder"
          placeholder="排序"
          style="width: 150px;"
      >
        <el-option label="创建时间降序" value="createdAt-desc" />
        <el-option label="创建时间升序" value="createdAt-asc" />
        <el-option label="完成时间降序" value="completedAt-desc" />
      </el-select>
    </div>

    <!-- 合同列表 -->
    <div class="contract-list-container">
      <el-empty v-if="filteredContracts.length === 0" description="暂无合同" />

      <div v-else class="contract-grid">
        <el-card
            v-for="contract in filteredContracts"
            :key="contract.id"
            class="contract-card"
            :class="{ clickable: true }"
            @click="handleViewContract(contract.id)"
        >
          <!-- 卡片头部 -->
          <template #header>
            <div class="card-header">
              <div class="header-left">
                <el-icon :size="24" color="#409EFF"><Document /></el-icon>
                <div>
                  <div class="contract-title">{{ contract.title }}</div>
                  <el-text type="info" size="small">
                    订单: #{{ contract.orderId.slice(-8) }}
                  </el-text>
                </div>
              </div>
              <el-tag :type="getStatusType(contract.status)">
                {{ getStatusText(contract.status) }}
              </el-tag>
            </div>
          </template>

          <!-- 卡片内容 -->
          <div class="card-content">
            <!-- 参与方 -->
            <div class="participants-summary">
              <el-text size="small" type="info">参与方:</el-text>
              <el-space :size="4" wrap>
                <el-tag
                    v-for="p in contract.participants"
                    :key="p.userId"
                    :type="p.hasSigned ? 'success' : 'info'"
                    size="small"
                >
                  {{ p.userName }}
                  <el-icon v-if="p.hasSigned"><Check /></el-icon>
                </el-tag>
              </el-space>
            </div>

            <!-- 签署进度 -->
            <div class="progress-info">
              <el-text size="small" type="info">签署进度:</el-text>
              <el-progress
                  :percentage="signatureProgress(contract)"
                  :status="contract.status === 'completed' ? 'success' : undefined"
              />
            </div>

            <!-- 时间信息 -->
            <div class="time-info">
              <div class="time-item">
                <el-icon><Calendar /></el-icon>
                <span>创建: {{ formatDate(contract.createdAt) }}</span>
              </div>
              <div v-if="contract.completedAt" class="time-item">
                <el-icon color="#67C23A"><CircleCheck /></el-icon>
                <span>完成: {{ formatDate(contract.completedAt) }}</span>
              </div>
              <div v-else-if="contract.expiresAt" class="time-item">
                <el-icon :color="isExpiringSoon(contract) ? '#F56C6C' : '#E6A23C'">
                  <Timer />
                </el-icon>
                <span>
                  {{ isExpired(contract) ? '已过期' : '过期' }}:
                  {{ formatDate(contract.expiresAt) }}
                </span>
              </div>
            </div>

            <!-- 我的签署状态 -->
            <div v-if="getMyParticipant(contract)" class="my-status">
              <template v-if="getMyParticipant(contract)!.hasSigned">
                <el-icon color="#67C23A"><CircleCheckFilled /></el-icon>
                <span>我已签署</span>
              </template>
              <template v-else-if="isMyTurn(contract)">
                <el-icon color="#E6A23C"><Warning /></el-icon>
                <span>等待我签署</span>
              </template>
              <template v-else>
                <el-icon color="#909399"><Clock /></el-icon>
                <span>等待其他人</span>
              </template>
            </div>
          </div>

          <!-- 操作按钮 -->
          <template #footer>
            <el-space>
              <el-button
                  size="small"
                  type="primary"
                  @click.stop="handleViewContract(contract.id)"
              >
                查看详情
              </el-button>
              <el-button
                  v-if="isMyTurn(contract) && !getMyParticipant(contract)?.hasSigned"
                  size="small"
                  type="success"
                  @click.stop="handleSignContract(contract.id)"
              >
                立即签署
              </el-button>
              <el-button
                  v-if="contract.status === 'completed'"
                  size="small"
                  :icon="Download"
                  @click.stop="handleDownload(contract)"
              >
                下载
              </el-button>
            </el-space>
          </template>
        </el-card>
      </div>

      <!-- 分页 -->
      <div v-if="filteredContracts.length > 0" class="pagination">
        <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :total="filteredContracts.length"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  ArrowLeft,
  Search,
  Document,
  Check,
  Calendar,
  CircleCheck,
  Timer,
  CircleCheckFilled,
  Warning,
  Clock,
  Download
} from '@element-plus/icons-vue';
import { useAuthStore } from '../../auth/services/auth.store';
import { getContractService } from '../../contracts/services/contract.service';
import type { Contract } from '../../contracts/types/contract.types';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const contracts = ref<Contract[]>([]);
const loading = ref(true);
const searchKeyword = ref('');
const filterStatus = ref('');
const filterOrder = ref('createdAt-desc');
const currentPage = ref(1);
const pageSize = ref(20);

const contractService = computed(() =>
    getContractService(authStore.user!.id)
);

// 过滤和排序后的合同列表
const filteredContracts = computed(() => {
  let result = contracts.value;

  // 搜索过滤
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(c =>
        c.title.toLowerCase().includes(keyword) ||
        c.orderId.toLowerCase().includes(keyword)
    );
  }

  // 状态过滤
  if (filterStatus.value) {
    result = result.filter(c => c.status === filterStatus.value);
  }

  // 排序
  result = [...result].sort((a, b) => {
    switch (filterOrder.value) {
      case 'createdAt-desc':
        return b.createdAt - a.createdAt;
      case 'createdAt-asc':
        return a.createdAt - b.createdAt;
      case 'completedAt-desc':
        return (b.completedAt || 0) - (a.completedAt || 0);
      default:
        return 0;
    }
  });

  return result;
});

onMounted(async () => {
  await loadContracts();
});

async function loadContracts() {
  loading.value = true;
  try {
    const orderId = route.query.orderId as string;

    if (orderId) {
      // 加载特定订单的合同
      contracts.value = await contractService.value.getContractsByOrder(orderId);
    } else {
      // 加载所有合同
      // TODO: 实现获取所有合同的API
      contracts.value = [];
    }
  } catch (error: any) {
    ElMessage.error('加载合同列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}

function getStatusType(status: Contract['status']): string {
  const typeMap: Record<Contract['status'], string> = {
    draft: 'info',
    pending_signatures: 'warning',
    signing: 'primary',
    completed: 'success',
    rejected: 'danger',
    expired: 'info'
  };
  return typeMap[status] || 'info';
}

function getStatusText(status: Contract['status']): string {
  const textMap: Record<Contract['status'], string> = {
    draft: '草稿',
    pending_signatures: '待签署',
    signing: '签署中',
    completed: '已完成',
    rejected: '已拒绝',
    expired: '已过期'
  };
  return textMap[status] || '未知';
}

function signatureProgress(contract: Contract): number {
  const total = contract.participants.length;
  const signed = contract.participants.filter(p => p.hasSigned).length;
  return Math.round((signed / total) * 100);
}

function getMyParticipant(contract: Contract) {
  return contract.participants.find(p => p.userId === authStore.user?.id);
}

function isMyTurn(contract: Contract): boolean {
  const currentSigner = contract.participants[contract.currentSignerIndex];
  return currentSigner?.userId === authStore.user?.id;
}

function isExpired(contract: Contract): boolean {
  return contract.expiresAt ? Date.now() > contract.expiresAt : false;
}

function isExpiringSoon(contract: Contract): boolean {
  if (!contract.expiresAt) return false;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return contract.expiresAt - Date.now() < threeDays;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function handleViewContract(contractId: string) {
  router.push({
    name: 'ContractSigning',
    params: { id: contractId }
  });
}

function handleSignContract(contractId: string) {
  router.push({
    name: 'ContractSigning',
    params: { id: contractId },
    query: { action: 'sign' }
  });
}

function handleDownload(contract: Contract) {
  if (!contract.fileId) {
    ElMessage.warning('无法下载，合同没有文件');
    return;
  }

  const url = `/api/contracts/files/${contract.fileId}/download`;
  window.open(url, '_blank');
}

function handleBack() {
  router.back();
}
</script>

<style scoped>
.contract-list-view {
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
  font-size: 18px;
}

.filter-bar {
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  gap: 12px;
}

.contract-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.contract-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.contract-card {
  transition: all 0.3s;
  cursor: pointer;
}

.contract-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.contract-title {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.participants-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.time-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #606266;
}

.time-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.my-status {
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.pagination {
  display: flex;
  justify-content: center;
  padding-top: 16px;
}

@media (max-width: 1400px) {
  .contract-grid {
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  }
}

@media (max-width: 768px) {
  .contract-grid {
    grid-template-columns: 1fr;
  }
}
</style>