
import { groupManagementService } from './group-management-service';
import { groupE2eeService } from './group-e2ee-service';

export interface IRouterResponse {
    success: boolean;
    data?: any;
    error?: string;
}

export class MessageRouter {
    private myUserId: string;

    constructor(userId: string) {
        this.myUserId = userId;
    }

    /**
     * 设置当前用户ID
     */
    setUserId(userId: string): void {
        this.myUserId = userId;
    }

    /**
     * 处理收到的群组相关消息
     */
    async handleMessage(message: any): Promise<IRouterResponse> {
        if (!this.myUserId) {
            return {
                success: false,
                error: 'User ID not set'
            };
        }

        try {
            console.log(`[MessageRouter] Handling message of type: ${message.type}`);

            switch (message.type) {
                case 'CREATE_GROUP':
                    return await this.handleCreateGroup(message);

                case 'ADD_MEMBER':
                    return await this.handleAddMember(message);

                case 'REMOVE_MEMBER':
                    return await this.handleRemoveMember(message);

                case 'KEY_DISTRIBUTION':
                    return await this.handleKeyDistribution(message);

                case 'ENCRYPTED_MESSAGE':
                    return await this.handleEncryptedMessage(message);

                case 'MEMBER_JOINED':
                    return await this.handleMemberJoined(message);

                case 'MEMBER_REMOVED':
                    return await this.handleMemberRemoved(message);

                case 'GET_GROUP_INFO':
                    return await this.handleGetGroupInfo(message);

                case 'GET_VALID_SESSIONS':
                    return await this.handleGetValidSessions(message);

                // 【新增】支持创建发送者会话
                case 'CREATE_SENDER_SESSION':
                    return await this.handleCreateSenderSession(message);

                default:
                    console.warn(`[MessageRouter] Unknown message type: ${message.type}`);
                    return {
                        success: false,
                        error: `Unknown message type: ${message.type}`
                    };
            }
        } catch (error) {
            console.error(`[MessageRouter] Error handling message:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 【新增】处理创建发送者会话请求
     */
    private async handleCreateSenderSession(message: any): Promise<IRouterResponse> {
        const { groupId } = message.payload;

        if (!groupId) {
            return {
                success: false,
                error: 'Group ID is required'
            };
        }

        try {
            const distMessage = await groupE2eeService.createGroupSession(this.myUserId, groupId);
            return {
                success: true,
                data: distMessage
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to create sender session: ${error.message}`
            };
        }
    }

    /**
     * 处理创建群组消息
     */
    private async handleCreateGroup(message: any): Promise<IRouterResponse> {
        const { groupId, initialMembers = [] } = message.payload;

        if (!groupId) {
            return {
                success: false,
                error: 'Group ID is required'
            };
        }

        try {
            await groupManagementService.createGroup(groupId, this.myUserId, initialMembers);
            return {
                success: true,
                data: { groupId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to create group: ${error.message}`
            };
        }
    }

    /**
     * 处理添加成员消息
     */
    private async handleAddMember(message: any): Promise<IRouterResponse> {
        const { groupId, newMemberId } = message.payload;

        if (!groupId || !newMemberId) {
            return {
                success: false,
                error: 'Group ID and new member ID are required'
            };
        }

        try {
            await groupManagementService.addMemberToGroup(groupId, this.myUserId, newMemberId);
            return {
                success: true,
                data: { groupId, newMemberId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to add member: ${error.message}`
            };
        }
    }

    /**
     * 处理移除成员消息
     */
    private async handleRemoveMember(message: any): Promise<IRouterResponse> {
        const { groupId, memberToRemoveId } = message.payload;

        if (!groupId || !memberToRemoveId) {
            return {
                success: false,
                error: 'Group ID and member to remove ID are required'
            };
        }

        try {
            await groupManagementService.removeMemberFromGroup(groupId, this.myUserId, memberToRemoveId);
            return {
                success: true,
                data: { groupId, memberToRemoveId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to remove member: ${error.message}`
            };
        }
    }

    /**
     * 处理密钥分发消息
     */
    private async handleKeyDistribution(message: any): Promise<IRouterResponse> {
        const { payload } = message;

        if (!payload) {
            return {
                success: false,
                error: 'Payload is required for key distribution'
            };
        }

        try {
            await groupManagementService.processKeyDistribution(this.myUserId, {
                type: 'KEY_DISTRIBUTION',
                payload
            });

            return {
                success: true,
                data: { senderId: payload.senderId, groupId: payload.groupId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to process key distribution: ${error.message}`
            };
        }
    }

    /**
     * 处理加密消息
     */
    private async handleEncryptedMessage(message: any): Promise<IRouterResponse> {
        const { payload } = message;

        if (!payload) {
            return {
                success: false,
                error: 'Payload is required for encrypted message'
            };
        }

        try {
            const decrypted = await groupE2eeService.decryptGroupMessage(this.myUserId, payload);

            return {
                success: true,
                data: {
                    decrypted,
                    original: payload,
                    senderId: payload.senderId,
                    groupId: payload.groupId
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to decrypt message: ${error.message}`
            };
        }
    }

    /**
     * 处理成员加入通知
     */
    private async handleMemberJoined(message: any): Promise<IRouterResponse> {
        const { payload } = message;

        if (!payload) {
            return {
                success: false,
                error: 'Payload is required for member joined notification'
            };
        }

        try {
            await groupManagementService.handleMemberJoined(this.myUserId, {
                type: 'MEMBER_JOINED',
                payload
            });

            return {
                success: true,
                data: { groupId: payload.groupId, memberId: payload.memberId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to handle member joined: ${error.message}`
            };
        }
    }

    /**
     * 处理成员移除通知
     */
    private async handleMemberRemoved(message: any): Promise<IRouterResponse> {
        const { payload } = message;

        if (!payload) {
            return {
                success: false,
                error: 'Payload is required for member removed notification'
            };
        }

        try {
            // 成员移除通知主要是信息性的，不需要特殊处理
            // 但我们可以更新本地状态或UI
            console.log(`Member ${payload.memberId} removed from group ${payload.groupId}`);

            return {
                success: true,
                data: { groupId: payload.groupId, memberId: payload.memberId }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to handle member removed: ${error.message}`
            };
        }
    }

    /**
     * 处理获取群组信息请求
     */
    private async handleGetGroupInfo(message: any): Promise<IRouterResponse> {
        const { groupId } = message.payload;

        if (!groupId) {
            return {
                success: false,
                error: 'Group ID is required'
            };
        }

        try {
            const members = await groupManagementService.getGroupMembers(groupId);
            const isAdmin = await groupManagementService.isGroupAdmin(groupId, this.myUserId);

            return {
                success: true,
                data: {
                    groupId,
                    members,
                    isAdmin,
                    myUserId: this.myUserId
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to get group info: ${error.message}`
            };
        }
    }

    /**
     * 处理获取有效会话请求
     */
    private async handleGetValidSessions(message: any): Promise<IRouterResponse> {
        const { groupId } = message.payload;

        if (!groupId) {
            return {
                success: false,
                error: 'Group ID is required'
            };
        }

        try {
            const validSenders = await groupE2eeService.getValidSessions(this.myUserId, groupId);

            return {
                success: true,
                data: {
                    groupId,
                    validSenders,
                    myUserId: this.myUserId
                }
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to get valid sessions: ${error.message}`
            };
        }
    }

    /**
     * 加密消息（不是处理接收的消息，而是主动创建加密消息）
     */
    async encryptMessage(groupId: string, plaintext: Uint8Array): Promise<IRouterResponse> {
        if (!groupId) {
            return {
                success: false,
                error: 'Group ID is required'
            };
        }

        try {
            const encrypted = await groupE2eeService.encryptGroupMessage(this.myUserId, groupId, plaintext);

            return {
                success: true,
                data: encrypted
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to encrypt message: ${error.message}`
            };
        }
    }
}

// 创建默认的消息路由器实例
let defaultRouter: MessageRouter | null = null;

export function getMessageRouter(userId?: string): MessageRouter {
    if (!defaultRouter && userId) {
        defaultRouter = new MessageRouter(userId);
    } else if (!defaultRouter && !userId) {
        throw new Error('User ID is required to create a message router');
    }

    return defaultRouter!;
}

export function setMessageRouterUserId(userId: string): void {
    if (defaultRouter) {
        defaultRouter.setUserId(userId);
    } else {
        defaultRouter = new MessageRouter(userId);
    }
}