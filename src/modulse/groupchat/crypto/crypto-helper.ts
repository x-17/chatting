// src/e2ee/crypto/crypto-helper.ts

import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';

/**
 * 该模块封装了所有底层的加密操作，使用 tweetnacl 和 @noble/hashes 库。
 */

// --- 类型别名，提高代码可读性 ---
export type SymmetricKey = Uint8Array;
export type SigningPublicKey = Uint8Array;
export type SigningPrivateKey = Uint8Array;
export type Signature = Uint8Array;
export type Salt = Uint8Array;

export interface SigningKeyPair {
    publicKey: SigningPublicKey;
    privateKey: SigningPrivateKey;
}

const SALT_LENGTH = 32; // 定义盐的长度，32字节 (256位) 是一个安全的选择

export const cryptoHelper = {
    // --- 密钥和随机值生成 ---
    createSymmetricKey: (): SymmetricKey => {
        return nacl.randomBytes(nacl.secretbox.keyLength);
    },

    createSigningKeyPair: (): SigningKeyPair => {
        const keyPair = nacl.sign.keyPair();
        return {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.secretKey,
        };
    },

    /**
     * 创建一个用于密钥派生的随机盐值。
     * @returns 一个指定长度的随机字节数组 (Uint8Array)。
     */
    createSalt: (): Salt => {
        return nacl.randomBytes(SALT_LENGTH);
    },

    /**
     * HKDF 密钥派生。从一个输入密钥中派生出一个新的对称密钥。
     * @param material - 输入的密钥材料，如链密钥。
     * @param salt - 一个非秘密的随机值。
     * @param info - 应用程序特定的上下文信息。
     * @returns 派生出的新对称密钥 (Uint8Array)。
     */
    deriveKey: (
        material: SymmetricKey,
        salt: Salt,
        info: string
    ): SymmetricKey => {
        // @noble/hashes/hkdf 是同步函数，因此我们可以直接返回结果。
        return hkdf(sha256, material, salt, info, nacl.secretbox.keyLength);
    },

    /**
     * 用于 Sender Key 协议的消息密钥和链密钥派生
     * @param key - HMAC 密钥
     * @param data - 要处理的数据（通常是种子值）
     * @returns HMAC-SHA256 结果 (32 字节)
     */
    hmacSHA256: (key: Uint8Array, data: Uint8Array): Uint8Array => {
        return hmac(sha256, key, data);
    },

    // --- 核心加解密与签名验签 ---
    encrypt: (key: SymmetricKey, data: Uint8Array): Uint8Array => {
        const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        const ciphertext = nacl.secretbox(data, nonce, key);
        const result = new Uint8Array(nonce.length + ciphertext.length);
        result.set(nonce);
        result.set(ciphertext, nonce.length);
        return result;
    },

    decrypt: (key: SymmetricKey, dataWithNonce: Uint8Array): Uint8Array | null => {
        const nonce = dataWithNonce.slice(0, nacl.secretbox.nonceLength);
        const ciphertext = dataWithNonce.slice(nacl.secretbox.nonceLength);
        return nacl.secretbox.open(ciphertext, nonce, key);
    },

    sign: (privateKey: SigningPrivateKey, data: Uint8Array): Signature => {
        return nacl.sign.detached(data, privateKey);
    },

    verify: (
        publicKey: SigningPublicKey,
        signature: Signature,
        data: Uint8Array
    ): boolean => {
        return nacl.sign.detached.verify(data, signature, publicKey);
    },

    // --- 工具函数 ---
    concatBuffers: (...buffers: Uint8Array[]): Uint8Array => {
        const totalLength = buffers.reduce((acc, val) => acc + val.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            result.set(buffer, offset);
            offset += buffer.length;
        }
        return result;
    },

    numberToUint8Array: (num: number): Uint8Array => {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setUint32(0, num, false); // false 代表大端序 (Big Endian)
        return new Uint8Array(buffer);
    },
};