// contracts/services/contract-api.service.ts

import { createAuthenticatedApiClient } from '../../utils/api-client';
import type { Contract, SignatureRecord } from '../types/contract.types';

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
            { responseType: 'arraybuffer' }
        );
        return response.data;
    }

    async bindContractToOrder(orderId: string, contractId: string): Promise<void> {
        await this.apiClient.post(`/api/orders/${orderId}/bind-contract`, {
            contractId
        });
    }
}