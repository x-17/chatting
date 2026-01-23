// modulse/auth/router/index.ts

export const authRoutes = [
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/LoginPage.vue"),
    meta: {
      requiresAuth: false,
      title: "登录",
    },
  },
  {
    path: "/auth/callback",
    name: "AuthCallback",
    component: () => import("../views/AuthCallback.vue"),
    meta: {
      requiresAuth: false,
      title: "登录中",
    },
  },
  {
    path: "/mocksso",
    name: "SsoSimulator",
    component: () => import("../views/SsoSimulator.vue"),
    meta: {
      requiresAuth: false,
      title: "模拟sso",
    },
  },
  {
    path: "/login-psw",
    name: "LocalLogin",
    component: () => import("../views/LocalLoginPage.vue"),
  },
];
