// types.ts

import type { SymmetricKey, Signature, SigningPublicKey, SigningPrivateKey } from '../crypto/crypto-helper';

// 密钥链
export interface IChainKey {
    iteration: number;
    key: SymmetricKey;
}

/**
 * 这个接口现在可以同时代表"我自己的会话"和"我为他人保存的会话"。
 * 通过可选的 `signingPrivateKey` 来区分这两种角色。
 */
export interface ISenderKeyState {
    // 会话的唯一标识符，用于区分新旧会话。(旧成员退出需要更新senderkey)
    senderKeyId: number;

    // 当前的链密钥，这是棘轮的核心。
    chainKey: IChainKey;

    // 发送者的签名【公钥】。这个字段总是存在。
    // 用于验证该发送者的消息签名。
    signingPublicKey: SigningPublicKey;

    // 发送者的签名【私钥】。
    // 【关键】这个字段只在"我自己的会话状态"中存在，用于签名我发送的消息。
    // 在为其他成员保存的状态中，此字段为 undefined。
    signingPrivateKey?: SigningPrivateKey;

    // 用于处理消息乱序的缓存。
    // Key: 迭代次数 (iteration)
    // Value: 对应的消息密钥 (SymmetricKey)
    messageKeys: Map<number, SymmetricKey>;
}

/**
 * 这是新成员加入或会话重置时，在群成员之间广播的数据。
 */
export interface ISenderKeyDistributionMessage {
    orderId: string;             // 目标群组 ID
    senderKeyId: number;         // 新会话的 ID
    iteration: number;           // 链密钥的初始迭代次数
    chainKey: Uint8Array;        // 初始链密钥的原始字节
    signingPublicKey: SigningPublicKey;
    senderId?: string;
}

/**
 * 这是实际在群聊中通过 WebSocket 发送的消息载荷。
 * 采用 Signal 官方的确定性密钥派生方案，不再需要传输随机盐。
 */
export interface ISenderKeyMessage {
    orderId: string;
    // 这是接收方用来确定应该加载哪个解密会话（ISenderKeyState）的关键字段。
    senderId: string;
    senderKeyId: number;         // 标识此消息使用的是哪个密钥会话
    iteration: number;           // 标识此消息是使用链上的哪个密钥加密的
    ciphertext: Uint8Array;      // 真正的加密内容 (密文)
    // 签名内容: [groupId | senderId | senderKeyId | iteration | ciphertext]
    signature: Signature;
}