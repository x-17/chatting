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

    /**
     * Store legacy sessions (history)
     */
    async storeLegacy(myUserId: string, orderId: string, senderId: string, state: ISenderKeyState): Promise<void> {
        const key = `state-${myUserId}-${orderId}-${senderId}-legacy`;
        try {
            const existing = await get<ISerializableBaseState[]>(key, groupStore) || [];
            // Serialize full state to a composite object for simpler legacy storage
            // For legacy, we just store sendingKey(Base) + current chain(Dynamic) frozen in time
            const [base, dynamic] = serializeState(state);
            const legacyItem: any = { ...base, ...dynamic };

            // Prepend new legacy item
            const updated = [legacyItem, ...existing].slice(0, 5); // Keep max 5

            await set(key, updated, groupStore);
        } catch (e) {
            console.warn('[GroupStateStore] Failed to store legacy state:', e);
        }
    },

    /**
     * Retrieve a specific legacy session by KeyID
     */
    async getLegacy(myUserId: string, orderId: string, senderId: string, targetKeyId: number): Promise<ISenderKeyState | null> {
        const key = `state-${myUserId}-${orderId}-${senderId}-legacy`;
        try {
            const list = await get<any[]>(key, groupStore);
            if (!list) return null;

            const found = list.find(item => item.senderKeyId === targetKeyId);
            if (!found) return null;

            // Reconstruct logic
            // We need to separate back into base/dynamic for deserializeState
            const base: ISerializableBaseState = {
                senderKeyId: found.senderKeyId,
                signingPublicKey: found.signingPublicKey,
                signingPrivateKey: found.signingPrivateKey
            };
            const dynamic: ISerializableDynamicState = {
                chainKey: found.chainKey,
                messageKeys: found.messageKeys
            };

            return deserializeState(base, dynamic);
        } catch (e) {
            console.error('[GroupStateStore] Failed to get legacy state:', e);
            return null;
        }
    },

    async set(myUserId: string, orderId: string, senderId: string, state: ISenderKeyState): Promise<void> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        const legacyKey = `state-${myUserId}-${orderId}-${senderId}-legacy`;

        try {
            // 1. Check if it matches CURRENT
            const existingBase = await get<ISerializableBaseState>(baseKey, groupStore);

            if (existingBase && existingBase.senderKeyId === state.senderKeyId) {
                // Case A: Update Current (Fast path)
                // console.log(`[GroupStateStore] Updating CURRENT session for ${senderId} (KeyId: ${state.senderKeyId})`);
                const [_, serializableDynamic] = serializeState(state);
                await set(dynamicKey, serializableDynamic, groupStore);
                return;
            }

            // 2. Check if it matches a LEGACY item
            const legacyList = await get<any[]>(legacyKey, groupStore) || [];
            const legacyIndex = legacyList.findIndex(item => item.senderKeyId === state.senderKeyId);

            if (legacyIndex !== -1) {
                // Case B: Update Legacy Item
                console.log(`[GroupStateStore] Updating LEGACY session for ${senderId} (KeyId: ${state.senderKeyId})`);
                const [base, dynamic] = serializeState(state);
                legacyList[legacyIndex] = { ...base, ...dynamic };
                await set(legacyKey, legacyList, groupStore);
                return;
            }

            // 3. New Key entirely (Rotation)
            if (existingBase) {
                console.log(`[GroupStateStore] Key Rotation for ${senderId}: ${existingBase.senderKeyId} -> ${state.senderKeyId}`);

                // Archive current to legacy
                const existingDynamic = await get<ISerializableDynamicState>(dynamicKey, groupStore);
                if (existingDynamic) {
                    const oldState = deserializeState(existingBase, existingDynamic);
                    const [base, dynamic] = serializeState(oldState);
                    const legacyItem = { ...base, ...dynamic };

                    // Add to start, cap at 5
                    legacyList.unshift(legacyItem);
                    if (legacyList.length > 5) legacyList.pop();

                    await set(legacyKey, legacyList, groupStore);
                }
            } else {
                console.log(`[GroupStateStore] Initializing NEW session for ${senderId} (KeyId: ${state.senderKeyId})`);
            }

            // Save New as Current
            const [serializableBase, serializableDynamic] = serializeState(state);
            await set(baseKey, serializableBase, groupStore);
            await set(dynamicKey, serializableDynamic, groupStore);

        } catch (e) {
            console.error(`[GroupStateStore] SET failed for ${senderId}:`, e);
            throw e;
        }
    },

    /**
     * Get State. 
     * If targetKeyId is provided, tries to find that specific key version.
     * Otherwise returns the latest (current) session.
     */
    async get(myUserId: string, orderId: string, senderId: string, targetKeyId?: number): Promise<ISenderKeyState | null> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);

        // 1. Always check Current first (fast path)
        const [baseState, dynamicState] = await Promise.all([
            get<ISerializableBaseState>(baseKey, groupStore),
            get<ISerializableDynamicState>(dynamicKey, groupStore),
        ]);

        if (baseState && dynamicState) {
            // If checking for specific key
            if (targetKeyId !== undefined) {
                if (baseState.senderKeyId === targetKeyId) {
                    return deserializeState(baseState, dynamicState);
                } else {
                    // ID mismatch - check legacy
                    // console.log(`[GroupStateStore] Current keyId (${baseState.senderKeyId}) != target (${targetKeyId}), checking legacy...`);
                    return this.getLegacy(myUserId, orderId, senderId, targetKeyId);
                }
            }

            // If no target ID specified, return current
            return deserializeState(baseState, dynamicState);
        }

        // If current is empty but we asked for specific, try legacy (edge case?)
        if (targetKeyId !== undefined) {
            return this.getLegacy(myUserId, orderId, senderId, targetKeyId);
        }

        return null;
    },

    async remove(myUserId: string, orderId: string, senderId: string): Promise<void> {
        const { baseKey, dynamicKey } = this._generateStoreKeys(myUserId, orderId, senderId);
        const legacyKey = `state-${myUserId}-${orderId}-${senderId}-legacy`;
        await Promise.all([
            del(baseKey, groupStore),
            del(dynamicKey, groupStore),
            del(legacyKey, groupStore)
        ]);
    },

    async getSession(myUserId: string, orderId: string, senderId: string): Promise<SenderKeySession | null> {
        // Default getSession returns current
        const state = await this.get(myUserId, orderId, senderId);
        if (!state) return null;
        return SenderKeySession.createFromState(state, senderId, orderId);
    }
};