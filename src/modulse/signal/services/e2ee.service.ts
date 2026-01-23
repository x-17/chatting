// services/e2ee.service.ts

import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
} from "@privacyresearch/libsignal-protocol-typescript";
import * as ed from "@noble/ed25519";
import { fromBase64, toBase64 } from "../utils/e2ee.utils";
import {
  IndexedDbSignalProtocolStore,
  type SessionStateInfo,
} from "./signal.store";
import type { StorableIdentity, PublicKeyBundle } from "../types";
import { get as idbGet, set as idbSet, createStore } from "idb-keyval";
import { getKeyBundleForUser } from "./users.api.ts";
import { createAuthenticatedApiClient } from "../../utils/api-client";

// 创建用于存储身份的 IndexedDB store
const identityDbStore = createStore("e2ee-identity-store", "identities");

// ========== 新增：简单的异步锁 ==========
class AsyncLock {
  private promise: Promise<void> = Promise.resolve();

  async acquire<T>(task: () => Promise<T>): Promise<T> {
    let release: () => void;

    // 创建一个新的 Promise，它的 resolve 函数就是我们的释放器
    const nextPromise = new Promise<void>(resolve => {
      release = resolve;
    });

    // 等待上一个任务完成
    const previousPromise = this.promise;

    // 将当前任务加入链条：不管上一个任务成功还是失败，都要执行当前任务
    // 这里的 catch 是为了防止上一个任务失败阻塞整个队列
    this.promise = this.promise.then(() => nextPromise).catch(() => nextPromise);

    // 等待上一个任务真正的完成（或者失败）后，再执行当前任务
    try {
      await previousPromise;
    } catch {
      // 忽略上一个任务的错误
    }

    try {
      return await task();
    } finally {
      // 任务执行完（无论成功失败），释放锁，让下一个任务可以开始
      release!();
    }
  }
}

// ========== 修改开始：新增类型定义 ==========

/**
 * 解密结果结构
 */
export interface DecryptionResult {
  success: boolean;
  content?: string;
  error?: string;
  errorType?:
  | "SESSION_EXPIRED"
  | "DECRYPTION_FAILED"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";
  needsRecovery?: boolean;
}

/**
 * 加密结果结构
 */
export interface EncryptionResult {
  success: boolean;
  ciphertext?: any;
  error?: string;
  errorType?:
  | "SESSION_ERROR"
  | "ENCRYPTION_FAILED"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";
}

/**
 * 分析解密错误类型
 */
function analyzeDecryptionError(error: any): {
  errorType: DecryptionResult["errorType"];
  needsRecovery: boolean;
} {
  const errorMessage = error?.message?.toLowerCase() || "";

  // 需要会话恢复的错误类型
  const recoverableErrors = [
    "session not found",
    "invalid key",
    "ratchet error",
    "message index",
    "no session",
  ];

  const needsRecovery = recoverableErrors.some((pattern) =>
    errorMessage.includes(pattern)
  );

  let errorType: DecryptionResult["errorType"] = "UNKNOWN_ERROR";

  if (needsRecovery) {
    errorType = "SESSION_EXPIRED";
  } else if (
    errorMessage.includes("network") ||
    errorMessage.includes("timeout")
  ) {
    errorType = "NETWORK_ERROR";
  } else {
    errorType = "DECRYPTION_FAILED";
  }

  return {
    errorType,
    needsRecovery,
  };
}

/**
 * 分析加密错误类型
 */
function analyzeEncryptionError(error: any): {
  errorType: EncryptionResult["errorType"];
} {
  const errorMessage = error?.message?.toLowerCase() || "";

  let errorType: EncryptionResult["errorType"] = "UNKNOWN_ERROR";

  if (errorMessage.includes("session") || errorMessage.includes("key")) {
    errorType = "SESSION_ERROR";
  } else if (
    errorMessage.includes("network") ||
    errorMessage.includes("timeout")
  ) {
    errorType = "NETWORK_ERROR";
  } else {
    errorType = "ENCRYPTION_FAILED";
  }

  return { errorType };
}

/**
 * 获取用户友好的错误消息 - 真正的私有函数
 */
function getUserFriendlyErrorMessage(analysis: any): string {
  const errorMessages = {
    SESSION_EXPIRED: "加密会话已过期，需要重新建立连接",
    DECRYPTION_FAILED: "无法解密消息，请检查消息完整性",
    ENCRYPTION_FAILED: "加密失败，请重试",
    SESSION_ERROR: "会话错误，请检查连接状态",
    NETWORK_ERROR: "网络连接问题，请检查网络后重试",
    UNKNOWN_ERROR: "处理消息时发生未知错误",
  };

  return errorMessages[analysis.errorType] || errorMessages.UNKNOWN_ERROR;
}
/**
 * 获取指定用户的 signingKeyPair 私钥
 * @param userId 用户唯一ID
 * @returns 私钥的 Base64 字符串（如果存在）
 */
export async function getSigningPrivateKey(
  userId: string
): Promise<string | undefined> {
  try {
    // 从 IndexedDB 中获取用户身份信息
    const identity: StorableIdentity | undefined = await idbGet(
      userId,
      identityDbStore
    );

    if (!identity) {
      console.warn(`用户 ${userId} 的身份信息不存在`);
      return undefined;
    }

    // 返回 signingKeyPair 中的 privKey
    return identity.signingKeyPair.privKey;
  } catch (error) {
    console.error("获取签名私钥失败:", error);
    return undefined;
  }
}
// ========== 修改结束 ==========

/**
 * E2EE模块的主服务 - 增强版本
 */
export const e2eeService = {
  // ✅ 会话锁 Map
  sessionLocks: new Map<string, AsyncLock>(),

  /**
   * 获取或创建用户的会话锁
   */
  getLock(userId: string, targetId: string): AsyncLock {
    const key = `${userId}-${targetId}`;
    if (!this.sessionLocks.has(key)) {
      this.sessionLocks.set(key, new AsyncLock());
    }
    return this.sessionLocks.get(key)!;
  },

  /**
   * 检查指定用户的密钥是否已存在于IndexedDB中
   * @param userId 用户的唯一ID
   */
  async keysExistForUser(userId: string): Promise<boolean> {
    try {
      const identity = await idbGet<StorableIdentity>(userId, identityDbStore);
      return !!identity;
    } catch (error) {
      console.error(`[E2EE] Error checking keys for ${userId}:`, error);
      return false;
    }
  },

  /**
   * 为用户生成所有密钥(通信+签名)，存入IndexedDB，并返回公钥部分。
   * @param userId 用户的唯一ID
   */
  async initializeKeysForUser(userId: string): Promise<PublicKeyBundle> {
    console.log(`[E2EE] 正在为用户 ${userId} 初始化密钥...`);

    try {
      // 1. 生成通信密钥
      const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
      const signedPreKeyId = Number(
        String(Date.now() * 1000 + Math.floor(10000 * Math.random())).slice(-9)
      );
      const signedPreKey = await KeyHelper.generateSignedPreKey(
        identityKeyPair,
        signedPreKeyId
      );
      //若要增加密钥轮转oneTimePrekeyIdID应递增生成一组
      const oneTimePreKeyId = Number(
        String(Date.now() * 1000 + Math.floor(1000 * Math.random())).slice(-9)
      );
      const oneTimePreKey = await KeyHelper.generatePreKey(oneTimePreKeyId);

      // 2. 生成文件签名密钥
      const signingPrivateKey = ed.utils.randomPrivateKey();
      const signingPublicKey = ed.getPublicKey(signingPrivateKey);

      // 3. 准备存储到IndexedDB
      const storableIdentity: StorableIdentity = {
        userId,
        identityKeyPair: {
          pubKey: toBase64(identityKeyPair.pubKey),
          privKey: toBase64(identityKeyPair.privKey),
        },
        signedPreKey: {
          keyId: signedPreKeyId,
          pubKey: toBase64(signedPreKey.keyPair.pubKey),
          privKey: toBase64(signedPreKey.keyPair.privKey),
          signature: toBase64(signedPreKey.signature),
        },
        oneTimePreKeys: [
          {
            keyId: oneTimePreKey.keyId,
            pubKey: toBase64(oneTimePreKey.keyPair.pubKey),
            privKey: toBase64(oneTimePreKey.keyPair.privKey),
          },
        ],
        signingKeyPair: {
          pubKey: toBase64(signingPublicKey),
          privKey: toBase64(signingPrivateKey),
        },
      };

      // 4. 存入数据库
      await idbSet(userId, storableIdentity, identityDbStore);

      // 5. 返回公钥部分，用于上报给服务器
      const publicKeyBundle: PublicKeyBundle = {
        userId,
        identityKey: storableIdentity.identityKeyPair.pubKey,
        signedPreKey: {
          keyId: storableIdentity.signedPreKey.keyId,
          publicKey: storableIdentity.signedPreKey.pubKey,
          signature: storableIdentity.signedPreKey.signature,
        },
        preKey: {
          keyId: storableIdentity.oneTimePreKeys[0].keyId,
          publicKey: storableIdentity.oneTimePreKeys[0].pubKey,
        },
        signingPubKey: storableIdentity.signingKeyPair.pubKey,
      };

      console.log(`[E2EE] 用户 ${userId} 密钥初始化完成`);
      return publicKeyBundle;
    } catch (error) {
      console.error(`[E2EE] 用户 ${userId} 密钥初始化失败:`, error);
      throw new Error(
        `Failed to initialize keys for ${userId}: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },

  /**
   * 确保与接收者的加密会话已建立。
   * 如果会话不存在，则从服务器获取其公钥束并建立新会话。
   * @param myId 我自己的用户ID
   * @param recipientId 接收者的用户ID
   */
  async ensureSession(myId: string, recipientId: string): Promise<void> {

    // ✅ 加上锁，防止多个请求同时创建会话
    const lock = this.getLock(myId, recipientId);

    return lock.acquire(async () => {
      console.log(`[E2EE] ${myId} 确保与 ${recipientId} 的会话...`);

      const store = new IndexedDbSignalProtocolStore(myId);
      const address = new SignalProtocolAddress(recipientId, 1);

      try {
        // 检查会话是否已存在
        const session = await store.loadSession(address.toString());
        if (session) {
          console.log(`[E2EE] ${myId} 与 ${recipientId} 的会话已存在`);
          return;
        }

        console.log(`[E2EE] ${myId} 与 ${recipientId} 的会话不存在，正在建立...`);

        // 1. 从服务器获取接收者的公钥束
        const recipientBundle = await getKeyBundleForUser(recipientId);
        console.log(`[E2EE] 获取到 ${recipientId} 的公钥束`);

        // 2. 使用 SessionBuilder 建立会话
        const sessionBuilder = new SessionBuilder(store, address);

        // 3. 处理公钥束，完成X3DH密钥交换
        // @ts-ignore - libsignal的类型有时需要忽略
        await sessionBuilder.processPreKey({
          registrationId: 0,
          identityKey: fromBase64(recipientBundle.identityKey).buffer,
          signedPreKey: {
            keyId: recipientBundle.signedPreKey.keyId,
            publicKey: fromBase64(recipientBundle.signedPreKey.publicKey).buffer,
            signature: fromBase64(recipientBundle.signedPreKey.signature).buffer,
          },
          preKey: {
            keyId: recipientBundle.preKey.keyId,
            publicKey: fromBase64(recipientBundle.preKey.publicKey).buffer,
          },
        });

        console.log(`[E2EE] ${myId} 与 ${recipientId} 的会话建立成功`);
      } catch (error) {
        console.error(`[E2EE] ${myId} 与 ${recipientId} 建立会话失败:`, error);
        throw new Error(
          `Could not establish session: ${error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });
  },

  // ========== 修改开始：增强加密方法 ==========

  /**
   * 加密一条消息 - 增强版本（并发安全 + Base64 强化）
   * @param myId 我自己的用户ID
   * @param recipientId 接收者的用户ID
   * @param message 明文消息
   * @param onSessionUpdate 会话状态更新回调
   */
  async encryptMessage(
    myId: string,
    recipientId: string,
    message: string,
    onSessionUpdate?: (stateInfo: SessionStateInfo) => void
  ): Promise<EncryptionResult> {
    console.log(`[E2EE] ${myId} 正在为 ${recipientId} 加密消息 (Queuing)`);

    // ✅ 加锁
    const lock = this.getLock(myId, recipientId);

    return lock.acquire(async () => {
      console.log(`[E2EE] ${myId} 正在为 ${recipientId} 加密消息 (Processing)`);
      try {
        const store = new IndexedDbSignalProtocolStore(myId, onSessionUpdate);
        const address = new SignalProtocolAddress(recipientId, 1);

        // ✅ Check if session exists, if not establish it (Auto-Heal)
        const hasSession = await store.loadSession(address.toString());
        if (!hasSession) {
          console.log(`[E2EE] No session found for ${recipientId} during encrypt, establishing now...`);
          const recipientBundle = await getKeyBundleForUser(recipientId);
          const sessionBuilder = new SessionBuilder(store, address);
          // @ts-ignore
          await sessionBuilder.processPreKey({
            registrationId: 0,
            identityKey: fromBase64(recipientBundle.identityKey).buffer,
            signedPreKey: {
              keyId: recipientBundle.signedPreKey.keyId,
              publicKey: fromBase64(recipientBundle.signedPreKey.publicKey).buffer,
              signature: fromBase64(recipientBundle.signedPreKey.signature).buffer,
            },
            preKey: {
              keyId: recipientBundle.preKey.keyId,
              publicKey: fromBase64(recipientBundle.preKey.publicKey).buffer,
            },
          });
          console.log(`[E2EE] Session established successfully for ${recipientId}`);
        }

        const cipher = new SessionCipher(store, address);

        const ciphertext = await cipher.encrypt(
          new TextEncoder().encode(message).buffer
        );

        console.log(`[E2EE] ${myId} 消息加密成功，类型: ${ciphertext.type}`);

        // ✅ 强制转换 body 为 Base64 以便安全传输 (如果是 binary string)
        if (typeof ciphertext.body === 'string') {
          // libsignal 在 Web 环境下生成的 body 通畅是 binary string ("latins")
          // 但为了防止 JSON.stringify 损坏它，我们将其转换为 Base64
          // 注意：libsignal-protocol-typescript 这里的类型很乱，有时是 ArrayBuffer 有时是 string
          // 如果是 string (binary string)，我们转为 base64

          console.log(`[E2EE] encrypt: converting binary string to base64. Len: ${ciphertext.body.length}`);

          // 正确的做法：先将 binary string 转回 Uint8Array，再转 Base64
          const binStr = ciphertext.body;
          const len = binStr.length;
          const arr = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            arr[i] = binStr.charCodeAt(i);
          }
          // @ts-ignore
          ciphertext.body = toBase64(arr);
        } else if ((ciphertext.body as any) instanceof ArrayBuffer || (ciphertext.body as any) instanceof Uint8Array) {
          console.log(`[E2EE] encrypt: converting buffer to base64.`);
          // @ts-ignore
          ciphertext.body = toBase64(ciphertext.body);
        }

        return {
          success: true,
          ciphertext: ciphertext,
        };
      } catch (error) {
        console.error(`[E2EE] ${myId} 加密消息失败:`, error);

        const errorAnalysis = analyzeEncryptionError(error); // 🔑 使用私有函数

        return {
          success: false,
          error: getUserFriendlyErrorMessage(errorAnalysis), // 🔑 使用私有函数
          errorType: errorAnalysis.errorType,
        };
      }
    });
  },

  // ========== 修改结束 ==========

  // ========== 修改开始：增强解密方法 ==========

  /**
   * 解密一条消息 - 增强版本（并发安全 + Base64 自动解码）
   * @param myId 我自己的用户ID
   * @param senderId 发送方的用户ID
   * @param ciphertext 加密消息体
   * @param onSessionUpdate 会话状态更新回调
   */
  async decryptMessage(
    myId: string,
    senderId: string,
    ciphertext: any,
    onSessionUpdate?: (stateInfo: SessionStateInfo) => void
  ): Promise<DecryptionResult> {
    console.log(
      `[E2EE] ${myId} 正在解密来自 ${senderId} 的消息 (Queuing)`
    );

    // ✅ 加锁
    const lock = this.getLock(myId, senderId);

    return lock.acquire(async () => {
      console.log(
        `[E2EE] ${myId} 正在解密来自 ${senderId} 的消息 (Processing), 类型: ${ciphertext.type}`
      );
      try {
        const store = new IndexedDbSignalProtocolStore(myId, onSessionUpdate);
        const address = new SignalProtocolAddress(senderId, 1);
        const cipher = new SessionCipher(store, address);

        let bodyBuffer: ArrayBuffer;

        console.log(`[E2EE] ciphertext body type: ${typeof ciphertext.body}`);

        // ✅ 核心修复：处理 Base64 编码的 body
        if (!ciphertext.body) {
          throw new Error("Ciphertext body is missing or empty");
        }

        if (typeof ciphertext.body === 'string') {
          // 假设它是 Base64，尝试解码
          try {
            // 判断是否是 Base64 (简单判断：是否只包含 Base64 字符？或者直接 try catch)
            // 但为了兼容可能的纯 binary string (旧数据)，我们先假设它是 Base64
            // 如果 body 是我们上面 encryptMessage 生成的，它绝对是 Base64
            bodyBuffer = fromBase64(ciphertext.body).buffer as ArrayBuffer;
            console.log(`[E2EE] decrypt: Base64 decoded. Len: ${bodyBuffer.byteLength}`);
          } catch (e) {
            console.warn('[E2EE] Base64 decoding failed, trying raw string', e);
            // Fallback for raw string
            const str = ciphertext.body;
            const buf = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
            bodyBuffer = buf.buffer;
            console.log(`[E2EE] decrypt: Raw string converted. Len: ${bodyBuffer.byteLength}`);
          }
        } else if (ciphertext.body instanceof Uint8Array) {
          console.log(`[E2EE] decrypt: Body is Uint8Array. Len: ${ciphertext.body.length}`);
          bodyBuffer = ciphertext.body.buffer;
        } else {
          console.log(`[E2EE] decrypt: Body is Object/Array. Trying Object.values...`);
          // 如果是 Array-like object (JSON deserialized Uint8Array)
          if (ciphertext.body && typeof ciphertext.body === 'object') {
            const vals = Object.values(ciphertext.body);
            bodyBuffer = new Uint8Array(vals as number[]).buffer;
          } else {
            throw new Error(`Unknown body type: ${typeof ciphertext.body}`);
          }
        }

        let plaintextBuffer: ArrayBuffer;
        if (ciphertext.type === 3) {
          console.log(`[E2EE] 处理 PreKey 消息`);
          plaintextBuffer = await cipher.decryptPreKeyWhisperMessage(
            bodyBuffer!,
            "binary"
          );
        } else {
          console.log(`[E2EE] 处理常规消息`);
          plaintextBuffer = await cipher.decryptWhisperMessage(
            bodyBuffer!,
            "binary"
          );
        }

        const plaintext = new TextDecoder().decode(
          new Uint8Array(plaintextBuffer)
        );
        console.log(`[E2EE] ${myId} 解密成功`);

        return {
          success: true,
          content: plaintext,
        };
      } catch (error) {
        console.error(`[E2EE] ${myId} 解密消息失败:`, error);

        const errorAnalysis = analyzeDecryptionError(error); // 🔑 使用私有函数

        return {
          success: false,
          error: getUserFriendlyErrorMessage(errorAnalysis), // 🔑 使用私有函数
          errorType: errorAnalysis.errorType,
          needsRecovery: errorAnalysis.needsRecovery,
        };
      }
    });

  },

  // ========== 修改结束 ==========

  // ========== 修改开始：新增会话恢复方法 ==========

  /**
   * 恢复与指定用户的会话
   * @param myId 我自己的用户ID
   * @param recipientId 对方的用户ID
   */
  async recoverSession(
    myId: string,
    recipientId: string
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[E2EE] ${myId} 尝试恢复与 ${recipientId} 的会话`);

    try {
      // 1. 清理旧的会话状态
      await this.clearUserSessions(myId);
      console.log(`[E2EE] ${myId} 已清理旧会话`);

      // 2. 重新建立会话
      await this.ensureSession(myId, recipientId);
      console.log(`[E2EE] ${myId} 与 ${recipientId} 的会话恢复成功`);

      return { success: true };
    } catch (error) {
      console.error(`[E2EE] ${myId} 恢复会话失败:`, error);

      return {
        success: false,
        error: `会话恢复失败: ${error instanceof Error ? error.message : String(error)
          }`,
      };
    }
  },

  async getSigningKeyPair(userId: string): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array } | undefined> {
    try {
      // 从 IndexedDB 读取身份信息
      const identity = await idbGet<StorableIdentity>(userId, identityDbStore);

      if (!identity || !identity.signingKeyPair) {
        console.warn(`[E2EE] 未找到用户 ${userId} 的签名密钥`);
        return undefined;
      }

      // 将 Base64 转换为 Uint8Array
      return {
        publicKey: fromBase64(identity.signingKeyPair.pubKey),
        privateKey: fromBase64(identity.signingKeyPair.privKey)
      };
    } catch (error) {
      console.error(`[E2EE] 获取签名密钥对失败:`, error);
      return undefined;
    }
  },

  // ========== 修改结束 ==========

  /**
   * 对合同数据进行签名
   * @param userId 当前用户的ID
   * @param contractData 合同的二进制数据 (Uint8Array)
   * @returns 签名的Base64字符串
   */
  async signContract(
    userId: string,
    contractData: Uint8Array
  ): Promise<string> {
    try {
      const identity = await idbGet<StorableIdentity>(userId, identityDbStore);
      if (!identity) {
        throw new Error(`No keys found for user ${userId}`);
      }

      const privateKey = fromBase64(identity.signingKeyPair.privKey);
      const signature = ed.sign(contractData, privateKey);

      console.log(`[E2EE] ${userId} 签名完成`);
      return toBase64(signature);
    } catch (error) {
      console.error(`[E2EE] ${userId} 签名失败:`, error);
      throw new Error(
        `Signing failed: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },

  /**
   * 验证合同签名
   * @param signatureBase64 签名的Base64字符串
   * @param contractData 合同的二进制数据 (Uint8Array)
   * @param signerPubKeyBase64 签名者的公钥 (Base64)
   * @returns boolean 是否验证通过
   */
  async verifyContractSignature(
    signatureBase64: string,
    contractData: Uint8Array,
    signerPubKeyBase64: string
  ): Promise<boolean> {
    try {
      const signature = fromBase64(signatureBase64);
      const publicKey = fromBase64(signerPubKeyBase64);
      const isValid = ed.verify(signature, contractData, publicKey);

      console.log(`[E2EE] 签名验证结果: ${isValid ? "通过" : "失败"}`);
      return isValid;
    } catch (error) {
      console.error(`[E2EE] 签名验证失败:`, error);
      return false;
    }
  },

  /**
   * 获取用户的公钥信息
   */
  async getUserPublicKeys(
    tenantId: string
  ): Promise<{ identityKey: string; signingPubKey: string } | null> {
    try {
      const apiClient = createAuthenticatedApiClient();
      // 1. 转换tenantId为number类型（匹配后端接口要求），并发起POST请求
      const response = await apiClient.post("/user/getUserKeys", {
        tenantId: Number(tenantId), // 转换为number传给后端
      });

      // 2. 处理后端返回的code状态
      if (response.data.code !== 1) {
        throw new Error(response.data.msg || "获取用户密钥失败");
      }

      const data = response.data.data;
      console.log("[UsersApi] Received key bundle data:", data);

      // 3. 映射后端数据到PublicKeyBundle（userId转为string，适配前端逻辑）
      const publicKeyBundle: PublicKeyBundle = {
        userId: data.userId.toString(), // 后端返回number，前端用string
        identityKey: data.identityKey,
        signedPreKey: {
          keyId: data.signedPreKeyId,
          publicKey: data.signedPreKeyPublicKey, // 对应后端signedPreKeyPublicKey
          signature: data.signedPreKeyPublicKeySignature, // 对应后端签名字段
        },
        preKey: {
          keyId: data.preKeyId,
          publicKey: data.preKeyPublicKey, // 对应后端preKeyPublicKey
        },
        signingPubKey: data.signingPubKey, // 对应后端signingPubKey
      };

      console.log(
        `[UsersApi] 成功获取用户 ${tenantId} 的密钥束，用户ID: ${publicKeyBundle.userId}`
      );
      return publicKeyBundle;
    } catch (error) {
      console.error(`[UsersApi] 获取用户 ${tenantId} 的密钥束失败:`, error);

      if (this.isNotFoundError(error)) {
        throw new Error(`租户 ${tenantId} 的密钥不存在或未注册`);
      } else if (this.isAuthError(error)) {
        throw new Error("身份验证失败，请重新登录");
      }

      throw new Error(
        `获取用户密钥失败: ${error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
  isNotFoundError(error: any): boolean {
    return error?.response?.status === 404;
  },
  isAuthError(error: any): boolean {
    return error?.response?.status === 401;
  },

  /**
   * 清理用户的所有会话数据
   */
  async clearUserSessions(userId: string): Promise<void> {
    try {
      const store = new IndexedDbSignalProtocolStore(userId);
      await store.clearAllSessions();
      console.log(`[E2EE] ${userId} 的所有会话已清理`);
    } catch (error) {
      console.error(`[E2EE] 清理 ${userId} 会话失败:`, error);
      throw error;
    }
  },
};
