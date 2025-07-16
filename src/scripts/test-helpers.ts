import { createPublicClient, http, formatUnits } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { DatabaseController } from '../database/controller';
import { getSystemWallet } from '../utils/wallet-helper';
import { usdcAbi } from '../utils/usdc-helper';
import { publishEvent } from '../utils/redis-event';
import dotenv from 'dotenv';

dotenv.config();

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
});

async function checkWalletBalances() {
  console.log('🔍 Checking wallet balances...\n');
  
  const dbController = new DatabaseController();
  
  // Check system wallets
  const systemWallets = ['hot', 'warm', 'cold', 'gas'] as const;
  
  for (const walletType of systemWallets) {
    const wallet = getSystemWallet(walletType);
    
    const ethBalance = await publicClient.getBalance({ 
      address: wallet.address as `0x${string}` 
    });
    
    const usdcBalance = await publicClient.readContract({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [wallet.address as `0x${string}`]
    });
    
    console.log(`${walletType.toUpperCase()} WALLET (${wallet.address}):`);
    console.log(`  ETH: ${formatUnits(ethBalance, 18)} ETH`);
    console.log(`  USDC: ${formatUnits(usdcBalance, 6)} USDC`);
    console.log(`  Gas Buffer: ${wallet.gasBuffer} transactions`);
    console.log('');
  }
  
  // Check deposit wallets from database
  const depositWallets = await dbController.getWithdrawalQueueByStatus('processing');
  // Get all wallets from database
  const allWallets = await dbController.getAllWallets();
  
  if (allWallets.length > 0) {
    console.log('DEPOSIT WALLETS:');
    
    for (const wallet of allWallets) {
      const ethBalance = await publicClient.getBalance({ 
        address: wallet.address as `0x${string}` 
      });
      
      const usdcBalance = await publicClient.readContract({
        address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [wallet.address as `0x${string}`]
      });
      
      const dbBalance = await dbController.getWalletBalance(wallet.id);
      const availableBalance = await dbController.getAvailableBalance(wallet.id);
      
      console.log(`  Wallet ${wallet.id} (${wallet.address}):`);
      console.log(`    ETH: ${formatUnits(ethBalance, 18)} ETH`);
      console.log(`    USDC (Blockchain): ${formatUnits(usdcBalance, 6)} USDC`);
      console.log(`    USDC (Database): ${dbBalance} USDC`);
      console.log(`    Available Balance: ${availableBalance} USDC`);
      console.log(`    Frozen: ${wallet.frozen}`);
      console.log('');
    }
  } else {
    console.log('❌ No deposit wallets found in database');
    console.log('   Run: npm run create-wallets');
  }
}

async function listDepositWallets() {
  console.log('📋 Listing deposit wallets from database...\n');
  
  const dbController = new DatabaseController();
  const wallets = await dbController.getAllWallets();
  
  if (wallets.length === 0) {
    console.log('❌ No deposit wallets found');
    console.log('   Run: npm run create-wallets');
    return;
  }
  
  console.log('Deposit Wallets:');
  wallets.forEach((wallet, index) => {
    console.log(`${index + 1}. ID: ${wallet.id} | Address: ${wallet.address} | Frozen: ${wallet.frozen}`);
  });
}

async function addTestWithdrawal(walletId: number, amount: string, toAddress: string) {
  console.log('💸 Adding test withdrawal to queue...\n');
  
  const dbController = new DatabaseController();
  
  const withdrawal = await dbController.createWithdrawalQueue(walletId, amount, toAddress);
  
  console.log('✅ Test withdrawal added:');
  console.log(`  ID: ${withdrawal.id}`);
  console.log(`  Wallet ID: ${withdrawal.walletId}`);
  console.log(`  Amount: ${withdrawal.amount} USDC`);
  console.log(`  To Address: ${withdrawal.toAddress}`);
  console.log(`  Status: ${withdrawal.status}`);
  console.log(`  Created: ${withdrawal.createdAt}`);
}

async function triggerGasLowEvent(walletType: string, walletId?: number) {
  console.log(`🔥 Triggering gas:low event for ${walletType}...\n`);
  
  const eventData = walletId ? 
    { walletType, walletId } : 
    { walletType };
  
  await publishEvent('gas:low', eventData);
  
  console.log('✅ gas:low event triggered');
  console.log('   Check gas service logs for processing');
}

async function triggerDepositSweep(walletId: number, amount: number) {
  console.log(`🧹 Triggering deposit sweep for wallet ${walletId}...\n`);
  
  await publishEvent('deposit_wallet:sweepable', {
    wallet: walletId,
    amount
  });
  
  console.log('✅ deposit_wallet:sweepable event triggered');
  console.log('   Check sweep service logs for processing');
}

// CLI interface
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'balances':
      await checkWalletBalances();
      break;
      
    case 'list-wallets':
      await listDepositWallets();
      break;
      
    case 'add-withdrawal':
      const walletId = parseInt(process.argv[3]);
      const amount = process.argv[4];
      const toAddress = process.argv[5];
      
      if (!walletId || !amount || !toAddress) {
        console.log('Usage: npm run test-helpers add-withdrawal <walletId> <amount> <toAddress>');
        process.exit(1);
      }
      
      await addTestWithdrawal(walletId, amount, toAddress);
      break;
      
    case 'trigger-gas-low':
      const walletType = process.argv[3];
      const targetWalletId = process.argv[4] ? parseInt(process.argv[4]) : undefined;
      
      if (!walletType) {
        console.log('Usage: npm run test-helpers trigger-gas-low <walletType> [walletId]');
        console.log('  walletType: hot|warm|cold|deposit');
        process.exit(1);
      }
      
      await triggerGasLowEvent(walletType, targetWalletId);
      break;
      
    case 'trigger-sweep':
      const sweepWalletId = parseInt(process.argv[3]);
      const sweepAmount = parseInt(process.argv[4]);
      
      if (!sweepWalletId || !sweepAmount) {
        console.log('Usage: npm run test-helpers trigger-sweep <walletId> <amount>');
        process.exit(1);
      }
      
      await triggerDepositSweep(sweepWalletId, sweepAmount);
      break;
      
    default:
      console.log('🛠️  CEX Wallet Manager - Test Helpers\n');
      console.log('Available commands:');
      console.log('  balances          - Check ETH and USDC balances for all wallets');
      console.log('  list-wallets      - List all deposit wallets from database');
      console.log('  add-withdrawal    - Add test withdrawal to queue');
      console.log('  trigger-gas-low   - Manually trigger gas:low event');
      console.log('  trigger-sweep     - Manually trigger deposit sweep event');
      console.log('');
      console.log('Examples:');
      console.log('  npm run test-helpers balances');
      console.log('  npm run test-helpers list-wallets');
      console.log('  npm run test-helpers add-withdrawal 1 100 0x1234...');
      console.log('  npm run test-helpers trigger-gas-low deposit 1');
      console.log('  npm run test-helpers trigger-sweep 1 100');
      break;
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});