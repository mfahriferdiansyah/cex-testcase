/*
    SweepAndReplinish
    1. listen to deposit and transfer event
    2. check the total balance of the wallet
    3. handle sweep from deposit wallet to warm wallet
        if hot_wallet:insufficient or
        periodical sweep are met
        emit sweep:deposit_wallet on success
    4. handle replinish from warm wallet to hot wallet
        if hot_wallet:insufficient or
        periodical replinish are met
        emit replinish:hot_wallet event on success
    5. handle sweep from warm wallet to cold wallet
        if warm_wallet:sweepable or
        if periodical sweep are met
        emit sweep:warm_wallet on success
    6. handle replinish from cold wallet to warm wallet
        if warm_wallet:insufficient or
        periodical replinish are met
        emit replinish:warm_wallet event on success

    Event To Listen:
    hot_wallet:insufficient { wallet: id, amount: number }
    warm_wallet:sweepable { wallet: id, amount: number }
    warm_wallet:insufficient { wallet: id, amount: number }
    deposit_wallet:sweepable { wallet: id, amount: number }
    deposit_wallet:insufficient { wallet: id, amount: number }

    Event to emit:
    sweep:deposit_wallet { wallet: id, amount: number }
    sweep:warm_wallet { wallet: id, amount: number }
    replinish:hot_wallet { wallet: id, amount: number }
    replinish:warm_wallet { wallet: id, amount: number }
    gas:low { wallet: id, queue: id }

    ** periodical sweep are based on next predicted lowest gas occurance
    untuk serkarang ignore, dan dibuat cronjob
    replinish/batch are done batched
*/

import { db } from '../../database/config';
import { wallets } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { publishEvent } from '../../utils/redis-event';
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getSystemWallet, decryptWalletKey } from '../../utils/wallet-helper';
import { usdcAbi, parseUSDCNumber } from '../../utils/usdc-helper';

class SweepController {
  private monitoringInterval: NodeJS.Timeout | null = null;
  
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
  
  async getUSDCBalance(address: string): Promise<bigint> {
    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });
    return await publicClient.readContract({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`]
    });
  }

  async transferUSDC(fromWallet: any, toAddress: string, amount: number): Promise<string> {
    const account = privateKeyToAccount(fromWallet.privateKey as `0x${string}`);
    
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });

    const hash = await walletClient.writeContract({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, parseUSDCNumber(amount)]
    });

    return hash;
  }

  async handleHotWalletInsufficient(data: { amount: number }) {
    const warmWallet = getSystemWallet('warm');
    const hotWallet = getSystemWallet('hot');
    
    const hash = await this.transferUSDC(warmWallet, hotWallet.address, data.amount);
    
    await publishEvent('replinish:hot_wallet', {
      amount: data.amount,
      hash
    });
  }

  async handleWarmWalletSweepable(data: { amount: number }) {
    const warmWallet = getSystemWallet('warm');
    const coldWallet = getSystemWallet('cold');
    
    const hash = await this.transferUSDC(warmWallet, coldWallet.address, data.amount);
    
    await publishEvent('sweep:warm_wallet', {
      amount: data.amount,
      hash
    });
  }

  async handleWarmWalletInsufficient(data: { amount: number }) {
    const coldWallet = getSystemWallet('cold');
    const warmWallet = getSystemWallet('warm');
    
    const hash = await this.transferUSDC(coldWallet, warmWallet.address, data.amount);
    
    await publishEvent('replinish:warm_wallet', {
      amount: data.amount,
      hash
    });
  }

  async handleDepositWalletSweepable(data: { wallet: number, amount: number }) {
    const depositWallet = await db.select().from(wallets).where(eq(wallets.id, data.wallet)).limit(1);
    if (!depositWallet.length) return;

    const walletData = depositWallet[0];
    const decryptedKey = decryptWalletKey(walletData.encryptedKey);
    const warmWallet = getSystemWallet('warm');
    
    try {
      const fromWallet = { privateKey: decryptedKey };
      const hash = await this.transferUSDC(fromWallet, warmWallet.address, data.amount);
      
      await publishEvent('sweep:deposit_wallet', {
        wallet: data.wallet,
        amount: data.amount,
        hash
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Sweep Controller] Deposit wallet sweep failed for wallet ${data.wallet}:`, errorMessage);
      
      // Check if error is gas-related and emit gas:low event
      if (this.isGasRelatedError(error)) {
        console.log(`[Sweep Controller] Gas-related error detected for deposit wallet ${data.wallet}: ${errorMessage}`);
        console.log(`[Sweep Controller] Emitting gas:low event for deposit wallet ${data.wallet}`);
        
        await publishEvent('gas:low', {
          walletType: 'deposit',
          walletId: data.wallet,
          reason: 'sweep_failed'
        });
      }
      
      // Re-throw the error to be handled by the calling service
      throw error;
    }
  }

  async handleDepositWalletInsufficient(data: { wallet: number }) {
    await publishEvent('gas:low', {
      walletType: 'deposit',
      walletId: data.wallet
    });
  }

  async startUSDCMonitoring() {
    console.log('[Sweep Controller] Starting proactive USDC monitoring...');
    
    // Initial check on startup
    await this.checkAllSystemWallets();
    
    // Set up periodic monitoring every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAllSystemWallets();
      } catch (error) {
        console.error('[Sweep Controller] Error during periodic monitoring:', error);
      }
    }, 30000); // 30 seconds
    
    console.log('[Sweep Controller] USDC monitoring started - checking every 30 seconds');
  }

  async stopUSDCMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[Sweep Controller] USDC monitoring stopped');
    }
  }

  async checkAllSystemWallets() {
    try {
      await this.checkHotWalletUSDC();
      await this.checkWarmWalletUSDC();
      await this.checkColdWalletUSDC();
    } catch (error) {
      console.error('[Sweep Controller] Error checking system wallets:', error);
    }
  }

  async checkColdWalletUSDC() {
    const coldWallet = getSystemWallet('cold');
    const currentBalance = await this.getUSDCBalance(coldWallet.address);
    const currentUSDC = Number(currentBalance) / 1e6; // Convert to USDC
    
    // Get minimum threshold from environment (default 50000 USDC)
    const minThreshold = parseInt(process.env.COLD_WALLET_USDC_MIN_THRESHOLD || '50000');
    
    console.log(`[Sweep Controller] Monitoring COLD wallet USDC:`);
    console.log(`  Current: ${currentUSDC} USDC`);
    console.log(`  Min Threshold: ${minThreshold} USDC`);
    
    if (currentUSDC < minThreshold) {
      console.log(`  ⚠️  Cold wallet running low! Current: ${currentUSDC} USDC, Min: ${minThreshold} USDC`);
      console.log(`  🔔 Manual intervention may be required to refill cold wallet`);
      
      // Publish alert event for monitoring/alerting systems
      await publishEvent('cold_wallet:low', {
        currentBalance: currentUSDC,
        minThreshold: minThreshold,
        deficit: minThreshold - currentUSDC
      });
    } else {
      console.log(`  ✅ USDC sufficient`);
    }
  }

  async checkHotWalletUSDC() {
    const hotWallet = getSystemWallet('hot');
    const currentBalance = await this.getUSDCBalance(hotWallet.address);
    const currentUSDC = Number(currentBalance) / 1e6; // Convert to USDC
    
    // Get threshold from environment (default 1000 USDC)
    const threshold = parseInt(process.env.HOT_WALLET_USDC_THRESHOLD || '1000');
    
    console.log(`[Sweep Controller] Monitoring HOT wallet USDC:`);
    console.log(`  Current: ${currentUSDC} USDC`);
    console.log(`  Threshold: ${threshold} USDC`);
    
    if (currentUSDC < threshold) {
      console.log(`  🔥 Below threshold! Auto-replenishing from warm wallet...`);
      await this.replenishHotWalletUSDC(threshold - currentUSDC);
    } else {
      console.log(`  ✅ USDC sufficient`);
    }
  }

  async checkWarmWalletUSDC() {
    const warmWallet = getSystemWallet('warm');
    const currentBalance = await this.getUSDCBalance(warmWallet.address);
    const currentUSDC = Number(currentBalance) / 1e6; // Convert to USDC
    
    // Get threshold from environment (default 5000 USDC)
    const threshold = parseInt(process.env.WARM_WALLET_USDC_THRESHOLD || '5000');
    
    console.log(`[Sweep Controller] Monitoring WARM wallet USDC:`);
    console.log(`  Current: ${currentUSDC} USDC`);
    console.log(`  Threshold: ${threshold} USDC`);
    
    // Get max threshold from environment (default 10000 USDC)
    const maxThreshold = parseInt(process.env.WARM_WALLET_USDC_MAX_THRESHOLD || '10000');
    
    console.log(`  Max Threshold: ${maxThreshold} USDC`);
    
    if (currentUSDC < threshold) {
      console.log(`  🔥 Below threshold! Auto-replenishing from cold wallet...`);
      await this.replenishWarmWalletUSDC(threshold - currentUSDC);
    } else if (currentUSDC > maxThreshold) {
      console.log(`  📤 Above max threshold! Auto-sweeping to cold wallet...`);
      await this.sweepWarmWalletToCold(currentUSDC - maxThreshold);
    } else {
      console.log(`  ✅ USDC sufficient`);
    }
  }

  async replenishHotWalletUSDC(amount: number) {
    try {
      const warmWallet = getSystemWallet('warm');
      const hotWallet = getSystemWallet('hot');
      
      // Check if warm wallet has enough USDC
      const warmBalance = await this.getUSDCBalance(warmWallet.address);
      const warmUSDC = Number(warmBalance) / 1e6;
      
      if (warmUSDC < amount) {
        console.log(`[Sweep Controller] ❌ Warm wallet insufficient: has ${warmUSDC} USDC, needs ${amount} USDC`);
        return;
      }
      
      console.log(`[Sweep Controller] Auto-replenishing hot wallet with ${amount} USDC from warm wallet`);
      
      const hash = await this.transferUSDC(warmWallet, hotWallet.address, amount);
      
      await publishEvent('replinish:hot_wallet', {
        amount: amount,
        hash: hash,
        trigger: 'automatic-monitoring'
      });
      
      console.log(`[Sweep Controller] ✅ Hot wallet replenishment completed: ${hash}`);
      
    } catch (error) {
      console.error(`[Sweep Controller] ❌ Hot wallet replenishment failed:`, error);
    }
  }

  async replenishWarmWalletUSDC(amount: number) {
    try {
      const coldWallet = getSystemWallet('cold');
      const warmWallet = getSystemWallet('warm');
      
      // Check if cold wallet has enough USDC
      const coldBalance = await this.getUSDCBalance(coldWallet.address);
      const coldUSDC = Number(coldBalance) / 1e6;
      
      if (coldUSDC < amount) {
        console.log(`[Sweep Controller] ❌ Cold wallet insufficient: has ${coldUSDC} USDC, needs ${amount} USDC`);
        return;
      }
      
      console.log(`[Sweep Controller] Auto-replenishing warm wallet with ${amount} USDC from cold wallet`);
      
      const hash = await this.transferUSDC(coldWallet, warmWallet.address, amount);
      
      await publishEvent('replinish:warm_wallet', {
        amount: amount,
        hash: hash,
        trigger: 'automatic-monitoring'
      });
      
      console.log(`[Sweep Controller] ✅ Warm wallet replenishment completed: ${hash}`);
      
    } catch (error) {
      console.error(`[Sweep Controller] ❌ Warm wallet replenishment failed:`, error);
    }
  }

  async sweepWarmWalletToCold(amount: number) {
    try {
      const warmWallet = getSystemWallet('warm');
      const coldWallet = getSystemWallet('cold');
      
      // Check if warm wallet has enough USDC
      const warmBalance = await this.getUSDCBalance(warmWallet.address);
      const warmUSDC = Number(warmBalance) / 1e6;
      
      if (warmUSDC < amount) {
        console.log(`[Sweep Controller] ❌ Warm wallet insufficient: has ${warmUSDC} USDC, needs ${amount} USDC`);
        return;
      }
      
      console.log(`[Sweep Controller] Auto-sweeping ${amount} USDC from warm wallet to cold wallet`);
      
      const hash = await this.transferUSDC(warmWallet, coldWallet.address, amount);
      
      await publishEvent('sweep:warm_wallet', {
        amount: amount,
        hash: hash,
        trigger: 'automatic-monitoring'
      });
      
      console.log(`[Sweep Controller] ✅ Warm wallet sweep completed: ${hash}`);
      
    } catch (error) {
      console.error(`[Sweep Controller] ❌ Warm wallet sweep failed:`, error);
    }
  }
}

export const sweepController = new SweepController();