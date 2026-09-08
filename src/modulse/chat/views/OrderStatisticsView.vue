<template>
  <div class="order-statistics-page">
    <header class="statistics-header">
      <div class="header-main">
        <el-button class="back-button" :icon="ArrowLeft" circle @click="goBack" />
        <div>
          <div class="page-kicker">订单管理</div>
          <h1>统计查询</h1>
          <p>根据后端订单字段检索当前账号可访问的订单，并查看筛选结果统计。</p>
        </div>
      </div>

      <div class="header-actions">
        <el-button @click="goBack">订单磋商</el-button>
        <el-button type="primary" :icon="Refresh" :loading="loading" @click="refreshOrders">
          刷新数据
        </el-button>
      </div>
    </header>

    <main class="statistics-content">
      <el-card class="filter-card" shadow="never">
        <template #header>
          <div class="card-header">
            <div class="card-title">
              <el-icon><Search /></el-icon>
              <span>订单检索条件</span>
            </div>
            <el-button text :icon="Delete" @click="resetFilters">重置条件</el-button>
          </div>
        </template>

        <el-form :model="filterForm" label-position="top" @submit.prevent="runSearch">
          <div class="filter-grid">
            <el-form-item label="订单编号">
              <el-input
                v-model="filterForm.orderId"
                clearable
                placeholder="支持模糊查询"
                @keyup.enter="runSearch"
              />
            </el-form-item>

            <el-form-item label="上交订单ID">
              <el-input
                v-model="filterForm.bssOrderId"
                clearable
                placeholder="输入上交订单数字ID"
                @keyup.enter="runSearch"
              />
            </el-form-item>

            <el-form-item label="数据名称">
              <el-input
                v-model="filterForm.dataName"
                clearable
                placeholder="支持模糊查询"
                @keyup.enter="runSearch"
              />
            </el-form-item>

            <el-form-item label="交易状态">
              <el-select v-model="filterForm.flag" clearable placeholder="全部状态">
                <el-option label="全部状态" value="" />
                <el-option v-for="option in flagOptions" :key="option.value" :label="option.label" :value="String(option.value)" />
              </el-select>
            </el-form-item>

            <el-form-item label="契约关联">
              <el-select v-model="filterForm.contract" clearable placeholder="全部">
                <el-option label="全部" value="" />
                <el-option label="已关联契约" value="present" />
                <el-option label="未关联契约" value="absent" />
              </el-select>
            </el-form-item>

            <el-form-item label="父订单编号">
              <el-input
                v-model="filterForm.parentOrderId"
                clearable
                placeholder="查询争议关联订单"
                @keyup.enter="runSearch"
              />
            </el-form-item>

            <el-form-item label="异议原因">
              <el-input
                v-model="filterForm.objectionReason"
                clearable
                placeholder="支持模糊查询"
                @keyup.enter="runSearch"
              />
            </el-form-item>

            <el-form-item label="参与方">
              <el-input
                v-model="filterForm.participant"
                clearable
                placeholder="按参与方ID、用户名或数据名查询"
                @keyup.enter="runSearch"
              />
            </el-form-item>
          </div>

          <div class="filter-footer">
            <span class="data-scope">
              当前已加载 {{ allOrders.length }} 条订单
            </span>
            <el-button type="primary" :icon="Search" @click="runSearch">查询统计</el-button>
          </div>
        </el-form>
      </el-card>

      <el-alert
        v-if="loadError"
        class="load-error"
        :title="loadError"
        type="error"
        show-icon
        :closable="false"
      />

      <section class="summary-grid" aria-label="订单统计摘要">
        <el-card class="summary-card summary-total" shadow="never">
          <div class="summary-icon"><el-icon><DataAnalysis /></el-icon></div>
          <div>
            <div class="summary-label">筛选订单数</div>
            <div class="summary-value">{{ summary.total }}</div>
          </div>
        </el-card>

        <el-card class="summary-card summary-pending" shadow="never">
          <div class="summary-icon"><el-icon><Clock /></el-icon></div>
          <div>
            <div class="summary-label">待磋商</div>
            <div class="summary-value">{{ summary.pending }}</div>
          </div>
        </el-card>

        <el-card class="summary-card summary-success" shadow="never">
          <div class="summary-icon"><el-icon><CircleCheck /></el-icon></div>
          <div>
            <div class="summary-label">交付成功</div>
            <div class="summary-value">{{ summary.delivered }}</div>
          </div>
        </el-card>

        <el-card class="summary-card summary-objection" shadow="never">
          <div class="summary-icon"><el-icon><WarningFilled /></el-icon></div>
          <div>
            <div class="summary-label">存在异议</div>
            <div class="summary-value">{{ summary.objection }}</div>
          </div>
        </el-card>

        <el-card class="summary-card summary-contract" shadow="never">
          <div class="summary-icon"><el-icon><Document /></el-icon></div>
          <div>
            <div class="summary-label">已关联契约</div>
            <div class="summary-value">{{ summary.withContract }}</div>
          </div>
        </el-card>
      </section>

      <el-card class="results-card" shadow="never">
        <template #header>
          <div class="card-header results-header">
            <div>
              <div class="card-title">
                <el-icon><List /></el-icon>
                <span>订单查询结果</span>
              </div>
              <div class="result-caption">
                共 {{ filteredOrders.length }} 条匹配记录，显示第 {{ displayedRange.start }}-{{ displayedRange.end }} 条
              </div>
            </div>
            <el-tag type="info" effect="plain">数据来源：POST /order/queryOrders</el-tag>
          </div>
        </template>

        <el-table
          v-loading="loading"
          :data="paginatedOrders"
          row-key="orderId"
          border
          stripe
          table-layout="auto"
          class="order-table"
          empty-text="暂无符合条件的订单"
        >
          <el-table-column prop="id" label="数据库ID" width="100" />
          <el-table-column prop="orderId" label="订单编号" min-width="205" show-overflow-tooltip />
          <el-table-column prop="bssOrderId" label="上交订单ID" width="135" />
          <el-table-column prop="dataName" label="数据名称" min-width="160" show-overflow-tooltip />

          <el-table-column label="订单类型" width="145">
            <template #default="{ row }">
              <el-tag size="small" :type="row.orderType === 1 ? 'warning' : 'primary'">
                {{ getOrderTypeLabel(row.orderType) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="交易状态" width="125">
            <template #default="{ row }">
              <el-tag size="small" :type="getFlagType(row.flag)">
                {{ getFlagLabel(row.flag) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="契约" min-width="180">
            <template #default="{ row }">
              <div v-if="hasContract(row)" class="contract-cell">
                <el-tag size="small" type="success">已关联</el-tag>
                <el-tooltip :content="String(row.contract)" placement="top">
                  <span class="contract-value">{{ String(row.contract) }}</span>
                </el-tooltip>
              </div>
              <el-tag v-else size="small" type="info">未关联</el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="parentOrderId" label="父订单编号" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.parentOrderId">{{ row.parentOrderId }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>

          <el-table-column prop="objectionReason" label="异议原因" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.objectionReason">{{ row.objectionReason }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>

          <el-table-column label="参与方" min-width="240">
            <template #default="{ row }">
              <div v-if="row.participants?.length" class="participant-list">
                <el-tag
                  v-for="participant in row.participants"
                  :key="`${row.orderId}-${participant.userId}-${participant.roleType}`"
                  size="small"
                  effect="plain"
                >
                  {{ participant.username || `用户${participant.userId}` }}
                  · {{ participant.roleType === 0 ? "买方" : "卖方" }}
                  · {{ participant.reputationScore ?? 100 }}分
                </el-tag>
              </div>
              <span v-else class="muted">暂无参与方</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="pageSizes"
            :total="filteredOrders.length"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handlePageSizeChange"
            @current-change="handleCurrentPageChange"
          />
        </div>
      </el-card>

      <el-alert
        class="field-note"
        title="字段说明"
        type="info"
        show-icon
        :closable="false"
      >
        本页面使用后端订单返回的 orderId、dataName、flag、bssOrderId、contract、parentOrderId、objectionReason 及 participants 字段进行检索；结果范围受当前登录用户权限限制。
      </el-alert>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  ArrowLeft,
  CircleCheck,
  Clock,
  DataAnalysis,
  Delete,
  Document,
  List,
  Refresh,
  Search,
  WarningFilled,
} from "@element-plus/icons-vue";
import { useOrderStore } from "../../orders/store/order.store";
import type { Order } from "../../orders/types/order.types";

type ContractFilter = "" | "present" | "absent";

interface OrderFilters {
  orderId: string;
  bssOrderId: string;
  dataName: string;
  flag: string;
  contract: ContractFilter;
  parentOrderId: string;
  objectionReason: string;
  participant: string;
}

const router = useRouter();
const orderStore = useOrderStore();

const flagOptions = [
  { value: 1, label: "磋商成功（1）" },
  { value: 2, label: "磋商失败（2）" },
  { value: 3, label: "交付成功（3）" },
  { value: 4, label: "待磋商（4）" },
  { value: 5, label: "存在异议（5）" },
];

function createEmptyFilters(): OrderFilters {
  return {
    orderId: "",
    bssOrderId: "",
    dataName: "",
    flag: "",
    contract: "",
    parentOrderId: "",
    objectionReason: "",
    participant: "",
  };
}

const filterForm = reactive<OrderFilters>(createEmptyFilters());
const activeFilters = ref<OrderFilters>(createEmptyFilters());
const currentPage = ref(1);
const pageSize = ref(20);
const pageSizes = [20, 50, 100];
const loading = ref(false);
const loadError = ref("");

const allOrders = computed(() => orderStore.orderList);

function normalize(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim().toLowerCase();
}

function contains(value: unknown, keyword: string): boolean {
  return !keyword || normalize(value).includes(normalize(keyword));
}

function hasContract(order: Order): boolean {
  return order.contract !== null && order.contract !== undefined && String(order.contract).trim() !== "";
}

function participantMatches(order: Order, keyword: string): boolean {
  if (!keyword) return true;

  return (order.participants || []).some((participant) => {
    const fields = [
      participant.userId,
      participant.username,
      participant.dataName,
      participant.roleType === 0 ? "买方" : "卖方",
      participant.reputationScore,
    ];
    return fields.some((field) => contains(field, keyword));
  });
}

function matchesFilters(order: Order, filters: OrderFilters): boolean {
  if (!contains(order.orderId, filters.orderId)) return false;
  if (!contains(order.bssOrderId, filters.bssOrderId)) return false;
  if (!contains(order.dataName, filters.dataName)) return false;
  if (filters.flag && String(order.flag) !== filters.flag) return false;
  if (filters.contract === "present" && !hasContract(order)) return false;
  if (filters.contract === "absent" && hasContract(order)) return false;
  if (!contains(order.parentOrderId, filters.parentOrderId)) return false;
  if (!contains(order.objectionReason, filters.objectionReason)) return false;
  if (!participantMatches(order, filters.participant)) return false;
  return true;
}

const filteredOrders = computed(() =>
  allOrders.value.filter((order) => matchesFilters(order, activeFilters.value)),
);

const paginatedOrders = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredOrders.value.slice(start, start + pageSize.value);
});

const displayedRange = computed(() => {
  if (filteredOrders.value.length === 0) return { start: 0, end: 0 };
  const start = (currentPage.value - 1) * pageSize.value + 1;
  const end = Math.min(currentPage.value * pageSize.value, filteredOrders.value.length);
  return { start, end };
});

const summary = computed(() => {
  const orders = filteredOrders.value;
  return {
    total: orders.length,
    pending: orders.filter((order) => order.flag === 4).length,
    delivered: orders.filter((order) => order.flag === 3).length,
    objection: orders.filter((order) => order.flag === 5 || Boolean(order.parentOrderId || order.objectionReason)).length,
    withContract: orders.filter(hasContract).length,
  };
});

function runSearch() {
  activeFilters.value = { ...filterForm };
  currentPage.value = 1;
}

function resetFilters() {
  Object.assign(filterForm, createEmptyFilters());
  runSearch();
}

async function loadOrders(force = false) {
  loading.value = true;
  loadError.value = "";
  try {
    await orderStore.fetchMyOrders(force);
    runSearch();
  } catch (error: any) {
    console.error("[OrderStatistics] Load orders failed:", error);
    loadError.value = error?.message || "订单数据加载失败，请稍后重试";
    ElMessage.error(loadError.value);
  } finally {
    loading.value = false;
  }
}

async function refreshOrders() {
  await loadOrders(true);
}

function goBack() {
  router.push({ name: "ChatMain" });
}

function handlePageSizeChange(size: number) {
  pageSize.value = size;
  currentPage.value = 1;
}

function handleCurrentPageChange(page: number) {
  currentPage.value = page;
}

function getOrderTypeLabel(orderType: unknown): string {
  if (Number(orderType) === 0) return "两方/个人（0）";
  if (Number(orderType) === 1) return "多方（1）";
  return `未知（${String(orderType ?? "-")}）`;
}

function getFlagLabel(flag: unknown): string {
  const option = flagOptions.find((item) => item.value === Number(flag));
  return option?.label || `未知状态（${String(flag ?? "-")}）`;
}

function getFlagType(flag: unknown): "success" | "warning" | "danger" | "info" | "primary" {
  switch (Number(flag)) {
    case 3:
      return "success";
    case 4:
      return "warning";
    case 2:
    case 5:
      return "danger";
    case 1:
      return "primary";
    default:
      return "info";
  }
}

watch(filteredOrders, (orders) => {
  const maxPage = Math.max(1, Math.ceil(orders.length / pageSize.value));
  if (currentPage.value > maxPage) currentPage.value = maxPage;
});

onMounted(() => {
  void loadOrders(true);
});
</script>

<style scoped>
.order-statistics-page {
  min-height: 100vh;
  background: #f5f7fa;
  color: #303133;
}

.statistics-header {
  min-height: 76px;
  padding: 16px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 2px 8px rgba(31, 45, 61, 0.04);
}

.header-main,
.header-actions,
.card-title,
.card-header,
.filter-footer,
.results-header {
  display: flex;
  align-items: center;
}

.header-main {
  gap: 14px;
}

.header-actions {
  gap: 10px;
  flex-shrink: 0;
}

.back-button {
  flex-shrink: 0;
}

.page-kicker {
  margin-bottom: 2px;
  color: #909399;
  font-size: 12px;
  letter-spacing: 0.08em;
}

h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
}

.statistics-header p {
  margin: 4px 0 0;
  color: #909399;
  font-size: 13px;
}

.statistics-content {
  width: min(1600px, calc(100% - 48px));
  margin: 0 auto;
  padding: 24px 0 36px;
}

.filter-card,
.results-card {
  border: 1px solid #e4e7ed;
}

.card-header {
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  gap: 8px;
  color: #303133;
  font-weight: 600;
}

.card-title .el-icon {
  color: #409eff;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(210px, 1fr));
  gap: 0 20px;
}

.filter-grid :deep(.el-form-item) {
  margin-bottom: 18px;
}

.filter-grid :deep(.el-select),
.filter-grid :deep(.el-input) {
  width: 100%;
}

.filter-footer {
  justify-content: space-between;
  gap: 16px;
  padding-top: 4px;
  border-top: 1px solid #f0f2f5;
}

.data-scope,
.result-caption {
  color: #909399;
  font-size: 13px;
}

.load-error {
  margin-top: 16px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(150px, 1fr));
  gap: 16px;
  margin: 18px 0;
}

.summary-card :deep(.el-card__body) {
  min-height: 78px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.summary-card {
  border: 1px solid #e4e7ed;
}

.summary-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  font-size: 22px;
}

.summary-label {
  color: #909399;
  font-size: 13px;
}

.summary-value {
  margin-top: 3px;
  color: #303133;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}

.summary-total .summary-icon {
  color: #409eff;
  background: #ecf5ff;
}

.summary-pending .summary-icon {
  color: #e6a23c;
  background: #fdf6ec;
}

.summary-success .summary-icon {
  color: #67c23a;
  background: #f0f9eb;
}

.summary-objection .summary-icon {
  color: #f56c6c;
  background: #fef0f0;
}

.summary-contract .summary-icon {
  color: #8e44ad;
  background: #f5eef8;
}

.results-header {
  align-items: flex-start;
}

.results-header > div:first-child {
  min-width: 0;
}

.result-caption {
  margin-top: 5px;
}

.order-table {
  width: 100%;
}

.contract-cell,
.participant-list {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.participant-list {
  flex-wrap: wrap;
}

.contract-value {
  min-width: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #606266;
  font-size: 12px;
}

.muted {
  color: #c0c4cc;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  padding-top: 18px;
}

.field-note {
  margin-top: 18px;
}

@media (max-width: 1100px) {
  .filter-grid {
    grid-template-columns: repeat(2, minmax(210px, 1fr));
  }

  .summary-grid {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }
}

@media (max-width: 700px) {
  .statistics-header {
    align-items: flex-start;
    flex-direction: column;
    padding: 16px;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions .el-button {
    flex: 1;
  }

  .statistics-content {
    width: calc(100% - 24px);
    padding-top: 12px;
  }

  .filter-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .filter-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-wrapper {
    justify-content: center;
    overflow-x: auto;
  }

  .results-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
