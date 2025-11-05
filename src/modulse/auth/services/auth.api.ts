// services/auth.api.ts

 import axios from 'axios'; // 假设您已配置好axios实例
 import type { E2eePublicKeySet } from '../types';

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
 * @returns Promise<void>
 */
export async function registerUserKeys(publicKeys: E2eePublicKeySet){
    const response = await axios.post('/user/register', publicKeys);
    return response.data;
}


export async function loginWithCodemock(code: string) {
    // 完全本地，不走网络
    console.warn('[MOCK] loginWithCode', code);
    await sleep(800); // 模拟延迟

    if (code === 'MOCK_CODE_123') {
        // ① 已注册用户
        return {
            code: 1,
            data: {
                userInfo: {
                    id: 'mock_001',
                    openid: 'mock_openid_001',
                    userName: 'MockUser',
                    password: null,
                },
                token: 'mock_jwt_token_12345',
            },
        };
    }
    // ② 新用户
    return { code: 0, data: { openId: 'mock_openid_001' } };
}

export async function registerUserKeysmock(publicKeys: any) {
    console.warn('[MOCK] registerUserKeys', publicKeys);
    await sleep(800);
    return {
        code: 1,
        data: {
            userInfo: {
                id: 'mock_001',
                openid: 'mock_openid_001',
                userName: 'MockUser',
                password: null,
            },
            token: 'mock_jwt_token_12345',
        },
    };
}

// 工具
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));