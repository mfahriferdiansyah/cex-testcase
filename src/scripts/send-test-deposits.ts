import inquirer from 'inquirer';
import { createWalletClient, createPublicClient, http, formatUnits } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { DatabaseController } from '../database/controller';
import { usdcAbi, parseUSDCNumber } from '../utils/usdc-helper';
import dotenv from 'dotenv';

dotenv.config();

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
});

interface WalletOption {
  name: string;
  value: {
    id: number;
    address: string;
    ethBalance: string;
    usdcBalance: string;
  };
}

class DepositSender {
  private dbController: DatabaseController;
  private masterAccount: any;
  private walletClient: any;

  constructor() {
    this.dbController = new DatabaseController();
    
    if (!process.env.MASTER_SOURCE_PRIVATE_KEY) {
      throw new Error('MASTER_SOURCE_PRIVATE_KEY not found in environment variables');
    }
    
    this.masterAccount = privateKeyToAccount(process.env.MASTER_SOURCE_PRIVATE_KEY as `0x${string}`);
    
    this.walletClient = createWalletClient({
      account: this.masterAccount,
      chain: arbitrumSepolia,
      transport: http(process.env.ARBITRUM_SEPOLIA_RPC)
    });
  }

  async getMasterBalance(): Promise<{ eth: string; usdc: string }> {
    const ethBalance = await publicClient.getBalance({ 
      address: this.masterAccount.address 
    });
    
    const usdcBalance = await publicClient.readContract({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [this.masterAccount.address]
    });
    
    return {
      eth: formatUnits(ethBalance, 18),
      usdc: formatUnits(usdcBalance, 6)
    };
  }

  async getWalletBalances(): Promise<WalletOption[]> {
    const wallets = await this.dbController.getAllWallets();
    const options: WalletOption[] = [];
    
    for (const wallet of wallets) {
      const ethBalance = await publicClient.getBalance({ 
        address: wallet.address as `0x${string}` 
      });
      
      const usdcBalance = await publicClient.readContract({
        address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [wallet.address as `0x${string}`]
      });
      
      options.push({
        name: `Wallet ${wallet.id} (${wallet.address}) - ETH: ${formatUnits(ethBalance, 18)} | USDC: ${formatUnits(usdcBalance, 6)}`,
        value: {
          id: wallet.id,
          address: wallet.address,
          ethBalance: formatUnits(ethBalance, 18),
          usdcBalance: formatUnits(usdcBalance, 6)
        }
      });
    }
    
    return options;
  }

  async sendUSDC(toAddress: string, amount: number): Promise<string> {
    const hash = await this.walletClient.writeContract({
      address: process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, parseUSDCNumber(amount)]
    });
    
    return hash;
  }

  async run() {
    console.log('🚀 USDC Deposit Testing Tool\n');
    
    // Check master wallet balance
    try {
      const masterBalance = await this.getMasterBalance();
      console.log(`💰 Master Wallet Balance:`);
      console.log(`   Address: ${this.masterAccount.address}`);
      console.log(`   ETH: ${masterBalance.eth} ETH`);
      console.log(`   USDC: ${masterBalance.usdc} USDC\n`);
      
      if (parseFloat(masterBalance.usdc) < 100) {
        console.log('❌ Master wallet has insufficient USDC for testing (need at least 100 USDC)');
        return;
      }
    } catch (error) {
      console.error('❌ Error checking master wallet balance:', error);
      return;
    }
    
    // Get wallet options
    console.log('🔍 Loading deposit wallets...');
    const walletOptions = await this.getWalletBalances();
    
    if (walletOptions.length === 0) {
      console.log('❌ No deposit wallets found. Run: npm run create-wallets');
      return;
    }
    
    console.log(`✅ Found ${walletOptions.length} deposit wallets\n`);
    
    // Interactive prompts
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'amount',
        message: 'Enter USDC amount to send:',
        default: '100',
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) {
            return 'Please enter a valid positive number';
          }
          return true;
        }
      },
      {
        type: 'checkbox',
        name: 'selectedWallets',
        message: 'Select deposit wallets to send USDC to (use space to select):',
        choices: walletOptions,
        validate: (answer) => {
          if (answer.length === 0) {
            return 'Please select at least one wallet';
          }
          return true;
        }
      }
    ]);
    
    const amount = parseFloat(answers.amount);
    const selectedWallets = answers.selectedWallets;
    const totalAmount = amount * selectedWallets.length;
    
    console.log(`\n📋 Transaction Summary:`);
    console.log(`   Amount per wallet: ${amount} USDC`);
    console.log(`   Number of wallets: ${selectedWallets.length}`);
    console.log(`   Total amount: ${totalAmount} USDC`);
    console.log(`   Selected wallets:`);
    selectedWallets.forEach((wallet: any, index: number) => {
      console.log(`     ${index + 1}. ${wallet.address} (ID: ${wallet.id})`);
    });
    
    const confirmation = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed with sending USDC?',
        default: false
      }
    ]);
    
    if (!confirmation.proceed) {
      console.log('❌ Transaction cancelled');
      return;
    }
    
    // Send transactions
    console.log('\n🔄 Sending USDC transactions...');
    const results = [];
    
    for (let i = 0; i < selectedWallets.length; i++) {
      const wallet = selectedWallets[i];
      
      try {
        console.log(`\n📤 Sending ${amount} USDC to wallet ${wallet.id} (${wallet.address})`);
        
        const hash = await this.sendUSDC(wallet.address, amount);
        
        console.log(`   ✅ Transaction sent: ${hash}`);
        console.log(`   🔍 View on explorer: https://sepolia.arbiscan.io/tx/${hash}`);
        
        results.push({
          wallet: wallet,
          hash: hash,
          success: true
        });
        
        // Wait a bit between transactions
        if (i < selectedWallets.length - 1) {
          console.log('   ⏳ Waiting 2 seconds before next transaction...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`   ❌ Transaction failed: ${error}`);
        results.push({
          wallet: wallet,
          error: error,
          success: false
        });
      }
    }
    
    // Summary
    console.log('\n📊 Transaction Results:');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`   ✅ Successful: ${successful.length}`);
    console.log(`   ❌ Failed: ${failed.length}`);
    
    if (successful.length > 0) {
      console.log('\n🎉 Success! USDC deposits sent successfully.');
      console.log('\n🔥 Next steps:');
      console.log('   1. Start withdrawal service: npm run start:withdrawal');
      console.log('   2. Monitor Redis events: redis-cli psubscribe "*"');
      console.log('   3. Watch for deposit detection and events');
    }
    
    if (failed.length > 0) {
      console.log('\n❌ Some transactions failed. Check the errors above.');
    }
  }
}

async function main() {
  try {
    const sender = new DepositSender();
    await sender.run();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);