<!-- chat/components/OrderList.vue -->
<template>
  <div class="order-list">
    <!-- 搜索和过滤 -->
    <div class="list-header">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索订单或对方"
        :prefix-icon="Search"
        clearable
      />
      <div class="filter-buttons">
        <el-button
          text
          :type="showUnreadOnly ? 'primary' : 'default'"
          @click="showUnreadOnly = !showUnreadOnly"
        >
          <el-badge :value="unreadCount" :hidden="unreadCount === 0">
            仅显示未读
          </el-badge>
        </el-button>
      </div>
    </div>

    <!-- 分组列表 -->
    <el-scrollbar class="list-content">
      <!-- 我的购买订单 -->
      <el-collapse v-model="activeCollapse" accordion>
        <el-collapse-item name="purchase-active">
          <template #title>
            <div class="collapse-title">
              <el-icon color="#409EFF"><ShoppingCart /></el-icon>
              <span>我的购买</span>
              <el-badge :value="purchaseActiveCount" class="item-badge" />
            </div>
          </template>

          <div class="order-group">
            <el-collapse v-model="purchaseSubCollapse">
              <el-collapse-item name="active" title="进行中">
                <OrderItem
                  v-for="order in filteredPurchaseActive"
                  :key="order.id"
                  :order="order"
                  :active="activeOrderId === order.id"
                  @click="handleSelect(order.id)"
                />
              </el-collapse-item>

              <el-collapse-item name="completed" title="已完成">
                <OrderItem
                  v-for="order in filteredPurchaseCompleted"
                  :key="order.id"
                  :order="order"
                  :active="activeOrderId === order.id"
                  :completed="true"
                  @click="handleSelect(order.id)"
                />
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-collapse-item>

        <!-- 我的出售订单 -->
        <el-collapse-item name="sale-active">
          <template #title>
            <div class="collapse-title">
              <el-icon color="#67C23A"><Sell /></el-icon>
              <span>我的出售</span>
              <el-badge :value="saleActiveCount" class="item-badge" />
            </div>
          </template>

          <div class="order-group">
            <el-collapse v-model="saleSubCollapse">
              <el-collapse-item name="active" title="进行中">
                <OrderItem
                  v-for="order in filteredSaleActive"
                  :key="order.id"
                  :order="order"
                  :active="activeOrderId === order.id"
                  @click="handleSelect(order.id)"
                />
              </el-collapse-item>

              <el-collapse-item name="completed" title="已完成">
                <OrderItem
                  v-for="order in filteredSaleCompleted"
                  :key="order.id"
                  :order="order"
                  :active="activeOrderId === order.id"
                  :completed="true"
                  @click="handleSelect(order.id)"
                />
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Search, ShoppingCart, Sell } from "@element-plus/icons-vue";
import OrderItem from "./OrderItem.vue";
import type { Order } from "../types/chat.types";

interface Props {
  orders: Order[];
  activeOrderId: string | null;
  purchaseActiveCount: number;
  saleActiveCount: number;
  unreadCount: number;
}

interface Emits {
  (e: "select", orderId: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const searchKeyword = ref("");
const showUnreadOnly = ref(false);
const activeCollapse = ref("purchase-active");
const purchaseSubCollapse = ref(["active"]);
const saleSubCollapse = ref(["active"]);

onMounted(async () => {});

// 过滤和分组
const filteredOrders = computed(() => {
  let filtered = props.orders;

  // 搜索过滤
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    filtered = filtered.filter(
      (order) =>
        order.title.toLowerCase().includes(keyword) ||
        order.otherParty.name.toLowerCase().includes(keyword)
    );
  }

  // 未读过滤
  if (showUnreadOnly.value) {
    filtered = filtered.filter((order) => order.unreadCount > 0);
  }

  return filtered;
});

const purchaseOrders = computed(() =>
  filteredOrders.value.filter((o) => o.type === "purchase")
);

const saleOrders = computed(() =>
  filteredOrders.value.filter((o) => o.type === "sale")
);

const filteredPurchaseActive = computed(() =>
  purchaseOrders.value.filter((o) => o.status === "active")
);

const filteredPurchaseCompleted = computed(() =>
  purchaseOrders.value.filter((o) => o.status === "completed")
);

const filteredSaleActive = computed(() =>
  saleOrders.value.filter((o) => o.status === "active")
);

const filteredSaleCompleted = computed(() =>
  saleOrders.value.filter((o) => o.status === "completed")
);

// const purchaseActiveCount = computed(
//   () =>
//     purchaseOrders.value.filter(
//       (o) => o.status === "active" && o.unreadCount > 0
//     ).length
// );

// const saleActiveCount = computed(
//   () =>
//     saleOrders.value.filter((o) => o.status === "active" && o.unreadCount > 0)
//       .length
// );

// const unreadCount = computed(() =>
//   props.orders.reduce((sum, order) => sum + order.unreadCount, 0)
// );

function handleSelect(orderId: string) {
  emit("select", orderId);
}
</script>

<style scoped>
.order-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.filter-buttons {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
}

.list-content {
  flex: 1;
}

.collapse-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.item-badge {
  margin-left: auto;
}

.order-group {
  padding: 0;
}

:deep(.el-collapse-item__header) {
  padding-left: 16px;
  font-weight: 500;
}

:deep(.el-collapse-item__content) {
  padding: 0;
}
</style>
