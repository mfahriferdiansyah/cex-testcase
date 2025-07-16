import { db } from "./config";
import { wallets, withdrawalQueue } from "./schema";
import { eq } from "drizzle-orm";

export const status = {
    processing: 'processing',
    processed: 'processed',
    failed: 'failed',
    pending: 'pending'
} as const;

export type Status = typeof status[keyof typeof status];

export class DatabaseController {
    async createWallet(address: string, encryptedKey: string) {
      const [wallet] = await db.insert(wallets).values({
        address,
        encryptedKey
      }).returning();
      return wallet;
    }
  
    async getWalletByAddress(address: string) {
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.address, address));
      return wallet;
    }

    async getWalletById(id: number) {
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, id));
      return wallet;
    }

    async freezeWallet(id: number) {
      return await db.update(wallets).set({ frozen: true }).where(eq(wallets.id, id));
    }

    async unfreezeWallet(id: number) {
      return await db.update(wallets).set({ frozen: false }).where(eq(wallets.id, id));
    }
  
    async createWithdrawalQueue(walletId: number, amount: string, toAddress: string) {
      const [withdrawal] = await db.insert(withdrawalQueue).values({
        walletId,
        amount,
        toAddress
      }).returning();
      return withdrawal;
    }
  
    async getWithdrawalQueueByStatus(statusTarget: Status) {
      return await db
        .select()
        .from(withdrawalQueue)
        .where(eq(withdrawalQueue.status, statusTarget));
    }

    async getWithdrawalQueueByWalletId(walletId: number) {
      return await db
        .select()
        .from(withdrawalQueue)
        .where(eq(withdrawalQueue.walletId, walletId));
    }
  
    async changeWithdrawalQueueStatus(id: number, statusTarget: Status) {
      const [withdrawal] = await db
        .update(withdrawalQueue)
        .set({ 
          status: statusTarget, 
          processedAt: new Date() 
        })
        .where(eq(withdrawalQueue.id, id))
        .returning();
      return withdrawal;
    }

    async markQueueAsProcessed(id: number) {
      return await this.changeWithdrawalQueueStatus(id, status.processed);
    }

    async markQueueAsFailed(id: number) {
      return await this.changeWithdrawalQueueStatus(id, status.failed);
    }
    
    async markQueueAsPending(id: number) {
      return await this.changeWithdrawalQueueStatus(id, status.pending);
    }

    async markQueueAsProcessing(id: number) {
      return await this.changeWithdrawalQueueStatus(id, status.processing);
    }
}