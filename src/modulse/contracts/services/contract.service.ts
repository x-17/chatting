// contracts/services/contract.service.ts

import { e2eeService } from "../../signal/services/e2ee.service";
import { ContractApiService } from "./contract-api.service";
import { ContractPersistenceService } from "./contract-persistence.service";
import type {
  Contract,
  SignatureRecord,
  ContractParticipant,
  UploadOrderQuoteRequest,
} from "../types/contract.types";
import type { ApiResponse } from "../../utils/api-client";
import { getSigningPrivateKey } from "../../signal/services/e2ee.service";

export class ContractService {
  private apiService: ContractApiService;
  private persistence: ContractPersistenceService;
  private myUserId: string;

  constructor(userId: string) {
    this.myUserId = userId;
    this.apiService = new ContractApiService();
    this.persistence = new ContractPersistenceService(userId);
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    await this.persistence.init();
  }

  /**
   * 签署合同（核心功能）
   */
  async signContract(contractId: string): Promise<{
    success: boolean;
    contract: Contract;
    isCompleted: boolean;
  }> {
    console.log(`[Contract] Signing contract: ${contractId}`);

    try {
      // 1. 获取合同
      const contract = await this.getContract(contractId);

      // 2. 验证权限
      this.validateSigningPermission(contract);

      // 3. 下载合同文件
      const fileContent = await this.downloadContractFile(contract);

      // 4. 生成数字签名（核心）
      const signature = await e2eeService.signContract(
        this.myUserId,
        new Uint8Array(fileContent)
      );

      // 5. 创建签名记录
      const signatureRecord: SignatureRecord = {
        signerId: this.myUserId,
        signerName: this.getCurrentUserName(),
        signature: signature,
        signedAt: Date.now(),
        ipAddress: await this.getClientIP(),
        deviceInfo: navigator.userAgent,
      };

      // 6. 提交到服务器
      const result = await this.apiService.submitSignature(
        contractId,
        signatureRecord
      );

      // 7. 本地持久化
      await this.persistence.saveContract(result.contract);

      // 8. 检查是否完成
      const isCompleted = result.contract.status === "completed";

      if (isCompleted) {
        await this.handleContractCompleted(result.contract);
      }

      return {
        success: true,
        contract: result.contract,
        isCompleted: isCompleted,
      };
    } catch (error) {
      console.error("[Contract] Sign failed:", error);
      throw error;
    }
  }

  /**
   * 验证合同的所有签名
   */
  async verifyContract(contractId: string): Promise<{
    isValid: boolean;
    fileIntegrity: boolean;
    signatureResults: Array<{ signerId: string; isValid: boolean }>;
  }> {
    console.log(`[Contract] Verifying contract: ${contractId}`);

    try {
      const contract = await this.getContract(contractId);

      // 1. 验证文件完整性
      const fileContent = await this.downloadContractFile(contract);
      const calculatedHash = await this.calculateFileHash(fileContent);
      const fileIntegrity = calculatedHash === contract.fileHash;

      if (!fileIntegrity) {
        console.error("[Contract] File tampered!");
        return {
          isValid: false,
          fileIntegrity: false,
          signatureResults: [],
        };
      }

      // 2. 验证每个签名
      const signatureResults = [];

      for (const participant of contract.participants) {
        if (!participant.hasSigned || !participant.signatureRecord) {
          continue;
        }

        // 获取签名者的公钥
        const publicKeys = await e2eeService.getUserPublicKeys(
          participant.userId
        );
        if (!publicKeys) {
          signatureResults.push({
            signerId: participant.userId,
            isValid: false,
          });
          continue;
        }

        // 验证签名
        const isValid = await e2eeService.verifyContractSignature(
          participant.signatureRecord.signature,
          new Uint8Array(fileContent),
          publicKeys.signingPubKey
        );

        signatureResults.push({
          signerId: participant.userId,
          isValid: isValid,
        });
      }

      const allValid = signatureResults.every((r) => r.isValid);

      return {
        isValid: allValid && fileIntegrity,
        fileIntegrity: fileIntegrity,
        signatureResults: signatureResults,
      };
    } catch (error) {
      console.error("[Contract] Verify failed:", error);
      throw error;
    }
  }

  /**
   * 获取合同详情
   */
  async getContract(contractId: string): Promise<Contract> {
    // 先尝试从本地获取
    let contract = await this.persistence.getContract(contractId);

    if (!contract) {
      // 从服务器获取
      contract = await this.apiService.getContract(contractId);
      await this.persistence.saveContract(contract);
    }

    return contract;
  }

  /**
   * 获取订单的所有合同
   */
  async getContractsByOrder(orderId: string): Promise<Contract[]> {
    return await this.apiService.getContractsByOrder(orderId);
  }

  // ========== 私有方法 ==========

  private validateSigningPermission(contract: Contract): void {
    // 检查状态
    if (
      contract.status !== "pending_signatures" &&
      contract.status !== "signing"
    ) {
      throw new Error("合同状态不允许签署");
    }

    // 检查过期
    if (contract.expiresAt && Date.now() > contract.expiresAt) {
      throw new Error("合同已过期");
    }

    // 检查顺序
    const currentSigner = contract.participants[contract.currentSignerIndex];
    if (currentSigner.userId !== this.myUserId) {
      throw new Error(`当前轮到 ${currentSigner.userName} 签署`);
    }

    // 检查重复签名
    if (currentSigner.hasSigned) {
      throw new Error("您已经签署过此合同");
    }
  }

  private async calculateFileHash(content: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private async downloadContractFile(contract: Contract): Promise<ArrayBuffer> {
    if (!contract.fileId) {
      // 如果没有文件，使用文本内容
      const encoder = new TextEncoder();
      return encoder.encode(contract.content).buffer;
    }

    return await this.apiService.downloadFile(contract.fileId);
  }

  private async handleContractCompleted(contract: Contract): Promise<void> {
    console.log("[Contract] Completed, binding to order:", contract.orderId);

    // 绑定到订单
    await this.apiService.bindContractToOrder(contract.orderId, contract.id);
  }

  private getCurrentUserName(): string {
    const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
    return user.userName || "Unknown";
  }

  private async getClientIP(): Promise<string | undefined> {
    try {
      const response = await fetch("https://api.ipify.org?format=json");
      const data = await response.json();
      return data.ip;
    } catch {
      return undefined;
    }
  }
  //-----------------------------------
  /**
   * 完整流程：获取文件 ID → 拿下载 URL → 下载二进制文件
   */
  async getBinaryFileByFileId(fileId: string): Promise<ArrayBuffer | null> {
    // 1. 获取下载 URL
    const downloadUrl = await this.apiService.getFileDownloadUrl(fileId);
    if (!downloadUrl) {
      return null;
    }

    // 2. 下载二进制文件
    const binaryData = await this.apiService.downloadFile(downloadUrl);
    return binaryData;
  }
  async agreeOderSign(
    orderId: string,
    fileId: string
  ): Promise<ApiResponse<string>> {
    // const fileContent = await this.getBinaryFileByFileId(fileId);
    // if (!fileContent) {
    //   throw new Error("无法下载合同文件");
    // }
    // const signature = await e2eeService.signContract(
    //   this.myUserId,
    //   new Uint8Array(fileContent)
    // );
    const signature = await getSigningPrivateKey(this.myUserId);
    return await this.apiService.orderSign({
      orderId: orderId,
      fileId: Number(fileId),
      signature: signature,
    });
  }

  async uploadOrderQuote(
    params: Omit<UploadOrderQuoteRequest, "signature">
  ): Promise<ApiResponse<string>> {
    const signature = await getSigningPrivateKey(this.myUserId);
    return await this.apiService.uploadOrderQuote({
      ...params,
      signature: signature,
    });
  }
  async queryOrderSignState(orderId: string) {
    return await this.apiService.queryOrderSignStateApi(orderId);
  }
  async rejectOderSign(orderId: string) {
    return await this.apiService.rejectOrderSign(orderId);
  }
}

// 工厂函数
const contractServices = new Map<string, ContractService>();

export function getContractService(userId: string): ContractService {
  if (!contractServices.has(userId)) {
    contractServices.set(userId, new ContractService(userId));
  }
  return contractServices.get(userId)!;
}
