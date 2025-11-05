import axios from 'axios';
import { useAuthStore } from '../modulse/auth/services/auth.store';
import type { User } from '../modulse/auth/types';

/**
 * 在本地模拟用户登录。
 * - 会将会话数据写入 localStorage / sessionStorage
 * - 可选地把会话写入 Pinia `useAuthStore`
 * - 设置 axios 默认 token
 *
 * 不会修改任何服务端逻辑；适用于开发/测试环境下在本地快速切换用户。
 *
 * @param user 要登录的用户对象，必须包含 `id` 字段
 * @param options.token 可选 token（不传则自动生成 mock token）
 * @param options.updatePinia 是否更新 Pinia store（默认 true）
 * @param options.persist 是否持久化到 localStorage（默认 true）
 */
export function mockLogin(
  user: User,
  options?: { token?: string; updatePinia?: boolean; persist?: boolean }
) {
  const { token: optToken, updatePinia = true, persist = true } = options || {};
  if (!user || !user.id) {
    console.warn('[mockLogin] invalid user object, missing id');
    return false;
  }

  const userId = user.id;
  const session = {
    user,
    token: optToken || 'mock-token-' + Math.random().toString(36).slice(2),
    lastActivity: Date.now(),
    loginTimestamp: Date.now(),
  };

  // 持久化到 localStorage/sessionStorage（可选）
  if (persist) {
    try {
      const prefix = `auth_${userId}`;
      localStorage.setItem(`${prefix}_token`, session.token);
      localStorage.setItem(`${prefix}_user`, JSON.stringify(session.user));
      localStorage.setItem(`${prefix}_last_activity`, String(session.lastActivity));
      localStorage.setItem(`${prefix}_login_timestamp`, String(session.loginTimestamp));

      // 更新用户ID列表（如果尚未包含）
      const idsStr = localStorage.getItem('auth_user_ids');
      const ids: string[] = idsStr ? JSON.parse(idsStr) : [];
      if (!ids.includes(userId)) {
        ids.push(userId);
        localStorage.setItem('auth_user_ids', JSON.stringify(ids));
      }

      sessionStorage.setItem('auth_current_user_id', userId);
    } catch (err) {
      console.warn('[mockLogin] persist to storage failed', err);
    }
  }

  // 设置 axios token（尽量同步）
  try {
    axios.defaults.headers.common['token'] = session.token;
  } catch (err) {
    // ignore
  }

  // 可选：更新 Pinia store（如果 Pinia 已初始化）
  if (updatePinia) {
    try {
      const store = useAuthStore();

      // 插入/更新内存 map
      // 注意：store 的实现使用 Map<string, UserSession>
      // 我们尽量调用已有的方法以保持行为一致
      try {
        // 如果 saveUserSession / setCurrentUser 等方法存在则调用
        if (typeof (store as any).saveUserSession === 'function' && typeof (store as any).setCurrentUser === 'function') {
          // 先把 session 写入内存 map
          (store as any).users.set(userId, session);
          (store as any).setCurrentUser(userId);
          (store as any).saveUserSession(userId, session);
          if (typeof (store as any).setAxiosToken === 'function') {
            (store as any).setAxiosToken(session.token);
          } else {
            store.status = 'success';
            store.errorMessage = '';
          }
        } else {
          // 兼容：直接写入字段（若不能访问则捕获）
          (store as any).users.set(userId, session);
          (store as any).currentUserId = userId;
          (store as any).status = 'success';
          (store as any).errorMessage = '';
        }
      } catch (innerErr) {
        console.warn('[mockLogin] update pinia store failed:', innerErr);
      }
    } catch (err) {
      // Pinia 未初始化或在非 Vue 环境中调用时会抛错，忽略即可
      console.warn('[mockLogin] could not access Pinia store (is Pinia initialized?):', err);
    }
  }

  console.log(`[mockLogin] mock login completed for user ${userId}`);
  return true;
}

export default mockLogin;
