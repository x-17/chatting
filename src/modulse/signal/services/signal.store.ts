// services/signal.store.ts

import { type StorageType } from "@privacyresearch/libsignal-protocol-typescript";
import { get, set, createStore, type UseStore } from "idb-keyval";
import { fromBase64, toBase64 } from "../utils/e2ee.utils";
import type { StorableIdentity } from "../types";

// IndexedDB Stores
// Note: We now create stores dynamically in the constructor based on userId to ensure isolation.

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
  private _sessionMetadata = new Map<
    string,
    {
      recipientId: string;
      createdAt: number;
      messageCount: number;
      lastAccessed: number;
    }
  >();

  // ✅ Instance-level stores for isolation
  private identityStore: UseStore;
  private sessionStore: UseStore;
  private trustStore: UseStore;

  constructor(
    userId: string,
    onSessionUpdate?: (stateInfo: SessionStateInfo) => void,
  ) {
    this._userId = userId;
    this._onSessionUpdate = onSessionUpdate;

    // ✅ 关键修复：每个 Store 使用独立的数据库名称，避免 idb-keyval 的多 store 限制
    // idb-keyval 的 createStore 如果使用相同的 dbName 但不同的 storeName，可能会在数据库已存在时无法正确创建/打开新的 store
    // 因此，最安全的方法是为每个用途使用完全独立的数据库

    console.log(`[Store] Initializing isolated stores for user ${userId}...`);

    this.identityStore = createStore(
      `signal_v2_identity_${userId}`,
      "identities",
    );
    this.sessionStore = createStore(`signal_v2_session_${userId}`, "sessions");
    this.trustStore = createStore(`signal_v2_trust_${userId}`, "trusted-keys");

    // ✅ 自动迁移：检查新库是否有身份信息，如果没有，尝试从旧库迁移
    // 这样可以保留用户的密钥对（公钥/私钥），避免需要重新向服务器注册
    this._migrateLegacyIdentity().then(() => {
      this._loadSessionMetadata();
    });
  }

  /**
   * 迁移旧的身份数据
   * 从全局的 e2ee-identity-store 迁移到用户隔离的 store
   */
  private async _migrateLegacyIdentity(): Promise<void> {
    try {
      // 1. 检查新库中是否有数据
      // Use this.identityStore (isolated)
      const currentIdentity = await get<StorableIdentity>(
        this._userId,
        this.identityStore,
      );
      if (currentIdentity) {
        // 已有数据，无需迁移
        return;
      }

      console.log(
        `[Store] Checking for legacy identity to migrate for ${this._userId}...`,
      );

      // 2. 访问旧的全局库
      // 注意：这里硬编码旧的 store 名称 'e2ee-identity-store'（必须与旧代码一致）
      const legacyIdentityStore = createStore(
        "e2ee-identity-store",
        "identities",
      );
      const legacyIdentity = await get<StorableIdentity>(
        this._userId,
        legacyIdentityStore,
      );

      if (legacyIdentity) {
        console.log(
          `[Store] Found legacy identity for ${this._userId}, migrating...`,
        );
        // 3. 复制到新库
        await set(this._userId, legacyIdentity, this.identityStore);
        console.log(`[Store] Migration successful!`);
      } else {
        console.log(`[Store] No legacy identity found.`);
      }
    } catch (error) {
      console.error("[Store] Migration failed:", error);
    }
  }

  private async _loadSessionMetadata(): Promise<void> {
    try {
      const metadataKey = `metadata-${this._userId}`;
      const stored = await get(metadataKey, this.sessionStore);
      if (stored) {
        this._sessionMetadata = new Map(Object.entries(stored));
      }
    } catch (error) {
      console.warn("[Store] Failed to load session metadata:", error);
    }
  }

  private async _saveSessionMetadata(): Promise<void> {
    try {
      const metadataKey = `metadata-${this._userId}`;
      const obj = Object.fromEntries(this._sessionMetadata);
      await set(metadataKey, obj, this.sessionStore);
    } catch (error) {
      console.warn("[Store] Failed to save session metadata:", error);
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
        isValid: true,
      };
    } else {
      console.warn(`[Store] Invalid session identifier format: ${identifier}`);
      return {
        userId: this._userId,
        recipientId: identifier,
        deviceId: 1,
        isValid: false,
      };
    }
  }

  private async _getIdentity(): Promise<StorableIdentity | undefined> {
    // ✅ 使用实例隔离的 identityStore
    return get<StorableIdentity>(this._userId, this.identityStore);
  }

  private async _setIdentity(identity: StorableIdentity): Promise<void> {
    // ✅ 使用实例隔离的 identityStore
    await set(this._userId, identity, this.identityStore);
  }

  // ===================== Identity =====================

  async getIdentityKeyPair(): Promise<{
    pubKey: ArrayBuffer;
    privKey: ArrayBuffer;
  }> {
    const identity = await this._getIdentity();
    if (!identity) throw new Error("Identity not found");
    return {
      pubKey: fromBase64(identity.identityKeyPair.pubKey).buffer,
      privKey: fromBase64(identity.identityKeyPair.privKey).buffer,
    };
  }

  async getLocalRegistrationId(): Promise<number> {
    return 1;
  }

  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer,
  ): Promise<boolean> {
    // ✅ 使用实例隔离的 trustStore
    const existing = await get<string>(
      `identity-${encodedAddress}`,
      this.trustStore,
    );
    const pubKeyB64 = toBase64(new Uint8Array(publicKey));

    if (existing && existing !== pubKeyB64) {
      console.warn(`[Store] Identity changed for ${encodedAddress}`);
      return false;
    }

    await set(`identity-${encodedAddress}`, pubKeyB64, this.trustStore);
    return true;
  }

  async isTrustedIdentity(
    encodedAddress: string,
    identityKey: ArrayBuffer,
  ): Promise<boolean> {
    // ✅ 使用实例隔离的 trustStore
    const known = await get<string>(
      `identity-${encodedAddress}`,
      this.trustStore,
    );
    const current = toBase64(new Uint8Array(identityKey));

    if (!known) {
      console.warn(`[Store] First encounter with identity: ${encodedAddress}`);
      await set(`identity-${encodedAddress}`, current, this.trustStore);
      return true;
    }

    return known === current;
  }

  // ===================== PreKeys =====================

  async loadPreKey(
    keyId: number,
  ): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
    const identity = await this._getIdentity();

    // 先尝试从 oneTimePreKeys 中查找
    const preKey = identity?.oneTimePreKeys.find((pk) => pk.keyId === keyId);

    if (preKey) {
      console.log(`[Store] Found OneTimePreKey ${keyId}`);
      return {
        pubKey: fromBase64(preKey.pubKey).buffer,
        privKey: fromBase64(preKey.privKey).buffer,
      };
    }

    // 如果找不到，尝试使用 SignedPreKey 作为后备
    console.warn(
      `[Store] PreKey ${keyId} not found in OneTimePreKeys, trying SignedPreKey`,
    );

    if (!identity) throw new Error("Identity not found");

    // 检查是否是 SignedPreKey
    if (identity.signedPreKey.keyId === keyId) {
      return {
        pubKey: fromBase64(identity.signedPreKey.pubKey).buffer,
        privKey: fromBase64(identity.signedPreKey.privKey).buffer,
      };
    }

    // 如果都找不到，使用 SignedPreKey 作为通用后备
    console.warn(`[Store] Using SignedPreKey as fallback for PreKey ${keyId}`);
    return {
      pubKey: fromBase64(identity.signedPreKey.pubKey).buffer,
      privKey: fromBase64(identity.signedPreKey.privKey).buffer,
    };
  }

  async storePreKey(
    keyId: number,
    keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer },
  ): Promise<void> {
    const identity = await this._getIdentity();
    if (!identity) throw new Error("Identity not found");

    identity.oneTimePreKeys.push({
      keyId,
      pubKey: toBase64(new Uint8Array(keyPair.pubKey)),
      privKey: toBase64(new Uint8Array(keyPair.privKey)),
    });

    await this._setIdentity(identity);
  }

  //不删除PreKey
  async removePreKey(keyId: number): Promise<void> {
    console.log(
      `[Store] PreKey ${keyId} removal requested but ignored (no key rotation)`,
    );
    return Promise.resolve();
  }

  // ===================== SignedPreKeys =====================

  async loadSignedPreKey(
    keyId: number,
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
    keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer },
  ): Promise<void> {
    const identity = await this._getIdentity();
    if (!identity) throw new Error("Identity not found");

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
        pubKey: "",
        privKey: "",
        signature: "",
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

    // ✅ 使用实例隔离的 sessionStore
    const session = await get<string>(identifier, this.sessionStore);
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
      console.warn(
        `[Store] Storing session with invalid identifier: ${identifier}`,
      );
    }

    // 更新会话元数据
    // ✅ 使用实例隔离的 sessionStore
    const existingSession = await get<string>(identifier, this.sessionStore);
    const isNew = !existingSession;

    let metadata = this._sessionMetadata.get(identifier);
    if (!metadata) {
      metadata = {
        recipientId,
        createdAt: Date.now(),
        messageCount: 0,
        lastAccessed: Date.now(),
      };
    } else {
      metadata.lastAccessed = Date.now();
      metadata.messageCount++; // 递增消息计数
    }

    this._sessionMetadata.set(identifier, metadata);
    await this._saveSessionMetadata();

    // 调用回调函数
    if (this._onSessionUpdate) {
      const stateInfo: SessionStateInfo = {
        identifier,
        timestamp: Date.now(),
        isNew,
        hasPreKeyMessage: isNew,
        metadata: {
          userId: this._userId,
          recipientId,
        },
      };

      try {
        this._onSessionUpdate(stateInfo);
      } catch (error) {
        console.error("[Store] Session update callback failed:", error);
      }
    }

    // 定期清理过期会话
    await this._cleanupExpiredSessions();

    // 存储实际的会话记录
    // ✅ 使用实例隔离的 sessionStore
    return set(identifier, record, this.sessionStore);
  }

  async removeSession(identifier: string): Promise<void> {
    console.log(`[Store] 删除会话: ${identifier}`);
    this._sessionMetadata.delete(identifier);
    await this._saveSessionMetadata();
    // ✅ 使用实例隔离的 sessionStore
    await set(identifier, undefined, this.sessionStore);
  }

  /**
   * 清理过期会话（30天未访问）
   */
  private async _cleanupExpiredSessions(): Promise<void> {
    const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30天
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 每天执行一次

    const lastCleanup = localStorage.getItem(`lastCleanup_${this._userId}`);
    const now = Date.now();

    if (lastCleanup && now - parseInt(lastCleanup) < CLEANUP_INTERVAL) {
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
      console.warn("[Store] Session cleanup error:", error);
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
    return Array.from(this._sessionMetadata.entries()).map(
      ([identifier, metadata]) => ({
        identifier,
        ...metadata,
        ageMinutes: Math.floor((now - metadata.createdAt) / (1000 * 60)),
      }),
    );
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
