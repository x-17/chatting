// services/file-encryption.service.ts

import { cryptoHelper } from '../groupchat/crypto/crypto-helper.ts';
import { e2eeService } from '../signal/services/e2ee.service.ts';
import { toBase64, fromBase64 } from '../signal/utils/e2ee.utils.ts';
import { sha256 } from '@noble/hashes/sha256';

// 文件加密相关类型定义
export interface EncryptedFileMetadata {
    originalName: string;
    mimeType: string;
    size: number;
    encryptedSize: number;
    checksum: string;
    encryptionKey: string;
    iv: string;
    timestamp: number;
}

// ✅ 统一接口，metadata 现在是对象类型
export interface EncryptedFilePackage {
    fileId: string;
    metadata: EncryptedFileMetadata;  // ✅ 改为直接是对象（不再是加密的字符串）
    encryptedContent: ArrayBuffer;
    signature: string;
    uploadUrl?: string;
}

export interface FileUploadProgress {
    fileId: string;
    loaded: number;
    total: number;
    stage: 'encrypting' | 'uploading' | 'complete' | 'error';
    error?: string;
}

export interface FileDecryptionResult {
    originalName: string;
    mimeType: string;
    content: ArrayBuffer;
    size: number;
    isVerified: boolean;
}

const CHUNK_SIZE = 64 * 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * 文件端到端加密服务（P2P和群聊逻辑相同，接口分离）
 */
export const fileEncryptionService = {
    /**
     * 加密文件用于一对一传输
     */
    async encryptFileForP2P(
        file: File,
        senderId: string,
        _recipientId: string,
        onProgress?: (progress: FileUploadProgress) => void
    ): Promise<EncryptedFilePackage> {
        if (file.size > MAX_FILE_SIZE) {
            throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
        }

        const fileId = this.generateFileId();

        try {
            const fileKey = cryptoHelper.createSymmetricKey();
            const iv = cryptoHelper.createSalt().slice(0, 16);

            this.reportProgress(onProgress, fileId, 0, file.size, 'encrypting');

            const originalContent = await this.fileToArrayBuffer(file);
            const checksum = await this.calculateChecksum(originalContent);

            const metadata: EncryptedFileMetadata = {
                originalName: file.name,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
                encryptedSize: 0,
                checksum,
                encryptionKey: toBase64(fileKey),
                iv: toBase64(iv),
                timestamp: Date.now()
            };

            const encryptedContent = await this.encryptFileContent(
                originalContent,
                fileKey,
                iv,
                (progress) => this.reportProgress(onProgress, fileId, progress, file.size, 'encrypting')
            );

            metadata.encryptedSize = encryptedContent.byteLength;

            const signature = await e2eeService.signContract(senderId, new Uint8Array(encryptedContent));

            this.reportProgress(onProgress, fileId, file.size, file.size, 'complete');

            // ✅ P2P：返回明文元数据（上层会再加密一次）
            return {
                fileId,
                metadata: metadata,
                encryptedContent,
                signature
            };

        } catch (error) {
            this.reportProgress(onProgress, fileId, 0, file.size, 'error', error instanceof Error ? error.message : String(error));
            throw error;
        }
    },

    /**
     * ✅ 加密文件用于群组传输
     */
    async encryptFileForGroup(
        file: File,
        senderId: string,
        _groupId: string,
        onProgress?: (progress: FileUploadProgress) => void
    ): Promise<EncryptedFilePackage> {
        if (file.size > MAX_FILE_SIZE) {
            throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
        }

        const fileId = this.generateFileId();

        try {
            const fileKey = cryptoHelper.createSymmetricKey();
            const iv = cryptoHelper.createSalt().slice(0, 16);

            this.reportProgress(onProgress, fileId, 0, file.size, 'encrypting');

            const originalContent = await this.fileToArrayBuffer(file);
            const checksum = await this.calculateChecksum(originalContent);

            const metadata: EncryptedFileMetadata = {
                originalName: file.name,
                mimeType: file.type || 'application/octet-stream',
                size: file.size,
                encryptedSize: 0,
                checksum,
                encryptionKey: toBase64(fileKey),  // 明文 Base64
                iv: toBase64(iv),                   // 明文 Base64
                timestamp: Date.now()
            };

            const encryptedContent = await this.encryptFileContent(
                originalContent,
                fileKey,
                iv,
                (progress) => this.reportProgress(onProgress, fileId, progress, file.size, 'encrypting')
            );

            metadata.encryptedSize = encryptedContent.byteLength;

            const signature = await e2eeService.signContract(senderId, new Uint8Array(encryptedContent));

            this.reportProgress(onProgress, fileId, file.size, file.size, 'complete');

            // ✅ 返回明文元数据对象（上层会用 Sender Key 加密整个消息）
            return {
                fileId,
                metadata: metadata,  // 明文对象
                encryptedContent,
                signature
            };

        } catch (error) {
            this.reportProgress(onProgress, fileId, 0, file.size, 'error', error instanceof Error ? error.message : String(error));
            throw error;
        }
    },

    /**
     * 解密一对一文件
     */
    async decryptP2PFile(
        encryptedPackage: EncryptedFilePackage,
        _recipientId: string,
        senderId: string
    ): Promise<FileDecryptionResult> {
        try {
            // ✅ P2P：元数据已经是对象（上层已经解密过）
            const metadata = encryptedPackage.metadata;

            const senderKeys = await e2eeService.getUserPublicKeys(senderId);
            if (!senderKeys) {
                throw new Error('无法获取发送者公钥');
            }

            const isSignatureValid = await e2eeService.verifyContractSignature(
                encryptedPackage.signature,
                new Uint8Array(encryptedPackage.encryptedContent),
                senderKeys.signingPubKey
            );

            const fileKey = fromBase64(metadata.encryptionKey);
            const iv = fromBase64(metadata.iv);
            const decryptedContent = await this.decryptFileContent(encryptedPackage.encryptedContent, fileKey, iv);

            const calculatedChecksum = await this.calculateChecksum(decryptedContent);
            const isContentValid = calculatedChecksum === metadata.checksum;

            return {
                originalName: metadata.originalName,
                mimeType: metadata.mimeType,
                content: decryptedContent,
                size: metadata.size,
                isVerified: isSignatureValid && isContentValid
            };

        } catch (error) {
            throw new Error(`文件解密失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    /**
     * ✅解密群组文件（单次解密，元数据已经是明文）
     */
    async decryptGroupFile(
        encryptedPackage: EncryptedFilePackage,
        _recipientId: string,
        _groupId: string,
        senderId: string
    ): Promise<FileDecryptionResult> {
        try {
            // ✅ 群聊：元数据已经是明文对象（外层已经用 Sender Key 解密过）
            const metadata = encryptedPackage.metadata;

            // 验证签名
            const senderKeys = await e2eeService.getUserPublicKeys(senderId);
            if (!senderKeys) {
                throw new Error('无法获取发送者公钥');
            }

            const isSignatureValid = await e2eeService.verifyContractSignature(
                encryptedPackage.signature,
                new Uint8Array(encryptedPackage.encryptedContent),
                senderKeys.signingPubKey
            );

            // 解密文件内容
            const fileKey = fromBase64(metadata.encryptionKey);
            const iv = fromBase64(metadata.iv);
            const decryptedContent = await this.decryptFileContent(encryptedPackage.encryptedContent, fileKey, iv);

            // 验证完整性
            const calculatedChecksum = await this.calculateChecksum(decryptedContent);
            const isContentValid = calculatedChecksum === metadata.checksum;

            return {
                originalName: metadata.originalName,
                mimeType: metadata.mimeType,
                content: decryptedContent,
                size: metadata.size,
                isVerified: isSignatureValid && isContentValid
            };

        } catch (error) {
            throw new Error(`群组文件解密失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    // === 私有辅助方法（保持不变）===

    generateFileId(): string {
        return `file_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    },

    reportProgress(
        callback: ((progress: FileUploadProgress) => void) | undefined,
        fileId: string,
        loaded: number,
        total: number,
        stage: FileUploadProgress['stage'],
        error?: string
    ): void {
        if (callback) {
            callback({ fileId, loaded, total, stage, error });
        }
    },

    async fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsArrayBuffer(file);
        });
    },

    async calculateChecksum(content: ArrayBuffer): Promise<string> {
        const hashBytes = sha256(new Uint8Array(content));
        return toBase64(hashBytes);
    },

    async encryptFileContent(
        content: ArrayBuffer,
        key: Uint8Array,
        iv: Uint8Array,
        onProgress?: (progress: number) => void
    ): Promise<ArrayBuffer> {
        const encryptedChunks: ArrayBuffer[] = [];
        const totalChunks = Math.ceil(content.byteLength / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, content.byteLength);
            const chunk = content.slice(start, end);

            const chunkIv = new Uint8Array(16);
            chunkIv.set(iv.slice(0, 12));
            const chunkIndex = new DataView(chunkIv.buffer, 12, 4);
            chunkIndex.setUint32(0, i, false);

            const encryptedChunk = cryptoHelper.encrypt(key, new Uint8Array(chunk));
            encryptedChunks.push(encryptedChunk);

            if (onProgress) {
                onProgress((i + 1) * CHUNK_SIZE);
            }
        }

        const totalSize = encryptedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const result = new ArrayBuffer(totalSize);
        const resultView = new Uint8Array(result);

        let offset = 0;
        for (const chunk of encryptedChunks) {
            resultView.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        return result;
    },

    async decryptFileContent(
        encryptedContent: ArrayBuffer,
        key: Uint8Array,
        _iv: Uint8Array
    ): Promise<ArrayBuffer> {
        const decryptedChunks: ArrayBuffer[] = [];
        const encryptedChunkSize = CHUNK_SIZE + 24 + 16;
        const totalChunks = Math.ceil(encryptedContent.byteLength / encryptedChunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * encryptedChunkSize;
            const end = Math.min(start + encryptedChunkSize, encryptedContent.byteLength);
            const encryptedChunk = encryptedContent.slice(start, end);

            const decryptedChunk = cryptoHelper.decrypt(key, new Uint8Array(encryptedChunk));
            if (!decryptedChunk) {
                throw new Error(`解密第${i + 1}块失败`);
            }
            decryptedChunks.push(decryptedChunk.buffer);
        }

        const totalSize = decryptedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const result = new ArrayBuffer(totalSize);
        const resultView = new Uint8Array(result);

        let offset = 0;
        for (const chunk of decryptedChunks) {
            resultView.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        return result;
    },

    createDownloadUrl(content: ArrayBuffer, _fileName: string, mimeType: string): string {
        const blob = new Blob([content], { type: mimeType });
        return URL.createObjectURL(blob);
    },

    revokeDownloadUrl(url: string): void {
        URL.revokeObjectURL(url);
    }
};