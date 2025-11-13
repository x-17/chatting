// contracts/services/contract-api.service.ts

import { createAuthenticatedApiClient } from "../../utils/api-client";
import type {
  Contract,
  SignatureRecord,
  OrderSignRequest,
  orderSignState,
  fileInfo,
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
   * ������ͬǩ��
   * @param params ǩ���������
   * @returns ǩ����
   */
  async orderSign(params: OrderSignRequest): Promise<ApiResponse<string>> {
    const response = await this.apiClient.post<ApiResponse<string>>(
      "/order/orderSign",
      params
    );
    return response.data; // ֱ�ӷ�����Ӧ�� data������ apiClient �Ѵ�����Ӧ���أ�
  }
  /**
   * �ܾ�������ͬǩ��
   * @param params ǩ���������
   * @returns ǩ����
   */
  async rejectOrderSign(orderId: string): Promise<ApiResponse<string>> {
    const response = await this.apiClient.post<ApiResponse<string>>(
      "/order/rejectSign",
      { orderId }
    );
    return response.data; // ֱ�ӷ�����Ӧ�� data������ apiClient �Ѵ�����Ӧ���أ�
  }
  /**
   * ��ѯ������ͬǩ��״̬
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
      return error;
    }
  }
  /**
   * ��һ�������ýӿڻ�ȡ�ļ����� URL
   * @param fileId �ļ� ID
   * @returns ���� URL��ʧ�ܷ��� null��
   */
  async getFileDownloadUrl(fileId: string): Promise<string | null> {
    try {
      const response = await this.apiClient.get<ApiResponse<fileInfo>>(
        `/file/${fileId}`
      );
      // ����ӿڷ��� code=0 Ϊ�ɹ�
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
   * ��һ�������ýӿڻ�ȡ�ļ�����
   * @param fileId �ļ� ID
   * @returns Filename��ʧ�ܷ��� null��
   */
  async getFileDownloadName(fileId: string): Promise<string | null> {
    try {
      const response = await this.apiClient.get<ApiResponse<fileInfo>>(
        `/file/${fileId}`
      );
      // ����ӿڷ��� code=0 Ϊ�ɹ�
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
   * 下载二进制文件
   * @param url 文件下载链接
   * @returns ArrayBuffer 或 null
   */
  async downloadBinaryFile(url: string): Promise<ArrayBuffer | null> {
    try {
      // 直接使用完整的 URL 进行下载
      const response = await this.apiClient.get(url, {
        responseType: "arraybuffer",
      });
      return response.data; // ���������ݣ�ArrayBuffer ���ͣ�
    } catch (error) {
      console.error("文件下载失败", error);
      return null;
    }
  }
}
