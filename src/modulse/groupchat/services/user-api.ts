// services/api.service.ts
import { createAuthenticatedApiClient } from "../../utils/api-client";
import type { E2eePublicKeySet } from "../../auth/types";

class AuthApiService {
    private apiClient = createAuthenticatedApiClient();

    /**
     * 成员注册（群聊）
     * @param publicKeys 加密公钥集合
     * @param userInfo 用户基本信息（包含tenantId）
     * @param openId 实际为密码，前端命名为openId
     * @param username 用户名
     */
    async register(
        publicKeys: E2eePublicKeySet,
        userInfo: { tenantId: number },
        openId: string,
        username: string
    ) {
        const requestData = {
            tenantId: userInfo.tenantId,
            openId, // 实际为密码
            username,
            identityKey: publicKeys.identityKey,
            signedPreKeyId: publicKeys.signedPreKey.keyId,
            signedPreKeyPublicKey: publicKeys.signedPreKey.publicKey,
            signedPreKeyPublicKeySignature: publicKeys.signedPreKey.signature,
            preKeyId: publicKeys.preKey.keyId,
            preKeyPublicKey: publicKeys.preKey.publicKey,
            signingPubKey: publicKeys.signingPubKey,
        };

        const response = await this.apiClient.post("/user/register", requestData);
        return response.data;
    }

    /**
     * 成员登录（群聊）
     * @param openId 实际为密码，前端命名为openId
     * @param username 用户名
     */
    async login(openId: string, username: string) {
        const requestData = {
            openId, // 实际为密码
            username,
        };

        const response = await this.apiClient.post("/user/login", requestData);
        return response.data;
    }

}

export const authApiService = new AuthApiService();