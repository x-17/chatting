// services/users.api.mock.ts

import type { PublicKeyBundle } from '../types';

/**
 * 这是一个内存中的模拟数据库，用于替代真实的后端服务器。
 * 它将用户的 ID 映射到他们的公钥束。
 * Key: userId (string)
 * Value: PublicKeyBundle
 */
const mockServerDb = new Map<string, PublicKeyBundle>();

console.log("✅ Using MOCK API for user key bundles. Backend is not being called.");

/**
 * 模拟将用户的公钥束上传到服务器。
 * 在我们的测试中，我们会在用户初始化后调用此函数。
 * @param bundle 要存储的公钥束
 */
export function uploadKeyBundleToServer(bundle: PublicKeyBundle): void {
    console.log(`[Mock Server] Storing key bundle for user: ${bundle.userId}`);
    mockServerDb.set(bundle.userId, bundle);
}

/**
 * 这是 `getKeyBundleForUser` 的模拟版本。
 * 它从我们的内存数据库中查找用户的公钥束，而不是发出网络请求。
 * @param userId 要获取其密钥束的用户的 ID
 * @returns 返回一个 Promise，该 Promise 解析为用户的 PublicKeyBundle
 */
export async function getKeyBundleForUser(userId: string): Promise<PublicKeyBundle> {
    console.log(`[Mock Server] Fetching key bundle for user: ${userId}`);
    const bundle = mockServerDb.get(userId);

    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 150));

    if (!bundle) {
        console.error(`[Mock Server] No key bundle found for user: ${userId}`);
        throw new Error(`404 Not Found: User ${userId} does not have a key bundle on the mock server.`);
    }

    console.log(`[Mock Server] Found and returning bundle for ${userId}.`);
    return bundle;
}
