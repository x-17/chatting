// utils/e2ee.utils.ts

import * as base64 from 'base64-js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// 确保 ed25519 库有同步的哈希函数
ed.etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
    return sha512(ed.etc.concatBytes(...messages));
};

//类型转换
export function toBase64(u8: Uint8Array | ArrayBuffer): string {
    const uint8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    return base64.fromByteArray(uint8);
}

export function fromBase64(str: string): Uint8Array {
    return base64.toByteArray(str);
}