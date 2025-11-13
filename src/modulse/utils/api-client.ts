// utils/api-client.ts
import axios, { type AxiosInstance } from "axios";

export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export function createAuthenticatedApiClient(): AxiosInstance {
  const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
    timeout: 30000,
  });

  /* 请求拦截器 */
  apiClient.interceptors.request.use((config) => {
    // ⬇ 先拿当前标签页正在用的用户
    const currentUserId = sessionStorage.getItem("auth_current_user_id");
    if (currentUserId) {
      const token = localStorage.getItem(`auth_${currentUserId}_token`);
      if (token) {
        config.headers["token"] = token;
      }
    }
    return config;
  });

  /* 响应拦截器 */
  apiClient.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        console.warn("[API] Token expired, cleaning local data");

        // 只清当前用户的四件套 + 当前标签页身份
        const uid = sessionStorage.getItem("auth_current_user_id");
        if (uid) {
          ["token", "user", "last_activity", "login_timestamp"].forEach((s) =>
            localStorage.removeItem(`auth_${uid}_${s}`)
          );
          sessionStorage.removeItem("auth_current_user_id");
        }

        // 跳登录
        window.location.href = "/login";
      }
      return Promise.reject(err);
    }
  );

  return apiClient;
}
