<!-- chat/components/OrderDetail.vue -->
<template>
  <div class="order-detail">
    <!-- 头部 -->
    <div class="detail-header">
      <h3>订单详情</h3>
      <el-button text :icon="Close" @click="emit('close')" />
    </div>

    <el-scrollbar class="detail-content">
      <!-- 订单状态 -->
      <div class="detail-section">
        <div class="section-title">订单状态</div>
        <el-tag :type="statusType" size="large">
          {{ statusText }}
        </el-tag>
      </div>

      <!-- 订单信息 -->
      <div class="detail-section">
        <div class="section-title">基本信息</div>
        <div class="info-list">
          <div class="info-item">
            <span class="label">订单编号</span>
            <span class="value">{{
              orderInfo?.orderNo || order.id.slice(-12)
            }}</span>
          </div>
          <div class="info-item">
            <span class="label">创建时间</span>
            <span class="value">{{ formatDate(order.createdAt) }}</span>
          </div>
          <div class="info-item">
            <span class="label">订单类型</span>
            <el-tag
              :type="order.type === 'purchase' ? 'primary' : 'success'"
              size="small"
            >
              {{ order.type === "purchase" ? "我购买" : "我出售" }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 对方信息 -->
      <div class="detail-section">
        <div class="section-title">
          {{ order.type === "purchase" ? "卖方信息" : "买方信息" }}
        </div>
        <div class="party-info">
          <el-avatar :size="48">{{
            order.otherParty.name.charAt(0)
          }}</el-avatar>
          <div class="party-meta">
            <div class="party-name">{{ order.otherParty.name }}</div>
            <div class="party-id">ID: {{ order.otherParty.id.slice(-8) }}</div>
          </div>
        </div>
      </div>

      <!-- 商品信息 -->
      <div v-if="orderInfo?.goods" class="detail-section">
        <div class="section-title">商品信息</div>
        <div class="goods-info">
          <div class="goods-name">{{ orderInfo.goods.name }}</div>
          <div class="goods-details">
            <span
              >数量: {{ orderInfo.goods.quantity }}
              {{ orderInfo.goods.unit }}</span
            >
            <span>单价: ¥{{ orderInfo.goods.price }}</span>
          </div>
        </div>
      </div>

      <!-- 金额信息 -->
      <div class="detail-section">
        <div class="section-title">金额信息</div>
        <div class="amount-list">
          <div class="amount-item">
            <span>商品金额</span>
            <span class="amount">¥{{ order.amount }}</span>
          </div>
          <el-divider style="margin: 8px 0" />
          <div class="amount-item total">
            <span>总计</span>
            <span class="amount">¥{{ order.amount }}</span>
          </div>
        </div>
      </div>

      <!-- 合同列表 -->
      <div v-if="contracts.length > 0" class="detail-section">
        <div class="section-title">
          相关合同
          <el-badge :value="contracts.length" class="item-badge" />
        </div>
        <div class="contract-list">
          <div
            v-for="contract in contracts"
            :key="contract.id"
            class="contract-item"
            @click="handleViewContract(contract.id)"
          >
            <div class="contract-header">
              <el-icon color="#409EFF"><Document /></el-icon>
              <span class="contract-title">{{ contract.title }}</span>
            </div>
            <el-tag :type="getContractStatusType(contract.status)" size="small">
              {{ getContractStatusText(contract.status) }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="detail-actions">
        <el-button
          v-if="canCreateContract"
          type="primary"
          :icon="DocumentAdd"
          @click="emit('create-contract')"
          block
        >
          创建合同
        </el-button>

        <el-button
          v-if="order.status === 'active'"
          type="success"
          :icon="CircleCheck"
          @click="handleCompleteOrder"
          block
        >
          确认完成订单
        </el-button>

        <el-button :icon="MoreFilled" @click="showMoreActions" block>
          更多操作
        </el-button>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Close,
  Document,
  DocumentAdd,
  CircleCheck,
  MoreFilled,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../../auth/services/auth.store";
import { getOrderService } from "../../orders/services/order.service";
import { getContractService } from "../../contracts/services/contract.service";
import type { Order as ChatOrder } from "../types/chat.types";
import type { Order as FullOrder } from "../../orders/types/order.types";
import type { Contract } from "../../contracts/types/contract.types";

interface Props {
  order: ChatOrder;
}

interface Emits {
  (e: "close"): void;
  (e: "create-contract"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const router = useRouter();
const authStore = useAuthStore();

const orderInfo = ref<FullOrder | null>(null);
const contracts = ref<Contract[]>([]);

// const orderService = computed(() => getOrderService(authStore.user!.id));

const contractService = computed(() => getContractService(authStore.user!.id));

const statusType = computed(() => {
  const typeMap: Record<string, any> = {
    active: "primary",
    completed: "success",
    cancelled: "info",
    pending: "warning",
  };
  return typeMap[props.order.status] || "info";
});

// const statusText = computed(() =>
//   orderService.value.getOrderStatusText(
//     orderInfo.value?.status || props.order.status
//   )
// );

// const canCreateContract = computed(() => {
//   if (!orderInfo.value) return false;
//   return orderService.value.canCreateContract(orderInfo.value).allowed;
// });

// onMounted(async () => {
//   await loadOrderDetail();
//   await loadContracts();
// });

// async function loadOrderDetail() {
//   try {
//     const { order } = await orderService.value.getOrderWithConversation(
//       props.order.id
//     );
//     orderInfo.value = order;
//   } catch (error) {
//     console.error("Failed to load order detail:", error);
//   }
// }

async function loadContracts() {
  try {
    contracts.value = await contractService.value.getContractsByOrder(
      props.order.id
    );
  } catch (error) {
    console.error("Failed to load contracts:", error);
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getContractStatusType(status: string): string {
  const typeMap: Record<string, string> = {
    draft: "info",
    pending_signatures: "warning",
    signing: "primary",
    completed: "success",
    rejected: "danger",
    expired: "info",
  };
  return typeMap[status] || "info";
}

function getContractStatusText(status: string): string {
  const textMap: Record<string, string> = {
    draft: "草稿",
    pending_signatures: "待签署",
    signing: "签署中",
    completed: "已完成",
    rejected: "已拒绝",
    expired: "已过期",
  };
  return textMap[status] || "未知";
}

function handleViewContract(contractId: string) {
  router.push({
    name: "ContractSigning",
    params: { id: contractId },
  });
}

async function handleCompleteOrder() {
  try {
    await ElMessageBox.confirm(
      "确认完成此订单？完成后将无法继续发送消息。",
      "确认操作",
      {
        confirmButtonText: "确认完成",
        cancelButtonText: "取消",
        type: "warning",
      }
    );

    // 更新订单状态
    // TODO: 调用订单完成接口

    ElMessage.success("订单已完成");
  } catch {
    // 用户取消
  }
}

function showMoreActions() {
  ElMessage.info("更多操作功能开发中");
}
</script>

<style scoped>
.order-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.detail-header {
  height: 60px;
  padding: 0 20px;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-header h3 {
  margin: 0;
  font-size: 16px;
  color: #303133;
}

.detail-content {
  flex: 1;
  padding: 20px;
}

.detail-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.info-item .label {
  color: #909399;
}

.info-item .value {
  color: #303133;
  font-weight: 500;
}

.party-info {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.party-meta {
  flex: 1;
}

.party-name {
  font-size: 15px;
  font-weight: 500;
  color: #303133;
}

.party-id {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.goods-info {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.goods-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}

.goods-details {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #606266;
}

.amount-list {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px;
}

.amount-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: #606266;
}

.amount-item.total {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.amount-item .amount {
  color: #f56c6c;
  font-weight: 500;
}

.contract-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.contract-item {
  padding: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: all 0.3s;
}

.contract-item:hover {
  background: #f5f7fa;
  border-color: #409eff;
}

.contract-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.contract-title {
  font-size: 14px;
  color: #303133;
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #e4e7ed;
}
</style>