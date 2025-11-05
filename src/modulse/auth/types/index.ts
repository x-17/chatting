// types/index.ts

/** * E2EE模块生成的公钥集合
 */
export interface E2eePublicKeySet {
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

/** 用户信息结构 */
export interface User {
    id: string;      // 使用北数所返回的 openId 作为系统内唯一ID
    openid: string;
    userName: string;
    password: string | null;

}

