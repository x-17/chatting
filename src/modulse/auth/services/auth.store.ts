// services/auth.store.ts
import { defineStore } from 'pinia';
import { useRouter } from 'vue-router';
import * as authApi from './auth.api';
import type { User } from '../types';
import axios from "axios";
import { e2eeService } from "../../signal/services/e2ee.service.ts";

export type AuthStatus = 'idle' | 'loading' | 'settingUp' | 'success' | 'error';

interface UserSession {
    user: User;
    token: string;
    lastActivity: number;
    loginTimestamp: number;
}

interface AuthState {
    currentUserId: string | null;
    users: Map<string, UserSession>;
    openId: string | null;
    status: AuthStatus;
    errorMessage: string;
    isProcessing: boolean;
}

const CONFIG = {
    SESSION_TIMEOUT: 30 * 60 * 1000,
    TOKEN_EXPIRY_WARNING: 60 * 60 * 1000,
    MAX_RETRY_ATTEMPTS: 3,
    REQUEST_TIMEOUT: 15000,
} as const;

export const useAuthStore = defineStore('auth', {
    state: (): AuthState => ({
        currentUserId: null,
        users: new Map(),
        openId: null,
        status: 'idle',
        errorMessage: '',
        isProcessing: false,
    }),

    getters: {
        user: (state): User | null => {
            if (!state.currentUserId) return null;
            return state.users.get(state.currentUserId)?.user || null;
        },

        token: (state): string | null => {
            if (!state.currentUserId) return null;
            return state.users.get(state.currentUserId)?.token || null;
        },
        isAuthenticated: (state): boolean => {
            return !!state.currentUserId &&
                !!state.users.get(state.currentUserId) &&
                state.status === 'success';
        },

        isSessionNearExpiry: (state): boolean => {
            if (!state.currentUserId) return false;
            const session = state.users.get(state.currentUserId);
            if (!session) return false;

            const elapsed = Date.now() - session.loginTimestamp;
            return elapsed > CONFIG.TOKEN_EXPIRY_WARNING;
        },

        isSessionExpired: (state): boolean => {
            if (!state.currentUserId) return false;
            const session = state.users.get(state.currentUserId);
            if (!session) return false;

            const inactiveTime = Date.now() - session.lastActivity;
            return inactiveTime > CONFIG.SESSION_TIMEOUT;
        },

        remainingSessionTime: (state): number => {
            if (!state.currentUserId) return 0;
            const session = state.users.get(state.currentUserId);
            if (!session) return 0;

            const elapsed = Date.now() - session.loginTimestamp;
            const remaining = CONFIG.SESSION_TIMEOUT - elapsed;
            return Math.max(0, Math.floor(remaining / 60000));
        },

        lastActivity: (state): number => {
            if (!state.currentUserId) return Date.now();
            return state.users.get(state.currentUserId)?.lastActivity || Date.now();
        },

        loginTimestamp: (state): number => {
            if (!state.currentUserId) return 0;
            return state.users.get(state.currentUserId)?.loginTimestamp || 0;
        },
    },

    actions: {

        initializeAuth() {
            try {
                // ✅ 从 sessionStorage 读取当前标签页的用户ID（隔离）
                const currentUserId = sessionStorage.getItem('auth_current_user_id');

                // 从 localStorage 读取所有用户数据（共享）
                const userIdsStr = localStorage.getItem('auth_user_ids');

                if (!userIdsStr) {
                    console.log('[Auth] No saved users found');
                    return;
                }

                const userIds: string[] = JSON.parse(userIdsStr);
                console.log(`[Auth] Restoring ${userIds.length} user sessions`);

                // 恢复所有用户的数据
                for (const userId of userIds) {
                    const prefix = `auth_${userId}`;
                    const token = localStorage.getItem(`${prefix}_token`);
                    const userStr = localStorage.getItem(`${prefix}_user`);
                    const lastActivity = localStorage.getItem(`${prefix}_last_activity`);
                    const loginTimestamp = localStorage.getItem(`${prefix}_login_timestamp`);

                    if (token && userStr) {
                        const user = JSON.parse(userStr);
                        const session: UserSession = {
                            user,
                            token,
                            lastActivity: lastActivity ? parseInt(lastActivity) : Date.now(),
                            loginTimestamp: loginTimestamp ? parseInt(loginTimestamp) : Date.now()
                        };

                        // 检查会话是否过期
                        const inactiveTime = Date.now() - session.lastActivity;
                        if (inactiveTime > CONFIG.SESSION_TIMEOUT) {
                            console.warn(`[Auth] Session expired for user ${userId}`);
                            this.removeUserSession(userId);
                            continue;
                        }

                        this.users.set(userId, session);
                    }
                }

                // ✅ 设置当前标签页的用户（从 sessionStorage）
                if (currentUserId && this.users.has(currentUserId)) {
                    this.currentUserId = currentUserId;
                    const session = this.users.get(currentUserId)!;
                    this.setAxiosToken(session.token);
                    this.status = 'success';
                    this.updateActivity();

                    console.log(`[Auth] Tab initialized with user: ${currentUserId}`);
                }

            } catch (error) {
                console.error('[Auth] Initialize failed:', error);
                this.clearAuthData();
            }
        },

        updateActivity() {
            if (!this.currentUserId) return;

            const session = this.users.get(this.currentUserId);
            if (session) {
                session.lastActivity = Date.now();
                this.users.set(this.currentUserId, session);

                const prefix = `auth_${this.currentUserId}`;
                localStorage.setItem(`${prefix}_last_activity`, String(session.lastActivity));
            }
        },

        setAxiosToken(token: string) {
            axios.defaults.headers.common['token'] = token;
        },

        /**
         * ✅ 保存用户会话：localStorage 存用户数据
         */
        saveUserSession(userId: string, session: UserSession) {
            const prefix = `auth_${userId}`;
            localStorage.setItem(`${prefix}_token`, session.token);
            localStorage.setItem(`${prefix}_user`, JSON.stringify(session.user));
            localStorage.setItem(`${prefix}_last_activity`, String(session.lastActivity));
            localStorage.setItem(`${prefix}_login_timestamp`, String(session.loginTimestamp));

            // 更新用户ID列表（localStorage）
            const userIds = Array.from(this.users.keys());
            localStorage.setItem('auth_user_ids', JSON.stringify(userIds));

            console.log(`[Auth] Saved session for user: ${userId}`);
        },

        /**
         * ✅ 设置当前标签页的用户：sessionStorage 存当前用户ID
         */
        setCurrentUser(userId: string) {
            this.currentUserId = userId;
            // ✅ 存储到 sessionStorage（标签页隔离）
            sessionStorage.setItem('auth_current_user_id', userId);
            console.log(`[Auth] Set current user for this tab: ${userId}`);
        },

        removeUserSession(userId: string) {
            console.log(`[Auth] Removing session for user: ${userId}`);

            this.users.delete(userId);

            const prefix = `auth_${userId}`;
            localStorage.removeItem(`${prefix}_token`);
            localStorage.removeItem(`${prefix}_user`);
            localStorage.removeItem(`${prefix}_last_activity`);
            localStorage.removeItem(`${prefix}_login_timestamp`);

            const userIds = Array.from(this.users.keys());
            if (userIds.length > 0) {
                localStorage.setItem('auth_user_ids', JSON.stringify(userIds));
            } else {
                localStorage.removeItem('auth_user_ids');
            }

            // 如果删除的是当前标签页的用户
            if (this.currentUserId === userId) {
                this.currentUserId = null;
                sessionStorage.removeItem('auth_current_user_id');
                delete axios.defaults.headers.common['token'];
            }
        },

        async handleSsoCallback(code: string): Promise<boolean> {
            if (this.isProcessing) {
                console.warn('[Auth] Authentication in progress');
                return false;
            }

            try {
                this.isProcessing = true;
                this.status = 'loading';
                this.errorMessage = '';

                const response = await this.withTimeout(
                    authApi.loginWithCode(code),
                    CONFIG.REQUEST_TIMEOUT
                );

                if (response.code === 1) {
                    return this.handleExistingUser(response.data);
                }

                if (response.code === 0 && response.data?.openId) {
                    return await this.handleNewUser(response.data);
                }

                throw new Error(response.msg || '未知的认证响应');

            } catch (error: any) {
                return this.handleAuthError(error);
            } finally {
                this.isProcessing = false;
            }
        },

        /**
         * ✅ 处理已存在用户
         */
        handleExistingUser(data: any): boolean {
            const userId = data.userInfo.id;
            const session: UserSession = {
                user: data.userInfo,
                token: data.token,
                lastActivity: Date.now(),
                loginTimestamp: Date.now()
            };

            // 保存到内存
            this.users.set(userId, session);

            // ✅ 设置为当前标签页的用户（sessionStorage）
            this.setCurrentUser(userId);

            // 保存到 localStorage
            this.saveUserSession(userId, session);

            // 设置 axios token
            this.setAxiosToken(data.token);
            this.status = 'success';

            console.log(`[Auth] User ${userId} logged in successfully in this tab`);
            return true;
        },

        async handleNewUser(data: any): Promise<boolean> {
            this.status = 'settingUp';
            this.openId = data.openId;

            try {
                const publicKeys = await this.retryOperation(
                    () => e2eeService.initializeKeysForUser(this.openId!),
                    CONFIG.MAX_RETRY_ATTEMPTS,
                    '密钥生成失败，正在重试...'
                );

                const registerRes = await this.withTimeout(
                    authApi.registerUserKeys(publicKeys),
                    CONFIG.REQUEST_TIMEOUT
                );

                if (registerRes.code === 1) {
                    const userId = registerRes.data.userInfo.id;
                    const session: UserSession = {
                        user: registerRes.data.userInfo,
                        token: registerRes.data.token,
                        lastActivity: Date.now(),
                        loginTimestamp: Date.now()
                    };

                    this.users.set(userId, session);
                    this.setCurrentUser(userId);
                    this.saveUserSession(userId, session);

                    this.setAxiosToken(registerRes.data.token);
                    this.status = 'success';

                    console.log(`[Auth] New user ${userId} registered in this tab`);
                    return true;
                } else {
                    throw new Error(registerRes.msg || '注册失败');
                }
            } catch (error: any) {
                if (error.message.includes('密钥')) {
                    this.errorMessage = '加密密钥生成失败，请重试或联系技术支持';
                } else {
                    this.errorMessage = error.message || '用户注册失败';
                }
                throw error;
            }
        },

        handleAuthError(error: any): boolean {
            this.status = 'error';

            if (error.code === 'NETWORK_ERROR' || error.message.includes('timeout')) {
                this.errorMessage = '网络连接超时，请检查网络后重试';
            } else if (error.response?.status === 429) {
                this.errorMessage = '请求过于频繁，请稍后重试';
            } else if (error.response?.status >= 500) {
                this.errorMessage = '服务器暂时不可用，请稍后重试';
            } else {
                this.errorMessage = error.response?.data?.msg ||
                    error.response?.data?.message ||
                    error.message ||
                    '认证过程中发生未知错误';
            }

            return false;
        },

        async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
            const timeout = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('请求超时')), timeoutMs);
            });
            return Promise.race([promise, timeout]);
        },

        async retryOperation<T>(
            operation: () => Promise<T>,
            maxAttempts: number,
            errorMessage: string = '操作失败，正在重试...'
        ): Promise<T> {
            let lastError: Error;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    return await operation();
                } catch (error: any) {
                    lastError = error;
                    if (attempt < maxAttempts) {
                        console.warn(`${errorMessage} (尝试 ${attempt}/${maxAttempts})`);
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                    }
                }
            }

            throw lastError!;
        },

        /**
         * ✅ 登出：只清除当前标签页的用户
         */
        async logout(reason: 'manual' | 'expired' | 'error' = 'manual') {
            const router = useRouter();

            try {
                if (reason === 'manual' && this.token) {
                    await this.withTimeout(
                        axios.post('/user/logout', {}),
                        5000
                    ).catch(err => {
                        console.warn('[Auth] Logout API failed:', err);
                    });
                }
            } catch (error) {
                console.warn('[Auth] Logout error:', error);
            }

            // ✅ 只清除当前标签页的用户ID（sessionStorage）
            this.currentUserId = null;
            sessionStorage.removeItem('auth_current_user_id');
            delete axios.defaults.headers.common['token'];

            this.status = 'idle';
            this.errorMessage = reason === 'expired' ? '会话已过期，请重新登录' : '';

            await router.push({
                name: 'Login',
                query: reason !== 'manual' ? { reason } : undefined
            });
        },

        /**
         * ✅ 清理当前标签页的认证数据（不影响其他标签页）
         */
        clearAuthData() {
            console.log('[Auth] Clearing auth data for current tab');

            this.currentUserId = null;
            this.openId = null;
            this.status = 'idle';

            sessionStorage.removeItem('auth_current_user_id');
            delete axios.defaults.headers.common['token'];
        },

        /**
         * ✅ 清理所有用户数据（localStorage）
         */
        clearAllAuthData() {
            console.log('[Auth] Clearing all authentication data');

            for (const userId of Array.from(this.users.keys())) {
                const prefix = `auth_${userId}`;
                localStorage.removeItem(`${prefix}_token`);
                localStorage.removeItem(`${prefix}_user`);
                localStorage.removeItem(`${prefix}_last_activity`);
                localStorage.removeItem(`${prefix}_login_timestamp`);
            }

            this.users.clear();
            this.currentUserId = null;
            this.openId = null;
            this.status = 'idle';

            localStorage.removeItem('auth_user_ids');
            sessionStorage.removeItem('auth_current_user_id');
            delete axios.defaults.headers.common['token'];
        },

        reset() {
            this.openId = null;
            this.status = 'idle';
            this.errorMessage = '';
            this.isProcessing = false;
        },

        checkSessionStatus(): { valid: boolean; warning?: string } {
            if (!this.isAuthenticated) {
                return { valid: false };
            }

            if (this.isSessionExpired) {
                this.logout('expired');
                return { valid: false };
            }

            if (this.isSessionNearExpiry) {
                return {
                    valid: true,
                    warning: `您的会话即将在 ${this.remainingSessionTime} 分钟后过期，请保存工作并准备重新登录`
                };
            }

            return { valid: true };
        },
    },
});