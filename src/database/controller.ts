import { db } from "./config";
import { wallets, withdrawalQueue } from "./schema";
import { eq, sum, and, sql, asc } from "drizzle-orm";

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

    async getAllWallets() {
      return await db.select().from(wallets).orderBy(asc(wallets.id));
    }

    async freezeWallet(id: number) {
      return await db.update(wallets).set({ frozen: true }).where(eq(wallets.id, id));
    }

    async unfreezeWallet(id: number) {
      return await db.update(wallets).set({ frozen: false }).where(eq(wallets.id, id));
    }
  
    async createWithdrawalQueue(walletId: number, amount: string, toAddress: string) {
      // Check if withdrawal amount is available
      const availableBalance = await this.getAvailableBalance(walletId);
      const withdrawalAmount = parseFloat(amount);
      const availableAmount = parseFloat(availableBalance);
      
      if (withdrawalAmount > availableAmount) {
        throw new Error(`Insufficient balance: requested ${withdrawalAmount} USDC, available ${availableAmount} USDC`);
      }
      
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

    // Balance management methods
    async addToBalance(walletId: number, amount: string) {
      const [wallet] = await db
        .update(wallets)
        .set({ 
          balance: sql`${wallets.balance} + ${amount}` 
        })
        .where(eq(wallets.id, walletId))
        .returning();
      return wallet;
    }

    async subtractFromBalance(walletId: number, amount: string) {
      const [wallet] = await db
        .update(wallets)
        .set({ 
          balance: sql`${wallets.balance} - ${amount}` 
        })
        .where(eq(wallets.id, walletId))
        .returning();
      return wallet;
    }

    async getWalletBalance(walletId: number): Promise<string> {
      const wallet = await this.getWalletById(walletId);
      return wallet?.balance || '0';
    }

    async getAvailableBalance(walletId: number): Promise<string> {
      // Get wallet balance
      const wallet = await this.getWalletById(walletId);
      if (!wallet) return '0';
      
      // Calculate pending withdrawals
      const pendingWithdrawals = await db
        .select({ 
          total: sql<string>`COALESCE(SUM(CAST(${withdrawalQueue.amount} AS DECIMAL)), 0)` 
        })
        .from(withdrawalQueue)
        .where(
          and(
            eq(withdrawalQueue.walletId, walletId),
            eq(withdrawalQueue.status, status.processing)
          )
        );
      
      const totalPending = pendingWithdrawals[0]?.total || '0';
      
      // Calculate available balance: balance - pending withdrawals (in JavaScript)
      const walletBalance = parseFloat(wallet.balance || '0');
      const pendingAmount = parseFloat(totalPending);
      const availableBalance = walletBalance - pendingAmount;
      
      return availableBalance.toString();
    }

    async updateWalletBalance(walletId: number, newBalance: string) {
      const [wallet] = await db
        .update(wallets)
        .set({ balance: newBalance })
        .where(eq(wallets.id, walletId))
        .returning();
      return wallet;
    }
}