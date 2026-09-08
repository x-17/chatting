// contracts/services/contract-api.service.ts

import { createAuthenticatedApiClient } from "../../utils/api-client";
import type {
  Contract,
  SignatureRecord,
  OrderSignRequest,
  orderSignState,
  fileInfo,
  UploadOrderQuoteRequest,
} from "../types/contract.types";
import type { ApiResponse } from "../../utils/api-client";
import type { SignRecordResponse } from "../types/contract.types";

export class ContractApiService {
  private apiClient = createAuthenticatedApiClient();

  async getContract(contractId: string): Promise<Contract> {
    const response = await this.apiClient.get<{ contract: Contract }>(
      `/api/contracts/${contractId}`
    );
    return response.data.contract;
  }

  async getContractsByOrder(orderId: string): Promise<Contract[]> {
    const response = await this.apiClient.get<{ contracts: Contract[] }>(
      `/api/orders/${orderId}/contracts`
    );
    return response.data.contracts;
  }

  async submitSignature(
    contractId: string,
    signature: SignatureRecord
  ): Promise<{ contract: Contract }> {
    const response = await this.apiClient.post<{ contract: Contract }>(
      `/api/contracts/${contractId}/sign`,
      { signature }
    );
    return response.data;
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const response = await this.apiClient.get<ArrayBuffer>(
      `/api/contracts/files/${fileId}`,
      { responseType: "arraybuffer" }
    );
    return response.data;
  }

  async bindContractToOrder(
    orderId: string,
    contractId: string
  ): Promise<void> {
    await this.apiClient.post(`/api/orders/${orderId}/bind-contract`, {
      contractId,
    });
  }
  /**
   * 订单签署
   * @param params 签署参数
   * @returns 签署结果
   */
  async orderSign(params: OrderSignRequest): Promise<ApiResponse<string>> {
    const response = await this.apiClient.post<ApiResponse<string>>(
      "/order/orderSign",
      params
    );
    return response.data;
  }
  /**
   * 拒绝订单签署
   * @param params 签署参数
   * @returns 签署结果
   */
  async rejectOrderSign(orderId: string): Promise<ApiResponse<string>> {
    const response = await this.apiClient.post<ApiResponse<string>>(
      "/order/rejectSign",
      { orderId }
    );
    return response.data;
  }
  /**
   * 查询订单签署状态
   */
  async queryOrderSignStateApi(orderId: string): Promise<SignRecordResponse> {
    try {
      const response = await this.apiClient.post<SignRecordResponse>(
        "/order/queryOrderSign",
        {
          orderId,
        }
      );
      return response.data;
    } catch (error) {
      console.error("[OrderApi] query oderSign state error", error);
      return error as any;
    }
  }
  /**
   * 获取文件下载 URL
   * @param fileId 文件 ID
   * @returns 下载 URL，失败返回 null
   */
  async getFileDownloadUrl(fileId: string): Promise<string | null> {
    try {
      const response = await this.apiClient.get<ApiResponse<fileInfo>>(
        `/file/${fileId}`
      );
      if (response.data.code === 1 && response.data.data.url) {
        return response.data.data.url;
      }
      console.error("获取文件信息失败", response.data.msg);
      return null;
    } catch (error) {
      console.error("获取文件信息错误", error);
      return null;
    }
  }
  /**
   * 获取文件下载名称
   * @param fileId 文件 ID
   * @returns Filename，失败返回 null
   */
  async getFileDownloadName(fileId: string): Promise<string | null> {
    try {
      const response = await this.apiClient.get<ApiResponse<fileInfo>>(
        `/file/${fileId}`
      );
      if (response.data.code === 1 && response.data.data.fileName) {
        return response.data.data.fileName;
      }
      console.error("下载失败", response.data.msg);
      return null;
    } catch (error) {
      console.error("下载失败", error);
      return null;
    }
  }

  /**
   * 通过 POST 请求获取文件的 Base64 内容
   */
  async downloadFileContentBase64(fileId: number): Promise<{ fileName: string; fileContent: string } | null> {
    try {
      const response = await this.apiClient.post<{
        code: number;
        msg: string;
        data: { fileName: string; fileContent: string };
      }>("/file/download", { fileId });

      if (response.data.code === 1) {
        return response.data.data;
      }
      console.error("获取文件内容失败", response.data.msg);
      return null;
    } catch (error) {
      console.error("获取文件内容异常", error);
      return null;
    }
  }

  /**
   * 下载二进制文件
   * @param url 文件下载链接
   * @returns ArrayBuffer 或 null
   */
  async downloadBinaryFile(url: string): Promise<ArrayBuffer | null> {
    try {
      const response = await this.apiClient.get(url, {
        responseType: "arraybuffer",
      });
      return response.data;
    } catch (error) {
      console.error("文件下载失败", error);
      return null;
    }
  }

  /**
   * 上传订单报价信息并签署
   */
  async uploadOrderQuote(
    params: UploadOrderQuoteRequest
  ): Promise<ApiResponse<string>> {
    const formData = new FormData();
    formData.append("orderId", params.orderId);
    formData.append("amount", String(params.amount));
    formData.append("usageStartTime", params.usageStartTime);
    formData.append("usageEndTime", params.usageEndTime);
    formData.append("fileId", String(params.fileId));
    formData.append("signature", params.signature);

    const response = await this.apiClient.post<ApiResponse<string>>(
      "/order/uploadOrderQuote",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
    return response.data;
  }
}
