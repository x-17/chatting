// services/api.service.ts
import { createAuthenticatedApiClient } from "../../utils/api-client";
import type { E2eePublicKeySet, User } from "../types";

class AuthApiService {
  private apiClient = createAuthenticatedApiClient();
  /**
   * 使用授权码登录
   */
  async loginWithCode(code: string) {
    const response = await this.apiClient.post(
      "/user/login",
      {},
      {
        headers: { code },
      }
    );
    return response.data;
  }

  /**
   * 注册用户密钥
   */
  async registerUserKeys(publicKeys: E2eePublicKeySet, userinfo: User) {
    const requestdata = {
      identityKey: publicKeys.identityKey,
      preKeyPublicKey: publicKeys.preKey.publicKey,
      preKeyId: publicKeys.preKey.keyId,
      signedPreKeyPublicKey: publicKeys.signedPreKey.publicKey,
      signedPreKeyId: publicKeys.signedPreKey.keyId,
      signedPreKeyPublicKeySignature: publicKeys.signedPreKey.signature,
      signingPubKey: publicKeys.signingPubKey,
      tenantId: userinfo.tenantId,
    };

    const response = await this.apiClient.post("/user/register", requestdata);
    return response.data;
  }
}

export const authApiService = new AuthApiService();
