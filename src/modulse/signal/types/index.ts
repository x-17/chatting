// types/index.ts

// 可存储的密钥对格式
export interface StorableKeyPair {
    pubKey: string; // Base64
    privKey: string; // Base64
}

// 可存储的签名预共享密钥
export interface StorableSignedPreKey extends StorableKeyPair {
    keyId: number;
    signature: string; // Base64
}

// 可存储的一次性预共享密钥
export interface StorablePreKey extends StorableKeyPair {
    keyId: number;
}

// 数据库中存储的完整身份信息
export interface StorableIdentity {
    userId: string;
    identityKeyPair: StorableKeyPair;
    signedPreKey: StorableSignedPreKey;
    oneTimePreKeys: StorablePreKey[];
    // 用于文件签名的密钥
    signingKeyPair: StorableKeyPair;
}

// 用于网络传输的公钥束
export interface PublicKeyBundle {
    userId: string;
    identityKey: string;      // Base64
    signedPreKey: {
        keyId: number;
        publicKey: string;    // Base64
        signature: string;    // Base64
    };
    preKey: {                // 一次性公钥，，建立会话时使用
        keyId: number;
        publicKey: string;    // Base64
    };
    signingPubKey: string; // 用于文件签名的公钥, Base64
}

// Signal协议需要的会话记录
export interface SessionRecord {
    sessionId: string;
    record: string; // Serialized session record
}