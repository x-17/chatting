// src/e2ee/protocol/sender-key-session.ts

import { cryptoHelper } from '../crypto/crypto-helper';
import type {
    ISenderKeyState,
    ISenderKeyMessage,
    ISenderKeyDistributionMessage,
} from './types';

// ✅ Signal 风格的种子常量（参考 libsignal 实现）
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
const CHAIN_KEY_SEED = new Uint8Array([0x02]);

const MAX_MESSAGE_KEYS = 2000;

export class SenderKeySession {
    private state: ISenderKeyState;
    private readonly senderId: string;
    private readonly orderId: string;

    private constructor(state: ISenderKeyState, senderId: string, orderId: string) {
        this.state = state;
        this.senderId = senderId;
        this.orderId = orderId;
    }

    /**
     * 清理过时的消息密钥缓存
     */
    private cleanStaleMessageKeys() {
        const currentIteration = this.state.chainKey.iteration;
        const minIteration = currentIteration - MAX_MESSAGE_KEYS;

        for (const iteration of this.state.messageKeys.keys()) {
            if (iteration < minIteration) {
                this.state.messageKeys.delete(iteration);
            }
        }
    }

    public static createFromState(state: ISenderKeyState, senderId: string, orderId: string): SenderKeySession {
        return new SenderKeySession(state, senderId, orderId);
    }

    public static createSession(myUserId: string, orderId: string): SenderKeySession {
        const senderKeyId = Math.floor(Date.now() / 1000);
        const signingKeyPair = cryptoHelper.createSigningKeyPair();
        const chainKeySeed = cryptoHelper.createSymmetricKey();

        const state: ISenderKeyState = {
            senderKeyId,
            signingPublicKey: signingKeyPair.publicKey,
            signingPrivateKey: signingKeyPair.privateKey,
            chainKey: { iteration: 0, key: chainKeySeed },
            messageKeys: new Map(),
        };

        return new SenderKeySession(state, myUserId, orderId);
    }

    public static createFromDistribution(distMessage: ISenderKeyDistributionMessage): SenderKeySession {
        const state: ISenderKeyState = {
            senderKeyId: distMessage.senderKeyId,
            signingPublicKey: distMessage.signingPublicKey,
            chainKey: { iteration: distMessage.iteration, key: distMessage.chainKey },
            messageKeys: new Map(),
        };

        return new SenderKeySession(state, distMessage.senderId || '', distMessage.orderId);
    }

    public getState(): ISenderKeyState {
        return this.state;
    }

    public getDistributionMessage(): Omit<ISenderKeyDistributionMessage, 'orderId'> {
        return {
            senderKeyId: this.state.senderKeyId,
            iteration: this.state.chainKey.iteration,
            chainKey: this.state.chainKey.key,
            signingPublicKey: this.state.signingPublicKey,
            senderId: this.senderId,
        };
    }

    /**
     * ✅ Signal 风格的加密实现（确定性密钥派生）
     */
    public ratchetEncrypt(plaintext: Uint8Array): Omit<ISenderKeyMessage, 'orderId' | 'senderId'> {
        if (!this.state.signingPrivateKey) {
            throw new Error('无法加密消息：此会话仅为接收而创建（缺少私钥）。');
        }

        const currentIteration = this.state.chainKey.iteration;
        const currentChainKey = this.state.chainKey.key;

        console.log(`[SenderKey-Encrypt] ${this.senderId} encrypting with iteration: ${currentIteration}`);

        // ✅ 1. 使用 HMAC-SHA256 确定性派生消息密钥（Signal 官方方案）
        const messageKey = cryptoHelper.hmacSHA256(currentChainKey, MESSAGE_KEY_SEED);

        // 2. 加密消息
        const ciphertext = cryptoHelper.encrypt(messageKey, plaintext);

        // 3. 签名
        const encoder = new TextEncoder();
        const dataToSign = cryptoHelper.concatBuffers(
            encoder.encode(this.orderId),
            encoder.encode(this.senderId),
            cryptoHelper.numberToUint8Array(this.state.senderKeyId),
            cryptoHelper.numberToUint8Array(currentIteration),
            ciphertext  // ✅ 签名内容不包含盐
        );
        const signature = cryptoHelper.sign(this.state.signingPrivateKey, dataToSign);

        // ✅ 4. 使用 HMAC-SHA256 确定性派生下一个链密钥
        const nextChainKey = cryptoHelper.hmacSHA256(currentChainKey, CHAIN_KEY_SEED);

        // 5. 更新状态
        this.state.chainKey = {
            iteration: currentIteration + 1,
            key: nextChainKey,
        };

        console.log(`[SenderKey-Encrypt] ${this.senderId} advanced to iteration: ${currentIteration + 1}`);

        // ✅ 返回值不包含 messageKeySalt
        return {
            senderKeyId: this.state.senderKeyId,
            iteration: currentIteration,
            ciphertext: ciphertext,
            signature: signature,
        };
    }

    /**
     * ✅ Signal 风格的解密实现（支持完整的乱序消息）
     */
    public ratchetDecrypt(message: ISenderKeyMessage): Uint8Array {
        // 验证基本信息
        if (message.orderId !== this.orderId) {
            throw new Error(`群组 ID 不匹配：期望 ${this.orderId}，收到 ${message.orderId}`);
        }
        if (message.senderId !== this.senderId) {
            throw new Error(`发送者 ID 不匹配：期望 ${this.senderId}，收到 ${message.senderId}`);
        }
        if (message.senderKeyId !== this.state.senderKeyId) {
            throw new Error('密钥 ID 不匹配。可能需要更新会话。');
        }

        // 验证签名（不包含 messageKeySalt）
        const encoder = new TextEncoder();
        const dataToVerify = cryptoHelper.concatBuffers(
            encoder.encode(message.orderId),
            encoder.encode(message.senderId),
            cryptoHelper.numberToUint8Array(message.senderKeyId),
            cryptoHelper.numberToUint8Array(message.iteration),
            message.ciphertext
        );

        const signatureValid = cryptoHelper.verify(
            this.state.signingPublicKey,
            message.signature,
            dataToVerify
        );

        if (!signatureValid) {
            throw new Error('消息签名验证失败！');
        }

        const messageIteration = message.iteration;
        const currentIteration = this.state.chainKey.iteration;

        console.log(
            `[SenderKey-Decrypt] ${this.senderId} message iteration: ${messageIteration}, ` +
            `current iteration: ${currentIteration}`
        );

        let messageKey: Uint8Array;

        // ✅ 情况1：检查是否有缓存的消息密钥（处理之前跳过的消息）
        const cachedKey = this.state.messageKeys.get(messageIteration);
        if (cachedKey) {
            messageKey = cachedKey;
            this.state.messageKeys.delete(messageIteration);
            console.log(`[SenderKey-Decrypt] ${this.senderId} using cached key for iteration ${messageIteration}`);
        }
        // ✅ 情况2：处理当前或未来的消息
        else if (messageIteration >= currentIteration) {
            // 检查跳过的消息数量是否超过限制
            if (messageIteration - currentIteration > MAX_MESSAGE_KEYS) {
                throw new Error(
                    `消息迭代次数远超当前状态：` +
                    `消息 iteration=${messageIteration}，当前 iteration=${currentIteration}，` +
                    `超过最大间隔 ${MAX_MESSAGE_KEYS}`
                );
            }

            console.log(
                `[SenderKey-Decrypt] ${this.senderId} advancing chain from ${currentIteration} to ${messageIteration}`
            );

            let workingChainKey = this.state.chainKey.key;

            // 推进链密钥到目标迭代
            for (let i = currentIteration; i <= messageIteration; i++) {
                // ✅ 使用 HMAC-SHA256 确定性派生消息密钥
                const derivedMessageKey = cryptoHelper.hmacSHA256(workingChainKey, MESSAGE_KEY_SEED);

                if (i === messageIteration) {
                    // 目标迭代：使用这个密钥解密
                    messageKey = derivedMessageKey;
                    console.log(
                        `[SenderKey-Decrypt] ${this.senderId} derived message key for target iteration ${i}`
                    );
                } else {
                    // ✅ 中间迭代：缓存消息密钥（用于将来可能到达的乱序消息）
                    this.state.messageKeys.set(i, derivedMessageKey);
                    console.log(
                        `[SenderKey-Decrypt] ${this.senderId} cached message key for skipped iteration ${i}`
                    );
                }

                // ✅ 使用 HMAC-SHA256 确定性派生下一个链密钥
                workingChainKey = cryptoHelper.hmacSHA256(workingChainKey, CHAIN_KEY_SEED);
            }

            // 更新链状态到消息迭代的下一个状态
            this.state.chainKey = {
                iteration: messageIteration + 1,
                key: workingChainKey,
            };

            console.log(`[SenderKey-Decrypt] ${this.senderId} updated chain to iteration ${messageIteration + 1}`);
        }
        // ✅ 情况3：过时的消息（迭代次数小于当前状态）
        else {
            throw new Error(
                `无法处理迭代 ${messageIteration} 的消息（当前迭代: ${currentIteration}）。` +
                `原因：该消息在收到更新的消息后到达，密钥已被推进，无法恢复。` +
                `建议：这可能是网络延迟导致的，可以忽略此消息。`
            );
        }

        // 清理过时的消息密钥缓存
        this.cleanStaleMessageKeys();

        // 解密消息
        const plaintext = cryptoHelper.decrypt(messageKey!, message.ciphertext);
        if (plaintext === null) {
            throw new Error('解密失败，密文可能已损坏。');
        }

        console.log(`[SenderKey-Decrypt] ${this.senderId} successfully decrypted iteration ${messageIteration}`);

        return plaintext;
    }
}