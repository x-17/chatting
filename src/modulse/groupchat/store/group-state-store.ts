// src/e2ee/storage/group-state-store.ts

import { get, set, del, createStore } from 'idb-keyval';
import type { ISenderKeyState } from '../protocol/types';
import { SenderKeySession } from '../protocol/sender-key-session';

// --- Base64 辅助函数 (保持不变) ---
function uint8ArrayToBase64(arr: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < arr.byteLength; i++) {
        binary += String.fromCharCode(arr[i]);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i); //
    }
    return bytes;
}

// --- 【新增】为不同的状态部分创建独立的序列化接口 ---

// 1. 静态基础状态 (只写一次)
interface ISerializableBaseState {
    senderKeyId: number;
    signingPublicKey: string; // Base64
    signingPrivateKey?: string; // Base64, 可选
}

// 2. 动态变化状态 (频繁更新)
interface ISerializableDynamicState {
    chainKey: {
        iteration: number;
        key: string; // Base64
    };
    messageKeys: [number, string][]; // Map<number, Uint8Array> -> [number, string][]
}

// --- 【重构】序列化/反序列化逻辑 ---

/**
 * 将完整的 ISenderKeyState 拆分为两个可序列化的部分。
 * @returns 一个包含 [baseState, dynamicState] 的元组。
 */
function serializeState(state: ISenderKeyState): [ISerializableBaseState, ISerializableDynamicState] {
    const baseState: ISerializableBaseState = {
        senderKeyId: state.senderKeyId,
        signingPublicKey: uint8ArrayToBase64(state.signingPublicKey),
    };
    if (state.signingPrivateKey) {
        baseState.signingPrivateKey = uint8ArrayToBase64(state.signingPrivateKey);
    }

    const dynamicState: ISerializableDynamicState = {
        chainKey: {
            iteration: state.chainKey.iteration,
            key: uint8ArrayToBase64(state.chainKey.key),
        },
        messageKeys: Array.from(state.messageKeys.entries()).map(([iter, key]) => [
            iter,
            uint8ArrayToBase64(key),
        ]),
    };

    return [baseState, dynamicState];
}

/**
 * 将两个可序列化的部分合并回一个完整的 ISenderKeyState。
 */
function deserializeState(
    baseState: ISerializableBaseState,
    dynamicState: ISerializableDynamicState
): ISenderKeyState {
    const state: ISenderKeyState = {
        senderKeyId: baseState.senderKeyId,
        signingPublicKey: base64ToUint8Array(baseState.signingPublicKey),
        chainKey: {
            iteration: dynamicState.chainKey.iteration,
            key: base64ToUint8Array(dynamicState.chainKey.key),
        },
        messageKeys: new Map(
            dynamicState.messageKeys.map(([iter, key]) => [
                iter,
                base64ToUint8Array(key),
            ])
        ),
    };
    if (baseState.signingPrivateKey) {
        state.signingPrivateKey = base64ToUint8Array(baseState.signingPrivateKey);
    }
    return state;
}

// --- 使用自定义的 store 实例，有助于隔离数据 ---
const groupStore = createStore('group-e2ee-store', 'sessions');

export const groupStateStore = {
    /**
     * 【重构】生成用于存储不同状态部分的键。
     */
    _generateStoreKeys: (myUserId: string, groupId: string, senderId: string): { baseKey: string; dynamicKey: string } => {
        const prefix = `state-${myUserId}-${groupId}-${senderId}`;
        return {
            baseKey: `${prefix}-base`,
            dynamicKey: `${prefix}-dynamic`,
        };
    },

    /**
     * 【重构】保存一个群组的发送者会话状态。
     * 如果基础状态已存在，则只更新动态状态。
     */
    async set(
        myUserId: string,
        orderId: string,
        senderId: string,
        state: ISenderKeyState
    ): Promise<void> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        const [serializableBase, serializableDynamic] = serializeState(state);

        // 检查基础状态是否已存在
        const existingBase = await get<ISerializableBaseState>(baseKey, groupStore);

        if (existingBase) {
            // 如果存在，只更新动态部分，性能极高！
            await set(dynamicKey, serializableDynamic, groupStore);
        } else {
            // 如果不存在（首次创建会话），则同时写入基础和动态部分
            await Promise.all([
                set(baseKey, serializableBase, groupStore),
                set(dynamicKey, serializableDynamic, groupStore),
            ]);
        }
    },

    /**
     * 【重构】获取一个完整的群组发送者会话状态，通过合并两部分实现。
     */
    async get(
        myUserId: string,
        orderId: string,
        senderId: string
    ): Promise<ISenderKeyState | null> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);

        // 并行获取两个部分
        const [baseState, dynamicState] = await Promise.all([
            get<ISerializableBaseState>(baseKey, groupStore),
            get<ISerializableDynamicState>(dynamicKey, groupStore),
        ]);

        if (!baseState || !dynamicState) {
            // 只要有一部分不存在，就认为整个状态无效
            return null;
        }

        return deserializeState(baseState, dynamicState);
    },

    /**
     * 【重构】删除一个群组的发送者会话状态（删除所有相关部分）。
     */
    async remove(
        myUserId: string,
        orderId: string,
        senderId: string
    ): Promise<void> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        // 并行删除两个部分
        await Promise.all([
            del(baseKey, groupStore),
            del(dynamicKey, groupStore)
        ]);
    },

    /**
     * 【新增】一个便捷的封装方法，直接获取一个可用的 SenderKeySession 实例。
     */
    async getSession(
        myUserId: string,
        orderId: string,
        senderId: string
    ): Promise<SenderKeySession | null> {
        const state = await this.get(myUserId, orderId, senderId);
        if (!state) {
            return null;
        }
        // 使用 createFromState 工厂方法和正确的上下文重建会话
        return SenderKeySession.createFromState(state, senderId, orderId);
    }
};