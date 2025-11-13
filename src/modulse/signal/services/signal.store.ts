// services/signal.store.ts

import { type StorageType } from '@privacyresearch/libsignal-protocol-typescript';
import { get, set, createStore, type UseStore } from 'idb-keyval';
import { fromBase64, toBase64 } from '../utils/e2ee.utils';
import type { StorableIdentity } from '../types';

// IndexedDB Stores
const identityStore: UseStore = createStore('e2ee-identity-store', 'identities');
const sessionStore: UseStore = createStore('e2ee-session-store', 'sessions');
const trustStore: UseStore = createStore('e2ee-trust-store', 'trusted-keys');

// 会话状态回调接口
export interface SessionStateInfo {
    identifier: string;
    timestamp: number;
    isNew: boolean;
    hasPreKeyMessage: boolean;
    metadata: {
        userId: string;
        recipientId: string;
    };
}

/**
 * 满足 libsignal-protocol-typescript 所需 StorageType 接口的 IndexedDB 实现
 */
export class IndexedDbSignalProtocolStore implements StorageType {
    private _userId: string;
    private _onSessionUpdate?: (stateInfo: SessionStateInfo) => void;
    private _sessionMetadata = new Map<string, {
        recipientId: string;
        createdAt: number;
        messageCount: number;
        lastAccessed: number;
    }>();

    constructor(
        userId: string,
        onSessionUpdate?: (stateInfo: SessionStateInfo) => void
    ) {
        this._userId = userId;
        this._onSessionUpdate = onSessionUpdate;
        this._loadSessionMetadata();
    }

    private async _loadSessionMetadata(): Promise<void> {
        try {
            const metadataKey = `metadata-${this._userId}`;
            const stored = await get(metadataKey, sessionStore);
            if (stored) {
                this._sessionMetadata = new Map(Object.entries(stored));
            }
        } catch (error) {
            console.warn('[Store] Failed to load session metadata:', error);
        }
    }

    private async _saveSessionMetadata(): Promise<void> {
        try {
            const metadataKey = `metadata-${this._userId}`;
            const obj = Object.fromEntries(this._sessionMetadata);
            await set(metadataKey, obj, sessionStore);
        } catch (error) {
            console.warn('[Store] Failed to save session metadata:', error);
        }
    }

    /**
     * 解析会话标识符
     * 格式：recipientId.deviceId (不考虑多设备，deviceId固定为1)
     */
    private _parseSessionIdentifier(identifier: string): {
        userId: string;
        recipientId: string;
        deviceId: number;
        isValid: boolean;
    } {
        // Signal 协议标准格式：recipientId.deviceId
        const match = identifier.match(/^([^\.]+)\.(\d+)$/);

        if (match) {
            return {
                userId: this._userId,
                recipientId: match[1],
                deviceId: parseInt(match[2], 10),
                isValid: true
            };
        } else {
            console.warn(`[Store] Invalid session identifier format: ${identifier}`);
            return {
                userId: this._userId,
                recipientId: identifier,
                deviceId: 1,
                isValid: false
            };
        }
    }

    private async _getIdentity(): Promise<StorableIdentity | undefined> {
        return get<StorableIdentity>(this._userId, identityStore);
    }

    private async _setIdentity(identity: StorableIdentity): Promise<void> {
        await set(this._userId, identity, identityStore);
    }

    // ===================== Identity =====================

    async getIdentityKeyPair(): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
        const identity = await this._getIdentity();
        if (!identity) throw new Error('Identity not found');
        return {
            pubKey: fromBase64(identity.identityKeyPair.pubKey).buffer,
            privKey: fromBase64(identity.identityKeyPair.privKey).buffer,
        };
    }

    async getLocalRegistrationId(): Promise<number> {
        return 1;
    }

    async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
        const existing = await get<string>(`identity-${encodedAddress}`, trustStore);
        const pubKeyB64 = toBase64(new Uint8Array(publicKey));

        if (existing && existing !== pubKeyB64) {
            console.warn(`[Store] Identity changed for ${encodedAddress}`);
            return false;
        }

        await set(`identity-${encodedAddress}`, pubKeyB64, trustStore);
        return true;
    }

    async isTrustedIdentity(
        encodedAddress: string,
        identityKey: ArrayBuffer
    ): Promise<boolean> {
        const known = await get<string>(`identity-${encodedAddress}`, trustStore);
        const current = toBase64(new Uint8Array(identityKey));

        if (!known) {
            console.warn(`[Store] First encounter with identity: ${encodedAddress}`);
            await set(`identity-${encodedAddress}`, current, trustStore);
            return true;
        }

        return known === current;
    }

    // ===================== PreKeys =====================

    async loadPreKey(keyId: number): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
        const identity = await this._getIdentity();
        const preKey = identity?.oneTimePreKeys.find(pk => pk.keyId === keyId);
        if (!preKey) throw new Error(`PreKey ${keyId} not found`);
        return {
            pubKey: fromBase64(preKey.pubKey).buffer,
            privKey: fromBase64(preKey.privKey).buffer,
        };
    }

    async storePreKey(
        keyId: number,
        keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer }
    ): Promise<void> {
        const identity = await this._getIdentity();
        if (!identity) throw new Error('Identity not found');

        identity.oneTimePreKeys.push({
            keyId,
            pubKey: toBase64(new Uint8Array(keyPair.pubKey)),
            privKey: toBase64(new Uint8Array(keyPair.privKey)),
        });

        await this._setIdentity(identity);
    }

    //不删除PreKey
    async removePreKey(keyId: number): Promise<void> {
        console.log(`[Store] PreKey ${keyId} removal requested but ignored (no key rotation)`);
        return Promise.resolve();
    }

    // ===================== SignedPreKeys =====================

    async loadSignedPreKey(
        keyId: number
    ): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
        const identity = await this._getIdentity();
        if (!identity || identity.signedPreKey.keyId !== keyId) {
            throw new Error(`SignedPreKey ${keyId} not found`);
        }
        return {
            pubKey: fromBase64(identity.signedPreKey.pubKey).buffer,
            privKey: fromBase64(identity.signedPreKey.privKey).buffer,
        };
    }

    async storeSignedPreKey(
        keyId: number,
        keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer }
    ): Promise<void> {
        const identity = await this._getIdentity();
        if (!identity) throw new Error('Identity not found');

        identity.signedPreKey = {
            keyId,
            pubKey: toBase64(new Uint8Array(keyPair.pubKey)),
            privKey: toBase64(new Uint8Array(keyPair.privKey)),
            signature: identity.signedPreKey.signature,
        };

        await this._setIdentity(identity);
    }

    async removeSignedPreKey(keyId: number): Promise<void> {
        const identity = await this._getIdentity();
        if (!identity) return;
        if (identity.signedPreKey.keyId === keyId) {
            identity.signedPreKey = {
                keyId: 0,
                pubKey: '',
                privKey: '',
                signature: '',
            };
            await this._setIdentity(identity);
        }
    }

    // ===================== Sessions =====================

    async loadSession(identifier: string): Promise<string | undefined> {
        console.log(`[Store] 尝试加载会话: ${identifier}`);

        // 更新会话访问时间
        const metadata = this._sessionMetadata.get(identifier);
        if (metadata) {
            metadata.lastAccessed = Date.now();
            this._sessionMetadata.set(identifier, metadata);
            await this._saveSessionMetadata();
        }

        const session = await get<string>(identifier, sessionStore);
        if (session) {
            console.log(`[Store] 找到现有会话: ${identifier}`);
        } else {
            console.log(`[Store] 未找到会话: ${identifier}`);
        }
        return session;
    }

    async storeSession(identifier: string, record: string): Promise<void> {
        console.log(`[Store] 存储会话: ${identifier}`);

        const { recipientId, isValid } = this._parseSessionIdentifier(identifier);
        if (!isValid) {
            console.warn(`[Store] Storing session with invalid identifier: ${identifier}`);
        }

        // 更新会话元数据
        const existingSession = await get<string>(identifier, sessionStore);
        const isNew = !existingSession;

        let metadata = this._sessionMetadata.get(identifier);
        if (!metadata) {
            metadata = {
                recipientId,
                createdAt: Date.now(),
                messageCount: 0,
                lastAccessed: Date.now()
            };
        } else {
            metadata.lastAccessed = Date.now();
            metadata.messageCount++; // 递增消息计数
        }

        this._sessionMetadata.set(identifier, metadata);
        await this._saveSessionMetadata();

        // 调用回调函数，提供简化的会话状态信息
        if (this._onSessionUpdate) {
            const stateInfo: SessionStateInfo = {
                identifier,
                timestamp: Date.now(),
                isNew,
                hasPreKeyMessage: isNew,
                metadata: {
                    userId: this._userId,
                    recipientId
                }
                // ❌ 删除棘轮状态信息
            };

            try {
                this._onSessionUpdate(stateInfo);
            } catch (error) {
                console.error('[Store] Session update callback failed:', error);
            }
        }

        // 定期清理过期会话
        await this._cleanupExpiredSessions();

        // 存储实际的会话记录
        return set(identifier, record, sessionStore);
    }

    async removeSession(identifier: string): Promise<void> {
        console.log(`[Store] 删除会话: ${identifier}`);
        this._sessionMetadata.delete(identifier);
        await this._saveSessionMetadata();
        await set(identifier, undefined, sessionStore);
    }

    /**
     * 清理过期会话（30天未访问）
     */
    private async _cleanupExpiredSessions(): Promise<void> {
        const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30天
        const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 每天执行一次

        const lastCleanup = localStorage.getItem(`lastCleanup_${this._userId}`);
        const now = Date.now();

        if (lastCleanup && (now - parseInt(lastCleanup)) < CLEANUP_INTERVAL) {
            return;
        }

        try {
            let cleanedCount = 0;
            const expiredSessions: string[] = [];

            for (const [identifier, metadata] of this._sessionMetadata.entries()) {
                if (now - metadata.lastAccessed > SESSION_MAX_AGE) {
                    expiredSessions.push(identifier);
                }
            }

            for (const identifier of expiredSessions) {
                await this.removeSession(identifier);
                cleanedCount++;
            }

            if (cleanedCount > 0) {
                console.log(`[Store] Cleaned up ${cleanedCount} expired sessions`);
            }

            localStorage.setItem(`lastCleanup_${this._userId}`, now.toString());

        } catch (error) {
            console.warn('[Store] Session cleanup error:', error);
        }
    }

    // ===================== 额外的工具方法 =====================

    /**
     * 获取会话统计信息
     */
    getSessionStats(): {
        identifier: string;
        recipientId: string;
        createdAt: number;
        messageCount: number;
        lastAccessed: number;
        ageMinutes: number;
    }[] {
        const now = Date.now();
        return Array.from(this._sessionMetadata.entries()).map(([identifier, metadata]) => ({
            identifier,
            ...metadata,
            ageMinutes: Math.floor((now - metadata.createdAt) / (1000 * 60))
        }));
    }

    /**
     * 清理所有会话数据
     */
    async clearAllSessions(): Promise<void> {
        console.log(`[Store] 清理用户 ${this._userId} 的所有会话`);
        this._sessionMetadata.clear();
        await this._saveSessionMetadata();
    }

    /**
     * 安全地移除会话更新回调
     */
    removeSessionUpdateCallback(): void {
        this._onSessionUpdate = undefined;
    }
}