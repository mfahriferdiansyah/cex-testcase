/*
    GasController
    1. listen to gas event
    2. check the gas price
    3. if the gas is below the buffer, refill the gas to reach the cap

    Event to listen:
    gas:low {
        wallet: id
    }

    Event to emit:
    gas:refill {
        wallet: id,
        amount: number
        hash: string
    }

    Buffer of gas tx based on wallet:
    1. hot_wallet: 100
    2. warm_wallet: 50
    3. cold_wallet: 0 (only request on withdrawal signal trigerred)
    4. deposit_wallet: 1
*/

import { db } from '../../database/config';
import { wallets } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { publishEvent } from '../../utils/redis-event';
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getSystemWallet, getDepositWalletGasBuffer, decryptWalletKey, WalletType } from '../../utils/wallet-helper';

class GasController {
  private monitoringInterval: NodeJS.Timeout | null = null;
  
  async getWalletBalance(address: string): Promise<bigint> {
    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });
    return await publicClient.getBalance({ address: address as `0x${string}` });
  }

  async getGasPrice(): Promise<bigint> {
    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });
    return await publicClient.getGasPrice();
  }

  calculateGasForTransactions(transactionCount: number, gasPrice: bigint): bigint {
    // Estimate gas per transaction:
    // - Simple ETH transfer: 21000 gas
    // - ERC20 transfer: ~65000 gas
    // - Use 70000 gas as buffer for ERC20 USDC transfers
    const gasPerTransaction = 70000n;
    const totalGas = gasPerTransaction * BigInt(transactionCount);
    return totalGas * gasPrice;
  }

  async sendGasRefill(fromWallet: any, toAddress: string, refillAmount: number): Promise<string> {
    const account = privateKeyToAccount(fromWallet.privateKey as `0x${string}`);
    
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });

    const hash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value: parseEther(refillAmount.toString())
    });

    return hash;
  }

  async handleGasLow(data: { walletType: WalletType | 'deposit', walletId?: number }) {
    let walletAddress: string;
    let transactionBuffer: number;
    
    if (data.walletType === 'deposit') {
      const wallet = await db.select().from(wallets).where(eq(wallets.id, data.walletId!)).limit(1);
      if (!wallet.length) return;
      
      walletAddress = wallet[0].address;
      transactionBuffer = getDepositWalletGasBuffer();
    } else {
      const systemWallet = getSystemWallet(data.walletType);
      walletAddress = systemWallet.address;
      transactionBuffer = systemWallet.gasBuffer;
    }

    if (transactionBuffer === 0) return;

    const currentBalance = await this.getWalletBalance(walletAddress);
    const gasPrice = await this.getGasPrice();
    
    // Calculate required gas for full transaction buffer
    const requiredGasWei = this.calculateGasForTransactions(transactionBuffer, gasPrice);
    
    // Calculate 50% threshold - trigger refill when below 50% of required gas
    const thresholdGasWei = requiredGasWei / 2n;
    
    console.log(`[Gas Controller] Checking ${data.walletType} wallet ${walletAddress}:`);
    console.log(`  Current balance: ${Number(currentBalance) / 1e18} ETH`);
    console.log(`  Required for ${transactionBuffer} transactions: ${Number(requiredGasWei) / 1e18} ETH`);
    console.log(`  Threshold (50%): ${Number(thresholdGasWei) / 1e18} ETH`);

    if (currentBalance < thresholdGasWei) {
      // Refill to full buffer amount
      const refillAmountWei = requiredGasWei - currentBalance;
      const refillAmountEth = Number(refillAmountWei) / 1e18;
      
      console.log(`  🔥 Gas low! Refilling ${refillAmountEth} ETH`);
      
      const gasWallet = getSystemWallet('gas');
      const hash = await this.sendGasRefill(gasWallet, walletAddress, refillAmountEth);
      
      await publishEvent('gas:refill', {
        wallet: data.walletId || data.walletType,
        amount: refillAmountEth,
        hash,
        transactionBuffer,
        gasPrice: gasPrice.toString()
      });
      
      console.log(`  ✅ Gas refill completed: ${hash}`);
    } else {
      console.log(`  ✅ Gas sufficient, no refill needed`);
    }
  }

  async startGasMonitoring() {
    console.log('[Gas Controller] Starting proactive gas monitoring...');
    
    // Initial check on startup
    await this.checkAllSystemWallets();
    
    // Set up periodic monitoring every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAllSystemWallets();
      } catch (error) {
        console.error('[Gas Controller] Error during periodic monitoring:', error);
      }
    }, 30000); // 30 seconds
    
    console.log('[Gas Controller] Gas monitoring started - checking every 30 seconds');
  }

  async stopGasMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[Gas Controller] Gas monitoring stopped');
    }
  }

  async checkAllSystemWallets() {
    const systemWalletTypes: WalletType[] = ['hot', 'warm', 'cold'];
    
    for (const walletType of systemWalletTypes) {
      try {
        await this.checkSystemWalletGas(walletType);
      } catch (error) {
        console.error(`[Gas Controller] Error checking ${walletType} wallet:`, error);
      }
    }
  }

  async checkSystemWalletGas(walletType: WalletType) {
    const systemWallet = getSystemWallet(walletType);
    const transactionBuffer = systemWallet.gasBuffer;
    
    // Skip if no gas buffer required
    if (transactionBuffer === 0) {
      return;
    }
    
    const currentBalance = await this.getWalletBalance(systemWallet.address);
    const gasPrice = await this.getGasPrice();
    
    // Calculate required gas for full transaction buffer
    const requiredGasWei = this.calculateGasForTransactions(transactionBuffer, gasPrice);
    
    // Calculate 50% threshold - refill when below 50% of required gas
    const thresholdGasWei = requiredGasWei / 2n;
    
    const currentGasEth = Number(currentBalance) / 1e18;
    const requiredGasEth = Number(requiredGasWei) / 1e18;
    const thresholdGasEth = Number(thresholdGasWei) / 1e18;
    
    console.log(`[Gas Controller] Monitoring ${walletType.toUpperCase()} wallet (${systemWallet.address}):`);
    console.log(`  Current: ${currentGasEth.toFixed(6)} ETH`);
    console.log(`  Required: ${requiredGasEth.toFixed(6)} ETH`);
    console.log(`  Threshold: ${thresholdGasEth.toFixed(6)} ETH`);
    
    if (currentBalance < thresholdGasWei) {
      console.log(`  🔥 Below threshold! Auto-refilling...`);
      await this.refillSystemWalletGas(walletType, systemWallet, requiredGasWei, currentBalance);
    } else {
      console.log(`  ✅ Gas sufficient`);
    }
  }

  async refillSystemWalletGas(walletType: WalletType, systemWallet: any, requiredGasWei: bigint, currentBalance: bigint) {
    try {
      // Refill to full buffer amount
      const refillAmountWei = requiredGasWei - currentBalance;
      const refillAmountEth = Number(refillAmountWei) / 1e18;
      
      console.log(`[Gas Controller] Auto-refilling ${walletType} wallet with ${refillAmountEth.toFixed(6)} ETH`);
      
      const gasWallet = getSystemWallet('gas');
      const hash = await this.sendGasRefill(gasWallet, systemWallet.address, refillAmountEth);
      
      await publishEvent('gas:refill', {
        wallet: walletType,
        amount: refillAmountEth,
        hash,
        transactionBuffer: systemWallet.gasBuffer,
        trigger: 'automatic-monitoring'
      });
      
      console.log(`[Gas Controller] ✅ Auto-refill completed: ${hash}`);
      
    } catch (error) {
      console.error(`[Gas Controller] ❌ Auto-refill failed for ${walletType} wallet:`, error);
    }
  }
}

export const gasController = new GasController();
