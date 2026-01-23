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
  /**
   * 群聊注册用户密钥 (包含账号注册信息)
   */
  async registerUserKeysWithPsw(publicKeys: E2eePublicKeySet, userinfo: User) {
    const requestdata = {
      identityKey: publicKeys.identityKey,
      preKeyPublicKey: publicKeys.preKey.publicKey,
      preKeyId: publicKeys.preKey.keyId,
      signedPreKeyPublicKey: publicKeys.signedPreKey.publicKey,
      signedPreKeyId: publicKeys.signedPreKey.keyId,
      signedPreKeyPublicKeySignature: publicKeys.signedPreKey.signature,
      signingPubKey: publicKeys.signingPubKey,
      tenantId: userinfo.tenantId,
      username: userinfo.userName,//群聊新加
      openId: userinfo.openId, // 实际传递的是密码,群聊新加
    };

    const response = await this.apiClient.post("http://1.14.69.76:9088/user/register", requestdata);
    return response.data;
  }

  /**
   * 账号密码登录
   */
  async login(data: any) {
    const response = await this.apiClient.post("http://1.14.69.76:9088/user/login", data);
    return response.data;
  }
}

export const authApiService = new AuthApiService();
