// contracts/services/contract-persistence.service.ts

import { openDB, type IDBPDatabase } from 'idb';
import type { Contract } from '../types/contract.types';

const DB_NAME = 'contracts-db';
const DB_VERSION = 1;
const STORE_NAME = 'contracts';

export class ContractPersistenceService {
    private db: IDBPDatabase | null = null;
    private userId: string;

    constructor(userId: string) {
        this.userId = userId;
    }

    async init(): Promise<void> {
        if (this.db) return;

        this.db = await openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('by-order', 'orderId');
                    store.createIndex('by-user', 'userId');
                    store.createIndex('by-status', 'status');
                }
            },
        });
    }

    async saveContract(contract: Contract): Promise<void> {
        await this.ensureDb();

        const contractWithUser = {
            ...contract,
            userId: this.userId
        };

        await this.db!.put(STORE_NAME, contractWithUser);
    }

    async getContract(contractId: string): Promise<Contract | null> {
        await this.ensureDb();

        const contract = await this.db!.get(STORE_NAME, contractId);
        return contract?.userId === this.userId ? contract : null;
    }

    async getContractsByOrder(orderId: string): Promise<Contract[]> {
        await this.ensureDb();

        const index = this.db!.transaction(STORE_NAME).store.index('by-order');
        const contracts = await index.getAll(orderId);

        return contracts.filter(c => c.userId === this.userId);
    }

    private async ensureDb(): Promise<void> {
        if (!this.db) {
            await this.init();
        }
    }
}