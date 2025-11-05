// services/file-message-router.enhanced.ts


import { fileEncryptionService, type EncryptedFilePackage, type FileUploadProgress, type FileDecryptionResult } from './file-encryption.service';
import { getEnhancedP2PRouter } from '../signal/services/p2p-message-router.enhanced';
import { getEnhancedGroupRouter } from '../groupchat/services/enhanced-group-message-router';
import { createAuthenticatedApiClient } from './api-client';

const apiClient = createAuthenticatedApiClient();

// ========================
// 接口定义
// ========================

export interface IFileRouterResponse {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        fileId?: string;
        operation?: string;
        timing?: number;
    };
}

export interface IFileMessage {
    type: 'SEND_FILE_P2P' | 'SEND_FILE_GROUP' | 'RECEIVE_FILE' | 'DOWNLOAD_FILE';
    payload: any;
    fileId?: string;
}

/**
 * 文件消息路由器 - 基于增强版加密路由器
 */
export class FileMessageRouter {
    private userId: string;
    private uploadProgressCallbacks = new Map<string, (progress: FileUploadProgress) => void>();
    private downloadProgressCallbacks = new Map<string, (progress: number, total: number) => void>();

    constructor(userId: string) {
        this.userId = userId;
    }

    /**
     * 处理文件相关消息
     */
    async handleMessage(message: IFileMessage): Promise<IFileRouterResponse> {
        const startTime = Date.now();

        try {
            console.log(`[FileRouter] ${this.userId} handling: ${message.type}`);

            let response: IFileRouterResponse;

            switch (message.type) {
                case 'SEND_FILE_P2P':
                    response = await this.handleSendP2PFile(message);
                    break;

                case 'SEND_FILE_GROUP':
                    response = await this.handleSendGroupFile(message);
                    break;

                case 'RECEIVE_FILE':
                    response = await this.handleReceiveFile(message);
                    break;

                case 'DOWNLOAD_FILE':
                    response = await this.handleDownloadFile(message);
                    break;

                default:
                    response = {
                        success: false,
                        error: `Unknown file message type: ${message.type}`
                    };
            }

            response.metadata = {
                ...response.metadata,
                operation: message.type,
                timing: Date.now() - startTime,
                fileId: message.fileId
            };

            return response;

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    operation: message.type,
                    timing: Date.now() - startTime,
                    fileId: message.fileId
                }
            };
        }
    }

    /**
     * 发送一对一文件（P2P）
     */
    private async handleSendP2PFile(message: IFileMessage): Promise<IFileRouterResponse> {
        const { file, recipientId } = message.payload;

        if (!file || !recipientId) {
            return { success: false, error: 'File and recipient ID are required' };
        }

        try {
            const fileId = fileEncryptionService.generateFileId();
            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            const encryptedPackage = await fileEncryptionService.encryptFileForP2P(
                file,
                this.userId,
                recipientId,
                progressCallback
            );

            const uploadUrl = await this.uploadFileContent(
                encryptedPackage.encryptedContent,
                fileId
            );

            const p2pRouter = getEnhancedP2PRouter(this.userId);
            const sendResult = await p2pRouter.sendMessage(
                recipientId,
                JSON.stringify({
                    type: 'FILE_MESSAGE',
                    filePackage: {
                        fileId: encryptedPackage.fileId,
                        encryptedMetadata: encryptedPackage.metadata,
                        signature: encryptedPackage.signature,
                        uploadUrl
                    }
                }),
                'file'
            );

            if (!sendResult.success) {
                throw new Error(sendResult.error);
            }

            return {
                success: true,
                data: {
                    fileId: encryptedPackage.fileId,
                    recipientId,
                    uploadUrl,
                    encryptedSize: encryptedPackage.encryptedContent.byteLength,
                    originalName: file.name
                }
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to send P2P file: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 发送群组文件
     */
    private async handleSendGroupFile(message: IFileMessage): Promise<IFileRouterResponse> {
        const { file, groupId } = message.payload;

        if (!file || !groupId) {
            return { success: false, error: 'File and group ID are required' };
        }

        try {
            const fileId = fileEncryptionService.generateFileId();
            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            const encryptedPackage = await fileEncryptionService.encryptFileForGroup(
                file,
                this.userId,
                groupId,
                progressCallback
            );

            const uploadUrl = await this.uploadFileContent(
                encryptedPackage.encryptedContent,
                fileId
            );

            const groupRouter = getEnhancedGroupRouter(this.userId);
            const plaintext = JSON.stringify({
                type: 'FILE_MESSAGE',
                filePackage: {
                    fileId: encryptedPackage.fileId,
                    encryptedMetadata: encryptedPackage.metadata,
                    signature: encryptedPackage.signature,
                    uploadUrl
                }
            });

            const result = await groupRouter.sendGroupMessage(groupId, plaintext, 'file');

            if (!result.success) {
                throw new Error(result.error);
            }

            return {
                success: true,
                data: {
                    fileId: encryptedPackage.fileId,
                    groupId,
                    uploadUrl,
                    encryptedSize: encryptedPackage.encryptedContent.byteLength,
                    originalName: file.name
                }
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to send group file: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 接收文件消息（解密文件元信息）
     */
    private async handleReceiveFile(message: IFileMessage): Promise<IFileRouterResponse> {
        const { encryptedMessage, senderId, isGroup, groupId } = message.payload;

        try {
            let decryptedMessage: string;

            if (isGroup) {
                const groupRouter = getEnhancedGroupRouter(this.userId);
                const result = await groupRouter.handleIncomingMessage({
                    encryptedContent: JSON.stringify(encryptedMessage),
                    senderId,
                    groupId
                });
                decryptedMessage = new TextDecoder().decode(result);
            } else {
                const p2pRouter = getEnhancedP2PRouter(this.userId);
                const decryptResult = await p2pRouter.sendMessage(
                    senderId,
                    JSON.stringify({ type: 'DECRYPT_FILE', encryptedMessage }),
                    'file'
                );
                decryptedMessage = decryptResult.data?.plaintext;
            }

            const messageData = JSON.parse(decryptedMessage);
            if (messageData.type !== 'FILE_MESSAGE') {
                throw new Error('Invalid file message format');
            }

            return {
                success: true,
                data: {
                    fileId: messageData.filePackage.fileId,
                    senderId,
                    filePackage: messageData.filePackage,
                    isGroup,
                    groupId
                }
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to receive file: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 下载并解密文件
     */
    private async handleDownloadFile(message: IFileMessage): Promise<IFileRouterResponse> {
        const { filePackage, senderId, isGroup, groupId } = message.payload;

        try {
            const encryptedContent = await this.downloadFileContent(
                filePackage.uploadUrl || filePackage.fileId,
                filePackage.fileId
            );

            const fullEncryptedPackage: EncryptedFilePackage = {
                fileId: filePackage.fileId,
                metadata: filePackage.encryptedMetadata,
                encryptedContent,
                signature: filePackage.signature
            };

            let decryptionResult: FileDecryptionResult;

            if (isGroup) {
                decryptionResult = await fileEncryptionService.decryptGroupFile(
                    fullEncryptedPackage,
                    this.userId,
                    groupId,
                    senderId
                );
            } else {
                decryptionResult = await fileEncryptionService.decryptP2PFile(
                    fullEncryptedPackage,
                    this.userId,
                    senderId
                );
            }

            const downloadUrl = fileEncryptionService.createDownloadUrl(
                decryptionResult.content,
                decryptionResult.originalName,
                decryptionResult.mimeType
            );

            return {
                success: true,
                data: {
                    fileId: filePackage.fileId,
                    originalName: decryptionResult.originalName,
                    mimeType: decryptionResult.mimeType,
                    size: decryptionResult.size,
                    downloadUrl,
                    isVerified: decryptionResult.isVerified,
                    senderId
                }
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to download file: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    // ========================
    // 网络方法（上传/下载）
    // ========================

    private async uploadFileContent(content: ArrayBuffer, fileId: string): Promise<string> {
        const progressCallback = this.uploadProgressCallbacks.get(fileId);
        const formData = new FormData();
        formData.append('file', new Blob([content]), `${fileId}.encrypted`);
        formData.append('fileId', fileId);
        formData.append('userId', this.userId);

        const response = await apiClient.post<{
            success: boolean;
            downloadUrl: string;
        }>('/api/files/upload', formData, {
            onUploadProgress: (e) => {
                if (e.total && progressCallback) {
                    progressCallback({
                        fileId,
                        loaded: e.loaded,
                        total: e.total,
                        stage: 'uploading'
                    });
                }
            },
            timeout: 300000
        });

        if (!response.data.success) {
            throw new Error('Upload failed');
        }

        return response.data.downloadUrl;
    }

    private async downloadFileContent(url: string, fileId: string): Promise<ArrayBuffer> {
        const progressCallback = this.downloadProgressCallbacks.get(fileId);

        const response = await apiClient.get(url, {
            responseType: 'arraybuffer',
            onDownloadProgress: (e) => {
                if (e.total && progressCallback) {
                    progressCallback(e.loaded, e.total);
                }
            },
            timeout: 300000
        });

        return response.data;
    }

    // ========================
    // 便捷方法
    // ========================

    async sendP2PFile(file: File, recipientId: string): Promise<IFileRouterResponse> {
        return this.handleMessage({ type: 'SEND_FILE_P2P', payload: { file, recipientId } });
    }

    async sendGroupFile(file: File, groupId: string): Promise<IFileRouterResponse> {
        return this.handleMessage({ type: 'SEND_FILE_GROUP', payload: { file, groupId } });
    }

    async receiveFile(encryptedMessage: any, senderId: string, isGroup: boolean = false, groupId?: string): Promise<IFileRouterResponse> {
        return this.handleMessage({ type: 'RECEIVE_FILE', payload: { encryptedMessage, senderId, isGroup, groupId } });
    }

    async downloadFile(filePackage: any, senderId: string, isGroup: boolean = false, groupId?: string): Promise<IFileRouterResponse> {
        return this.handleMessage({ type: 'DOWNLOAD_FILE', payload: { filePackage, senderId, isGroup, groupId } });
    }

    cleanup(): void {
        this.uploadProgressCallbacks.clear();
        this.downloadProgressCallbacks.clear();
        console.log(`[FileRouter] Cleaned up for user: ${this.userId}`);
    }
}

// ========================
// 工厂函数
// ========================

const fileRouters = new Map<string, FileMessageRouter>();

export function getFileRouter(userId: string): FileMessageRouter {
    if (!fileRouters.has(userId)) {
        fileRouters.set(userId, new FileMessageRouter(userId));
        console.log(`[FileRouter] Created new router for user: ${userId}`);
    }
    return fileRouters.get(userId)!;
}

export function clearFileRouters(): void {
    fileRouters.forEach(router => router.cleanup());
    fileRouters.clear();
    console.log('[FileRouter] Cleared all routers');
}