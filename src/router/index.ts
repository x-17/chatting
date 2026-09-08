// router/index.ts

import { createRouter, createWebHashHistory } from "vue-router";
import { useAuthStore } from "../modulse/auth/services/auth.store";
import { useOrderStore } from "../modulse/orders/store/order.store";

// 从各个模块导入路由定义
import { authRoutes } from "../modulse/auth/router";
import { chatRoutes } from "../modulse/chat/router";

// 测试路由
const e2eeTestRoutes = [
  {
    path: "/e2ee-test",
    name: "E2eeTestPage",
    component: () => import("../views/E2eeTestPage.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/e2eegroup-test",
    name: "GroupChatTestPage",
    component: () => import("../views/GroupChatTest.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/file-test",
    name: "FileTestPage",
    component: () => import("../views/FileTestPage.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/mock-test",
    name: "MockChatTest",
    component: () => import("../views/MockChatTest.vue"),
  },
  {
    path: "/complete-test",
    name: "CompleteTest",
    component: () => import("../views/E2eeCompleteTest.vue"),
    meta: { requiresAuth: false }, // 测试页面不需要登录
  },
  {
    path: "/complete-test2",
    name: "CompleteTest2",
    component: () => import("../views/E2eeCompleteTest2.vue"),
    meta: { requiresAuth: false }, // 测试页面不需要登录
  },
  {
    path: "/key-test",
    name: "KeyTest",
    component: () => import("../views/keytest.vue"),
    meta: { requiresAuth: false }, // 测试页面不需要登录
  },
];

// 合同相关路由
const contractRoutes = [
  {
    path: "/contracts",
    name: "ContractList",
    component: () => import("../modulse/chat/views/ContractListView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/contracts/:id",
    name: "ContractSigning",
    component: () => import("../modulse/chat/views/ContractSigningView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/order-statistics",
    name: "OrderStatistics",
    component: () => import("../modulse/chat/views/OrderStatisticsView.vue"),
    meta: { requiresAuth: true, title: "订单统计查询" },
  },
];

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      redirect: "/auth/shangjiao/callback",
    },
    // 合并所有模块的路由
    ...authRoutes,
    ...chatRoutes,
    ...contractRoutes,
    ...e2eeTestRoutes,

    // 404 页面
    {
      path: "/:pathMatch(.*)*",
      name: "NotFound",
      component: () => import("../views/NotFound.vue"),
    },
  ],
});

/**
 * 全局前置导航守卫
 */
router.beforeEach(async (to, _from, next) => {
  console.log(`[Router] Navigating to: ${to.name as string}`);

  const authStore = useAuthStore();
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth);
  if (requiresAuth && !authStore.isAuthenticated) {
    await authStore.initializeAuth();
  }

  if (requiresAuth && !authStore.isAuthenticated) {
    next({
      name: "Login",
      query: authStore.errorMessage
        ? { reason: "key-verification" }
        : undefined,
    });
    return;
  }

  next(); // 直接放行所有路由
  return;
  // const authStore = useAuthStore();
  // const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
  //
  // console.log(`[Router] Navigating to: ${to.name as string}`);
  //
  // // 1. 检查是否需要认证
  // if (requiresAuth && !authStore.isAuthenticated) {
  //     console.log('[Router] Auth required but user not authenticated');
  //
  //     // 保存原始目标路径，登录后重定向
  //     return next({
  //         name: 'Login',
  //         query: {
  //             redirect: to.fullPath
  //         }
  //     });
  // }
  //
  // // 2. 如果已登录且访问登录页，重定向到聊天页
  // if (authStore.isAuthenticated && to.name === 'Login') {
  //     console.log('[Router] Already authenticated, redirect to chat');
  //     return next({ name: 'ChatMain' });
  // }
  //
  // // 3. 预加载数据：访问聊天或合同页面时加载订单数据
  // if (authStore.isAuthenticated && shouldPreloadOrders(to.name as string)) {
  //     const orderStore = useOrderStore();
  //
  //     try {
  //         // 只在订单数据为空或距离上次加载超过5分钟时重新加载
  //         const needsRefresh = orderStore.myOrderIds.length === 0 ||
  //             Date.now() - orderStore.lastFetchTime > 5 * 60 * 1000;
  //
  //         if (needsRefresh) {
  //             console.log('[Router] Preloading orders data');
  //             await orderStore.fetchMyOrders();
  //         }
  //     } catch (error) {
  //         console.error('[Router] Failed to preload orders:', error);
  //         // 即使加载失败也允许导航，避免阻塞用户
  //     }
  // }
  //
  // // 4. 允许导航
  // next();
});

/**
 * 全局后置守卫（可选）
 * 用于页面标题更新、埋点等
 */
router.afterEach((to) => {
  // 更新页面标题
  const titleMap: Record<string, string> = {
    ChatMain: "订单磋商",
    ContractList: "合同列表",
    ContractSigning: "合同签署",
    OrderStatistics: "订单统计查询",
    Login: "登录",
  };

  const title = titleMap[to.name as string] || "订单磋商系统";
  document.title = title;

  // 滚动到顶部
  window.scrollTo(0, 0);
});

/**
 * 判断是否需要预加载订单数据
 */
function shouldPreloadOrders(routeName: string): boolean {
  const preloadRoutes = ["ChatMain", "ContractList", "ContractSigning"];
  return preloadRoutes.includes(routeName);
}

export default router;
