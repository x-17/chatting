// services/file-message-router.ts

import axios from 'axios';
import { fileEncryptionService, type EncryptedFilePackage, type FileUploadProgress, type FileDecryptionResult } from './file-encryption.service.ts';
import { getP2PRouter } from '../signal/services/p2p-message-router.ts';
import { getMessageRouter } from '../groupchat/services/message-router.ts';
import { createAuthenticatedApiClient } from './api-client.ts';

const apiClient = createAuthenticatedApiClient()

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
 * 文件消息路由器 - 统一处理文件相关操作
 */
export class FileMessageRouter {
    private userId: string;
    private uploadProgressCallbacks = new Map<string, (progress: FileUploadProgress) => void>();
    private downloadProgressCallbacks = new Map<string, (progress: number, total: number) => void>();

    constructor(userId: string) {
        this.userId = userId;
    }

    /**
     * 注册文件上传进度回调
     */
    onUploadProgress(fileId: string, callback: (progress: FileUploadProgress) => void): void {
        this.uploadProgressCallbacks.set(fileId, callback);
    }

    /**
     * 注册文件下载进度回调
     */
    onDownloadProgress(fileId: string, callback: (progress: number, total: number) => void): void {
        this.downloadProgressCallbacks.set(fileId, callback);
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
     * 发送一对一文件
     */
    private async handleSendP2PFile(message: IFileMessage): Promise<IFileRouterResponse> {
        const { file, recipientId } = message.payload;

        if (!file || !recipientId) {
            return {
                success: false,
                error: 'File and recipient ID are required'
            };
        }

        try {
            const fileId = fileEncryptionService.generateFileId();

            // 设置进度回调
            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            // 1. 加密文件
            const encryptedPackage = await fileEncryptionService.encryptFileForP2P(
                file,
                this.userId,
                recipientId,
                progressCallback
            );

            // 2. ✅ 上传加密后的文件内容到服务器
            const uploadUrl = await this.uploadFileContent(
                encryptedPackage.encryptedContent,
                fileId
            );

            // 3. 通过P2P路由器发送文件消息（包含下载URL）
            const p2pRouter = getP2PRouter(this.userId);
            const sendResult = await p2pRouter.sendEncryptedMessage(
                recipientId,
                JSON.stringify({
                    type: 'FILE_MESSAGE',
                    filePackage: {
                        fileId: encryptedPackage.fileId,
                        encryptedMetadata: encryptedPackage.metadata,
                        signature: encryptedPackage.signature,
                        uploadUrl: uploadUrl  // ✅ 真实的下载URL
                    }
                })
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
            return {
                success: false,
                error: 'File and group ID are required'
            };
        }

        try {
            const fileId = fileEncryptionService.generateFileId();
            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            // 1. 加密文件
            const encryptedPackage = await fileEncryptionService.encryptFileForGroup(
                file,
                this.userId,
                groupId,
                progressCallback
            );

            // 2. ✅ 上传文件内容到服务器
            const uploadUrl = await this.uploadFileContent(
                encryptedPackage.encryptedContent,
                fileId
            );

            // 3. 通过群组路由器发送文件消息
            const groupRouter = getMessageRouter(this.userId);
            const plaintext = JSON.stringify({
                type: 'FILE_MESSAGE',
                filePackage: {
                    fileId: encryptedPackage.fileId,
                    encryptedMetadata: encryptedPackage.metadata,
                    signature: encryptedPackage.signature,
                    uploadUrl: uploadUrl  // ✅ 真实的下载URL
                }
            });

            const encryptResult = await groupRouter.encryptMessage(groupId, new TextEncoder().encode(plaintext));

            if (!encryptResult.success) {
                throw new Error(encryptResult.error);
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
     * 接收文件消息
     */
    private async handleReceiveFile(message: IFileMessage): Promise<IFileRouterResponse> {
        const { encryptedMessage, senderId, isGroup, groupId } = message.payload;

        try {
            // 解密消息获取文件包信息
            let decryptedMessage: string;

            if (isGroup) {
                const groupRouter = getMessageRouter(this.userId);
                const decryptResult = await groupRouter.handleMessage({
                    type: 'DECRYPT_MESSAGE',
                    payload: { senderId, ciphertext: encryptedMessage }
                });

                if (!decryptResult.success) {
                    throw new Error(decryptResult.error);
                }

                decryptedMessage = new TextDecoder().decode(decryptResult.data.plaintext);
            } else {
                const p2pRouter = getP2PRouter(this.userId);
                const decryptResult = await p2pRouter.receiveEncryptedMessage(senderId, encryptedMessage);

                if (!decryptResult.success) {
                    throw new Error(decryptResult.error);
                }

                decryptedMessage = decryptResult.data.plaintext;
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
            // 1. 从服务器下载加密文件内容
            const encryptedContent = await this.downloadFileContent(
                filePackage.uploadUrl || filePackage.fileId,
                filePackage.fileId
            );

            // 2. 重建完整的加密包
            const fullEncryptedPackage: EncryptedFilePackage = {
                fileId: filePackage.fileId,
                metadata: filePackage.encryptedMetadata,
                encryptedContent,
                signature: filePackage.signature
            };

            // 3. 解密文件
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

            // 4. 创建下载URL
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

    /**
     * 便捷方法：发送一对一文件
     */
    async sendP2PFile(file: File, recipientId: string): Promise<IFileRouterResponse> {
        return await this.handleMessage({
            type: 'SEND_FILE_P2P',
            payload: { file, recipientId }
        });
    }

    /**
     * 便捷方法：发送群组文件
     */
    async sendGroupFile(file: File, groupId: string): Promise<IFileRouterResponse> {
        return await this.handleMessage({
            type: 'SEND_FILE_GROUP',
            payload: { file, groupId }
        });
    }

    /**
     * 便捷方法：接收文件
     */
    async receiveFile(encryptedMessage: any, senderId: string, isGroup: boolean = false, groupId?: string): Promise<IFileRouterResponse> {
        return await this.handleMessage({
            type: 'RECEIVE_FILE',
            payload: { encryptedMessage, senderId, isGroup, groupId }
        });
    }

    /**
     * 便捷方法：下载文件
     */
    async downloadFile(filePackage: any, senderId: string, isGroup: boolean = false, groupId?: string): Promise<IFileRouterResponse> {
        return await this.handleMessage({
            type: 'DOWNLOAD_FILE',
            payload: { filePackage, senderId, isGroup, groupId }
        });
    }

    // ========================
    // 私有方法 - 网络通信
    // ========================

    /**
     * ✅ 上传文件内容到服务器
     */
    private async uploadFileContent(content: ArrayBuffer, fileId: string): Promise<string> {
        try {
            const progressCallback = this.uploadProgressCallbacks.get(fileId);

            // 创建 FormData
            const formData = new FormData();
            formData.append('file', new Blob([content]), `${fileId}.encrypted`);
            formData.append('fileId', fileId);
            formData.append('userId', this.userId);
            formData.append('timestamp', Date.now().toString());

            console.log(`[Upload] Starting upload for file: ${fileId}`);

            // 使用 axios 上传，支持进度监听
            const response = await apiClient.post<{
                success: boolean;
                downloadUrl: string;
                fileId: string;
                message?: string;
            }>('/api/files/upload', formData, {
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total && progressCallback) {
                        const percentCompleted = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );

                        progressCallback({
                            fileId,
                            loaded: progressEvent.loaded,
                            total: progressEvent.total,
                            stage: 'uploading'
                        });

                        console.log(`[Upload] Progress: ${percentCompleted}%`);
                    }
                },
                timeout: 300000,  // 5分钟超时
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            if (!response.data.success) {
                throw new Error(response.data.message || '服务器返回上传失败');
            }

            console.log(`[Upload] ✅ Success: ${response.data.downloadUrl}`);
            return response.data.downloadUrl;

        } catch (error) {
            // 详细的错误处理
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    throw new Error('上传超时，文件可能过大或网络不稳定');
                } else if (error.response) {
                    const status = error.response.status;
                    const message = error.response.data?.message || error.message;

                    if (status === 413) {
                        throw new Error('文件过大，超过服务器限制');
                    } else if (status === 401) {
                        throw new Error('未授权，请重新登录');
                    } else if (status === 403) {
                        throw new Error('没有权限上传文件');
                    } else if (status === 500) {
                        throw new Error('服务器错误，请稍后重试');
                    } else if (status === 503) {
                        throw new Error('服务暂时不可用，请稍后重试');
                    } else {
                        throw new Error(`上传失败 (${status}): ${message}`);
                    }
                } else if (error.request) {
                    throw new Error('网络错误，无法连接到服务器');
                }
            }

            throw new Error(`文件上传失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * ✅ 从服务器下载文件内容（Axios版本）
     */
    private async downloadFileContent(url: string, fileId: string): Promise<ArrayBuffer> {
        try {
            const progressCallback = this.downloadProgressCallbacks.get(fileId);

            console.log(`[Download] Starting download for file: ${fileId}`);

            // 使用 axios 下载，支持进度监听
            const response = await apiClient.get(url, {
                responseType: 'arraybuffer',
                onDownloadProgress: (progressEvent) => {
                    if (progressEvent.total && progressCallback) {
                        progressCallback(progressEvent.loaded, progressEvent.total);

                        const percentCompleted = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );
                        console.log(`[Download] Progress: ${percentCompleted}%`);
                    }
                },
                timeout: 300000  // 5分钟超时
            });

            console.log(`[Download] ✅ Success: ${response.data.byteLength} bytes`);
            return response.data;

        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    throw new Error('下载超时，请检查网络连接');
                } else if (error.response) {
                    const status = error.response.status;

                    if (status === 404) {
                        throw new Error('文件不存在或已过期');
                    } else if (status === 403) {
                        throw new Error('没有权限下载此文件');
                    } else if (status === 410) {
                        throw new Error('文件已被删除');
                    } else {
                        throw new Error(`下载失败 (${status})`);
                    }
                } else if (error.request) {
                    throw new Error('网络错误，无法连接到服务器');
                }
            }

            throw new Error(`文件下载失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 清理资源
     */
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