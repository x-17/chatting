// services/p2p-message-router.ts（本地测试用）

import { e2eeService } from './e2ee.service';
import type { SessionStateInfo } from './signal.store';

export interface IP2PRouterResponse {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        messageType?: string;
        sessionInfo?: SessionStateInfo;
        timing?: number;
    };
}

export interface IP2PMessage {
    type: string;
    payload: any;
    metadata?: {
        timestamp?: number;
        messageId?: string;
        priority?: 'low' | 'normal' | 'high';
    };
}

/**
 * P2P 消息路由器 - 提供统一的 1v1 加密通信接口
 */
export class P2PMessageRouter {
    private myUserId: string;
    private sessionStateCallbacks: Array<(stateInfo: SessionStateInfo) => void> = [];
    private messageHandlers: Array<(message: any, response: IP2PRouterResponse) => void> = [];

    constructor(userId: string) {
        this.myUserId = userId;
    }

    /**
     * 设置用户ID
     */
    setUserId(userId: string): void {
        this.myUserId = userId;
    }

    /**
     * 注册会话状态更新回调
     */
    onSessionUpdate(callback: (stateInfo: SessionStateInfo) => void): void {
        this.sessionStateCallbacks.push(callback);
    }

    /**
     * 注册消息处理回调
     */
    onMessage(callback: (message: any, response: IP2PRouterResponse) => void): void {
        this.messageHandlers.push(callback);
    }

    /**
     * 触发会话状态回调
     */
    private triggerSessionCallbacks(stateInfo: SessionStateInfo): void {
        this.sessionStateCallbacks.forEach(callback => {
            try {
                callback(stateInfo);
            } catch (error) {
                console.error('[P2PRouter] Session callback error:', error);
            }
        });
    }

    /**
     * 触发消息处理回调
     */
    private triggerMessageCallbacks(message: any, response: IP2PRouterResponse): void {
        this.messageHandlers.forEach(callback => {
            try {
                callback(message, response);
            } catch (error) {
                console.error('[P2PRouter] Message callback error:', error);
            }
        });
    }

    /**
     * 处理收到的消息
     */
    async handleMessage(message: IP2PMessage): Promise<IP2PRouterResponse> {
        if (!this.myUserId) {
            return {
                success: false,
                error: 'User ID not set'
            };
        }

        const startTime = Date.now();

        try {
            console.log(`[P2PRouter] ${this.myUserId} handling message: ${message.type}`);

            let response: IP2PRouterResponse;

            switch (message.type) {
                case 'INITIALIZE_KEYS':
                    response = await this.handleInitializeKeys(message);
                    break;

                case 'ENSURE_SESSION':
                    response = await this.handleEnsureSession(message);
                    break;

                case 'ENCRYPT_MESSAGE':
                    response = await this.handleEncryptMessage(message);
                    break;

                case 'DECRYPT_MESSAGE':
                    response = await this.handleDecryptMessage(message);
                    break;

                case 'GET_SESSION_INFO':
                    response = await this.handleGetSessionInfo(message);
                    break;

                case 'CLEAR_SESSIONS':
                    response = await this.handleClearSessions(message);
                    break;

                default:
                    response = {
                        success: false,
                        error: `Unknown message type: ${message.type}`
                    };
            }

            // 添加元数据
            response.metadata = {
                ...response.metadata,
                messageType: message.type,
                timing: Date.now() - startTime
            };

            // 触发消息处理回调
            this.triggerMessageCallbacks(message, response);

            return response;

        } catch (error) {
            const errorResponse: IP2PRouterResponse = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    messageType: message.type,
                    timing: Date.now() - startTime
                }
            };

            this.triggerMessageCallbacks(message, errorResponse);
            return errorResponse;
        }
    }

    /**
     * 处理密钥初始化
     */
    private async handleInitializeKeys(_message: IP2PMessage): Promise<IP2PRouterResponse> {
        try {
            const publicKeyBundle = await e2eeService.initializeKeysForUser(this.myUserId);
            return {
                success: true,
                data: {
                    userId: this.myUserId,
                    publicKeyBundle
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to initialize keys: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 处理会话确保
     */
    private async handleEnsureSession(message: IP2PMessage): Promise<IP2PRouterResponse> {
        const { recipientId } = message.payload;

        if (!recipientId) {
            return {
                success: false,
                error: 'Recipient ID is required'
            };
        }

        try {
            await e2eeService.ensureSession(this.myUserId, recipientId);
            return {
                success: true,
                data: {
                    sessionEstablished: true,
                    participants: [this.myUserId, recipientId]
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to ensure session: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 处理消息加密
     */
    private async handleEncryptMessage(message: IP2PMessage): Promise<IP2PRouterResponse> {
        const { recipientId, plaintext } = message.payload;

        if (!recipientId || !plaintext) {
            return {
                success: false,
                error: 'Recipient ID and plaintext are required'
            };
        }

        try {
            // 创建会话状态回调
            const sessionUpdateCallback = (stateInfo: SessionStateInfo) => {
                this.triggerSessionCallbacks(stateInfo);
            };

            const ciphertext = await e2eeService.encryptMessage(
                this.myUserId,
                recipientId,
                plaintext,
                sessionUpdateCallback
            );

            return {
                success: true,
                data: {
                    senderId: this.myUserId,
                    recipientId,
                    ciphertext,
                    timestamp: Date.now()
                },
                metadata: {
                    messageType: 'ENCRYPT_MESSAGE',
                    sessionInfo: {
                        identifier: `${this.myUserId}.${recipientId}`,
                        timestamp: Date.now(),
                        isNew: false,
                        hasPreKeyMessage: false,
                        metadata: {
                            userId: this.myUserId,
                            recipientId
                        }
                    }
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to encrypt message: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 处理消息解密
     */
    private async handleDecryptMessage(message: IP2PMessage): Promise<IP2PRouterResponse> {
        const { senderId, ciphertext } = message.payload;

        if (!senderId || !ciphertext) {
            return {
                success: false,
                error: 'Sender ID and ciphertext are required'
            };
        }

        try {
            // 创建会话状态回调
            const sessionUpdateCallback = (stateInfo: SessionStateInfo) => {
                this.triggerSessionCallbacks(stateInfo);
            };

            const plaintext = await e2eeService.decryptMessage(
                this.myUserId,
                senderId,
                ciphertext,
                sessionUpdateCallback
            );

            return {
                success: true,
                data: {
                    senderId,
                    recipientId: this.myUserId,
                    plaintext,
                    timestamp: Date.now()
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to decrypt message: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 处理获取会话信息
     */
    private async handleGetSessionInfo(_message: IP2PMessage): Promise<IP2PRouterResponse> {
        try {
            // 这里可以扩展获取会话详细信息的逻辑
            return {
                success: true,
                data: {
                    userId: this.myUserId,
                    sessionInfo: 'Session info retrieval not fully implemented yet'
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to get session info: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 处理清除会话
     */
    private async handleClearSessions(_message: IP2PMessage): Promise<IP2PRouterResponse> {
        try {
            // 这里可以添加清除会话的逻辑
            return {
                success: true,
                data: {
                    cleared: true,
                    userId: this.myUserId
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to clear sessions: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 便捷方法：发送加密消息
     */
    async sendEncryptedMessage(recipientId: string, plaintext: string): Promise<IP2PRouterResponse> {
        return await this.handleMessage({
            type: 'ENCRYPT_MESSAGE',
            payload: { recipientId, plaintext }
        });
    }

    /**
     * 便捷方法：接收并解密消息
     */
    async receiveEncryptedMessage(senderId: string, ciphertext: any): Promise<IP2PRouterResponse> {
        return await this.handleMessage({
            type: 'DECRYPT_MESSAGE',
            payload: { senderId, ciphertext }
        });
    }

    /**
     * 便捷方法：初始化用户密钥
     */
    async initializeUser(): Promise<IP2PRouterResponse> {
        return await this.handleMessage({
            type: 'INITIALIZE_KEYS',
            payload: {}
        });
    }

    /**
     * 便捷方法：确保与指定用户的会话
     */
    async ensureSessionWith(recipientId: string): Promise<IP2PRouterResponse> {
        return await this.handleMessage({
            type: 'ENSURE_SESSION',
            payload: { recipientId }
        });
    }
}

// 创建默认路由器实例的工厂函数
let defaultRouters = new Map<string, P2PMessageRouter>();

export function getP2PRouter(userId: string): P2PMessageRouter {
    if (!defaultRouters.has(userId)) {
        defaultRouters.set(userId, new P2PMessageRouter(userId));
    }
    return defaultRouters.get(userId)!;
}

export function clearP2PRouters(): void {
    defaultRouters.clear();
}