// services/auth.api.ts

 import axios from 'axios'; // 假设您已配置好axios实例
 import type { E2eePublicKeySet, User } from '../types';

/**
 * 使用从SSO回调中获取的code，请求后端完成登录或预注册。
 * @param code 授权码
 * @returns Promise<LoginResponse>
 */
export async function loginWithCode(code: string) {
    // 注意：这里的API路径是您自己后端服务器的路径
    const response = await axios.post('/user/login', {},{
        headers:{
            code:code,
        }
    });
    return response.data;
}

/**
 * 为新用户上报其生成的公钥，完成最终注册。
 * @param publicKeys E2EE公钥集合
 * @param userinfo 用户信息
 * @returns Promise<void>
 */
export async function registerUserKeys(publicKeys: E2eePublicKeySet,userinfo: User) {
    const requestdata = {
        id: userinfo.tenantId,
        openId: userinfo.id,
        username: userinfo.userName,
        identityKey: publicKeys.identityKey ,
        preKeyPublicKey: publicKeys.preKey.publicKey ,
        preKeyId: publicKeys.preKey.keyId ,
        signedPreKeyPublicKey: publicKeys.signedPreKey.publicKey ,
        signedPreKeyId: publicKeys.signedPreKey.keyId ,
        signedPreKeyPublicKeySignature: publicKeys.signedPreKey.signature ,
        signingPubKey: publicKeys.signingPubKey ,
        tenantId: userinfo.tenantId,
    };
    const response = await axios.post('/user/register', requestdata);
    return response.data;
}



