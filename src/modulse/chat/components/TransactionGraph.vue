<template>
  <div class="transaction-graph-container" ref="chartRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';
import type { Order } from '../../orders/types/order.types';

const props = defineProps<{
  orders: Order[];
  currentUserId: string | number;
  currentUserName: string;
}>();

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

const initChart = () => {
  if (!chartRef.value) return;
  
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value);
  }
  
  const nodesMap = new Map<string, any>();
  const linksMap = new Map<string, any>();
  
  let realCenterId = String(props.currentUserId);
  
  // 尝试通过用户名从订单中找到真实的数据库 userId
  for (const order of props.orders) {
    if (!order.participants) continue;
    const me = order.participants.find(p => 
      String(p.userId) === realCenterId || 
      (p.username && p.username === props.currentUserName) ||
      (p.userName && p.userName === props.currentUserName)
    );
    if (me) {
      realCenterId = String(me.userId);
      break;
    }
  }

  // Center node
  nodesMap.set(realCenterId, {
    id: realCenterId,
    name: props.currentUserName,
    symbolSize: 60,
    category: 0
  });

  props.orders.forEach(order => {
    if (!order.participants) return;
    
    // Check if current user is in this order
    const isCurrentUserInvolved = order.participants.some(p => String(p.userId) === realCenterId);
    
    if (isCurrentUserInvolved) {
      order.participants.forEach(p => {
        const pId = String(p.userId);
        if (pId !== realCenterId) {
          // Add other participant as node
          if (!nodesMap.has(pId)) {
            nodesMap.set(pId, {
              id: pId,
              name: p.username || `用户 ${pId}`,
              symbolSize: 40,
              category: 1
            });
          }
          
          // Add link
          const linkId = `${realCenterId}-${pId}`;
          if (!linksMap.has(linkId)) {
            linksMap.set(linkId, {
              source: realCenterId,
              target: pId,
              value: 1,
              lineStyle: { width: 2 }
            });
          } else {
            const link = linksMap.get(linkId);
            link.value += 1;
            link.lineStyle.width = Math.min(10, link.value + 1);
          }
        }
      });
    }
  });

  const option = {
    color: ['#409EFF', '#67C23A'], // 全局调色盘：0号类为蓝色，1号类为绿色，确保图例与节点颜色统一
    tooltip: {
      formatter: function (params: any) {
        if (params.dataType === 'node') {
          return `用户: ${params.data.name}`;
        } else if (params.dataType === 'edge') {
          return `交易次数: ${params.data.value}`;
        }
      }
    },
    legend: [{
      data: ['我', '交易方']
    }],
    series: [
      {
        type: 'graph',
        layout: 'force',
        data: Array.from(nodesMap.values()),
        links: Array.from(linksMap.values()),
        categories: [
          { name: '我' },
          { name: '交易方' }
        ],
        roam: true,
        label: {
          show: true,
          position: 'right',
          formatter: '{b}'
        },
        edgeLabel: {
          show: true,
          formatter: function(params: any) {
            return params.data.value + '次';
          },
          fontSize: 12
        },
        force: {
          repulsion: 800,
          gravity: 0.1,
          edgeLength: 150,
          layoutAnimation: true
        },
        lineStyle: {
          color: 'source',
          curveness: 0.1
        }
      }
    ]
  };

  chartInstance.setOption(option);
};

onMounted(() => {
  // 延迟初始化以确保 Dialog 动画结束并渲染出完整的宽高
  setTimeout(() => {
    initChart();
    if (chartRef.value) {
      resizeObserver = new ResizeObserver(() => {
        if (chartInstance) {
          chartInstance.resize();
        }
      });
      resizeObserver.observe(chartRef.value);
    }
  }, 200);
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (chartInstance) {
    chartInstance.dispose();
  }
});

watch(() => props.orders, () => {
  initChart();
}, { deep: true });

</script>

<style scoped>
.transaction-graph-container {
  width: 100%;
  height: 600px;
}
</style>
