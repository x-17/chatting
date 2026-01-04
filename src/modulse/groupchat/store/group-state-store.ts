// src/e2ee/storage/group-state-store.ts

import { get, set, del, createStore } from 'idb-keyval';
import type { ISenderKeyState } from '../protocol/types.ts';
import { SenderKeySession } from '../protocol/sender-key-session';

// --- Base64 工具 (内部使用) ---
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
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// 序列化接口
interface ISerializableBaseState {
    senderKeyId: number;
    signingPublicKey: string;
    signingPrivateKey?: string;
}

interface ISerializableDynamicState {
    chainKey: {
        iteration: number;
        key: string;
    };
    messageKeys: [number, string][];
}

// 序列化/反序列化逻辑
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

function deserializeState(baseState: ISerializableBaseState, dynamicState: ISerializableDynamicState): ISenderKeyState {
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

// 独立的 Store 实例
const groupStore = createStore('group-e2ee-store', 'sender-key-sessions');

export const groupStateStore = {
    _generateStoreKeys: (myUserId: string, groupId: string, senderId: string) => {
        const prefix = `state-${myUserId}-${groupId}-${senderId}`;
        return {
            baseKey: `${prefix}-base`,
            dynamicKey: `${prefix}-dynamic`,
        };
    },

    async set(myUserId: string, orderId: string, senderId: string, state: ISenderKeyState): Promise<void> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        const [serializableBase, serializableDynamic] = serializeState(state);

        const existingBase = await get<ISerializableBaseState>(baseKey, groupStore);
        if (existingBase && existingBase.senderKeyId === state.senderKeyId) {
            // ID 相同才只更新动态部分，防止 SenderKeyId 轮转后数据错乱
            await set(dynamicKey, serializableDynamic, groupStore);
        } else {
            await Promise.all([
                set(baseKey, serializableBase, groupStore),
                set(dynamicKey, serializableDynamic, groupStore),
            ]);
        }
    },

    async get(myUserId: string, orderId: string, senderId: string): Promise<ISenderKeyState | null> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        const [baseState, dynamicState] = await Promise.all([
            get<ISerializableBaseState>(baseKey, groupStore),
            get<ISerializableDynamicState>(dynamicKey, groupStore),
        ]);

        if (!baseState || !dynamicState) return null;
        return deserializeState(baseState, dynamicState);
    },

    async remove(myUserId: string, orderId: string, senderId: string): Promise<void> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        await Promise.all([del(baseKey, groupStore), del(dynamicKey, groupStore)]);
    },

    /**
     * 获取 Session 对象实例
     */
    async getSession(myUserId: string, orderId: string, senderId: string): Promise<SenderKeySession | null> {
        const state = await this.get(myUserId, orderId, senderId);
        if (!state) return null;
        return SenderKeySession.createFromState(state, senderId, orderId);
    }
};