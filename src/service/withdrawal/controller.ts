/* 
    RequestWithdrawal
    1. get withdrawal amount & address, change status to processing
    2. check if the withdrawal amount is greater than the balance
    3. emit withdrawal:request event
    4. check if it's more than safe withdrawal treshold, minimal suspicious withdrawal
    5. check if hot wallet sufficient
    6. if not, emit withdrawal::hot_insufficient event
    7. check if the warm wallet sufficient
    8. if not, emit withdrawal::warm_insufficient event
    9. waiting for replinish:hot_wallet event
    10. insert withdrawal to queue

    QueueWithdrawalExecutor
    1. get batch of withdrawal from queue
    2. check if the withdrawal amount is greater than the balance
    3. if not, waiting for replinish:hot_wallet event
    3. execute withdrawal transaction
    4. change status to success or pending
    5. emit withdrawal:success or withdrawal:pending event
    6. remove withdrawal from queue
*/

import { db } from '../../database/config';
import { withdrawalQueue, wallets } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { publishEvent } from '../../utils/redis-event';
import { DatabaseController } from '../../database/controller';
import { createWalletClient, createPublicClient, http, parseEther, parseAbiItem, formatUnits } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getSystemWallet } from '../../utils/wallet-helper';
import { usdcAbi, parseUSDCNumber, formatUSDC } from '../../utils/usdc-helper';

class WithdrawalController {
  private processorInterval: NodeJS.Timeout | null = null;
  private depositUnwatch?: () => void;
  private dbController = new DatabaseController();
  private publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
  });

  private isGasRelatedError(error: any): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const gasErrorPatterns = [
      'gas required exceeds allowance',
      'insufficient funds for gas',
      'out of gas',
      'gas limit exceeded',
      'transaction underpriced'
    ];
    
    return gasErrorPatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  async processWithdrawal(withdrawal: any): Promise<string> {
    const hotWallet = getSystemWallet('hot');
    const account = privateKeyToAccount(hotWallet.privateKey as `0x${string}`);
    
    const client = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });

    const hash = await client.writeContract({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: 'transfer',
      args: [withdrawal.toAddress as `0x${string}`, parseUSDCNumber(withdrawal.amount)]
    });

    return hash;
  }

  async handleHotWalletReplenished(data: any) {
    const pendingWithdrawals = await db.select()
      .from(withdrawalQueue)
      .where(eq(withdrawalQueue.status, 'pending'));

    for (const withdrawal of pendingWithdrawals) {
      try {
        await db.update(withdrawalQueue)
          .set({ status: 'processing' })
          .where(eq(withdrawalQueue.id, withdrawal.id));

        const hash = await this.processWithdrawal(withdrawal);

        await db.update(withdrawalQueue)
          .set({ 
            status: 'processed',
            processedAt: new Date()
          })
          .where(eq(withdrawalQueue.id, withdrawal.id));

        // Deduct from database balance
        if (withdrawal.walletId) {
          await this.dbController.subtractFromBalance(withdrawal.walletId, withdrawal.amount);
          console.log(`[Withdrawal Service] Deducted ${withdrawal.amount} USDC from wallet ${withdrawal.walletId} database balance`);
        }

        await publishEvent('withdrawal:success', {
          withdrawalId: withdrawal.id,
          hash
        });
      } catch (error) {
        await db.update(withdrawalQueue)
          .set({ status: 'failed' })
          .where(eq(withdrawalQueue.id, withdrawal.id));

        console.error(`Failed to process withdrawal ${withdrawal.id}:`, error);
      }
    }
  }

  startQueueProcessor() {
    this.processorInterval = setInterval(async () => {
      const batch = await db.select()
        .from(withdrawalQueue)
        .where(eq(withdrawalQueue.status, 'processing'))
        .limit(10);

      for (const withdrawal of batch) {
        try {
          const hash = await this.processWithdrawal(withdrawal);

          await db.update(withdrawalQueue)
            .set({ 
              status: 'processed',
              processedAt: new Date()
            })
            .where(eq(withdrawalQueue.id, withdrawal.id));

          // Deduct from database balance
          if (withdrawal.walletId) {
            await this.dbController.subtractFromBalance(withdrawal.walletId, withdrawal.amount);
            console.log(`[Withdrawal Service] Deducted ${withdrawal.amount} USDC from wallet ${withdrawal.walletId} database balance`);
          }

          await publishEvent('withdrawal:success', {
            withdrawalId: withdrawal.id,
            hash
          });
        } catch (error) {
          await db.update(withdrawalQueue)
            .set({ status: 'failed' })
            .where(eq(withdrawalQueue.id, withdrawal.id));

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Check if error is gas-related and emit gas:low event
          if (this.isGasRelatedError(error)) {
            console.log(`[Withdrawal Service] Gas-related error detected for withdrawal ${withdrawal.id}: ${errorMessage}`);
            console.log(`[Withdrawal Service] Emitting gas:low event for hot wallet`);
            
            await publishEvent('gas:low', {
              walletType: 'hot',
              reason: 'withdrawal_failed',
              withdrawalId: withdrawal.id
            });
          }

          await publishEvent('withdrawal:failed', {
            withdrawalId: withdrawal.id,
            error: errorMessage
          });
        }
      }
    }, 5000);
  }

  stopQueueProcessor() {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
    }
  }

  async startDepositMonitoring() {
    console.log('[Withdrawal Service] Starting deposit monitoring...');
    
    const depositWallets = await this.getDepositWallets();
    const walletAddresses = depositWallets.map(w => w.address);
    
    console.log(`[Withdrawal Service] Monitoring ${walletAddresses.length} deposit wallets`);
    
    this.depositUnwatch = this.publicClient.watchContractEvent({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: [parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')],
      eventName: 'Transfer',
      args: {
        to: walletAddresses as `0x${string}`[]
      },
      onLogs: this.handleDepositLogs.bind(this),
      onError: (error) => {
        console.error('[Withdrawal Service] Deposit monitoring error:', error);
        setTimeout(() => this.startDepositMonitoring(), 5000);
      }
    });
  }

  async handleDepositLogs(logs: any[]) {
    for (const log of logs) {
      const { from, to, value } = log.args;
      const depositAmount = Number(formatUnits(value, 6));
      
      console.log(`[Withdrawal Service] Deposit detected: ${depositAmount} USDC from ${from} to ${to}`);
      console.log(`[Withdrawal Service] Transaction: ${log.transactionHash}`);
      
      // Get wallet ID
      const walletId = await this.getWalletId(to);
      if (!walletId) {
        console.error(`[Withdrawal Service] Wallet not found: ${to}`);
        continue;
      }
      
      // Update database balance
      await this.dbController.addToBalance(walletId, depositAmount.toString());
      console.log(`[Withdrawal Service] Added ${depositAmount} USDC to wallet ${walletId} database balance`);
      
      // Check current total balance of the wallet
      const currentBalance = await this.publicClient.readContract({
        address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [to as `0x${string}`]
      });
      
      const totalUSDC = Number(formatUSDC(currentBalance));
      console.log(`[Withdrawal Service] Wallet ${walletId} total balance: ${totalUSDC} USDC`);
      
      const threshold = parseInt(process.env.DEPOSIT_SWEEP_THRESHOLD || '100');
      if (totalUSDC >= threshold) {
        console.log(`[Withdrawal Service] Balance above threshold (${threshold} USDC), triggering events...`);
        
        await publishEvent('gas:low', {
          walletType: 'deposit',
          walletId: walletId
        });
        console.log(`[Withdrawal Service] Emitted gas:low for wallet ${walletId}`);
        
        await publishEvent('deposit_wallet:sweepable', {
          wallet: walletId,
          amount: totalUSDC  // Send total balance, not just deposit amount
        });
        console.log(`[Withdrawal Service] Emitted deposit_wallet:sweepable for wallet ${walletId} with total balance ${totalUSDC} USDC`);
      } else {
        console.log(`[Withdrawal Service] Balance ${totalUSDC} USDC is below threshold (${threshold} USDC), no action taken`);
      }
    }
  }

  async getDepositWallets() {
    return await db.select().from(wallets);
  }

  async getWalletId(address: string): Promise<number | null> {
    const wallet = await db.select().from(wallets)
      .where(eq(wallets.address, address.toLowerCase()))
      .limit(1);
    return wallet[0]?.id || null;
  }

  stopDepositMonitoring() {
    if (this.depositUnwatch) {
      console.log('[Withdrawal Service] Stopping deposit monitoring...');
      this.depositUnwatch();
    }
  }
}

export const withdrawalController = new WithdrawalController();

