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
    // 新增：棘轮状态信息
    ratchetInfo?: {
        operation: 'encrypt' | 'decrypt' | 'init';
        messageCount: number;
        sessionAge: number; // 会话存在时间（分钟）
        isDoubleRatchetAdvanced: boolean; // 是否推进了双棘轮
    };
}

/**
 * 满足 libsignal-protocol-typescript 所需 StorageType 接口的 IndexedDB 实现
 * 增强了会话状态观察功能,邱老师要求看协议状态，具体使用如果UI界面丰富可以考虑不使用
 */
export class IndexedDbSignalProtocolStore implements StorageType {
    private _userId: string;
    private _onSessionUpdate?: (stateInfo: SessionStateInfo) => void;
    private _sessionMetadata = new Map<string, { recipientId: string; createdAt: number; messageCount: number }>();

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

    private _parseSessionIdentifier(identifier: string): { userId: string; recipientId: string } {
        // Signal Protocol 的标识符格式通常是 "recipientId.deviceId"
        const parts = identifier.split('.');
        return {
            userId: this._userId,
            recipientId: parts[0] || 'unknown'
        };
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
        return 0; // 默认值
    }

    async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
        const existing = await get<string>(`identity-${encodedAddress}`, trustStore);
        const pubKeyB64 = toBase64(new Uint8Array(publicKey));
        if (existing && existing !== pubKeyB64) {
            return false; // 不信任的新身份（TOFU）
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
            // 第一次遇到，记录为信任，存在一定安全问题，有特定需求再修改。
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

    //为了简化PreKeys密钥管理，建立会话不对PreKey进行删除。
    async removePreKey(keyId: number): Promise<void> {
        console.log(`[Store] PreKey ${keyId} removal requested but ignored in experiment mode`);
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

        // 更新会话元数据
        const { recipientId } = this._parseSessionIdentifier(identifier);
        const existingSession = await get<string>(identifier, sessionStore);
        const isNew = !existingSession;

        let metadata = this._sessionMetadata.get(identifier);
        if (!metadata) {
            metadata = {
                recipientId,
                createdAt: Date.now(),
                messageCount: 0
            };
        }

        const oldMessageCount = metadata.messageCount;
        metadata.messageCount++;
        this._sessionMetadata.set(identifier, metadata);

        // 保存元数据
        await this._saveSessionMetadata();

        // 计算会话年龄
        const sessionAgeMinutes = Math.floor((Date.now() - metadata.createdAt) / (1000 * 60));

        // 判断是否推进了双棘轮（简化判断：消息计数增加表示棘轮转动）
        const isDoubleRatchetAdvanced = metadata.messageCount > oldMessageCount;

        // 调用回调函数，提供详细的会话状态信息
        if (this._onSessionUpdate) {
            const stateInfo: SessionStateInfo = {
                identifier,
                timestamp: Date.now(),
                isNew,
                hasPreKeyMessage: isNew, // 新会话通常意味着 PreKey 消息
                metadata: {
                    userId: this._userId,
                    recipientId
                },
                ratchetInfo: {
                    operation: isNew ? 'init' : (this._userId < recipientId ? 'encrypt' : 'decrypt'),
                    messageCount: metadata.messageCount,
                    sessionAge: sessionAgeMinutes,
                    isDoubleRatchetAdvanced
                }
            };

            try {
                this._onSessionUpdate(stateInfo);
            } catch (error) {
                console.error('[Store] Session update callback failed:', error);
            }
        }

        // 存储实际的会话记录
        return set(identifier, record, sessionStore);
    }

    async removeSession(identifier: string): Promise<void> {
        console.log(`[Store] 删除会话: ${identifier}`);
        this._sessionMetadata.delete(identifier);
        await this._saveSessionMetadata();
        await set(identifier, undefined, sessionStore);
    }

    // ===================== 额外的工具方法 =====================

    /**
     * 获取会话统计信息
     */
    getSessionStats(): { identifier: string; recipientId: string; createdAt: number; messageCount: number }[] {
        return Array.from(this._sessionMetadata.entries()).map(([identifier, metadata]) => ({
            identifier,
            ...metadata
        }));
    }

    /**
     * 清理所有会话数据
     */
    async clearAllSessions(): Promise<void> {
        console.log(`[Store] 清理用户 ${this._userId} 的所有会话`);
        this._sessionMetadata.clear();
        await this._saveSessionMetadata();

        // 注意：这里不能直接清理整个 sessionStore，因为可能有其他用户的会话
        // 实际应用中需要更精确的清理逻辑
    }
}