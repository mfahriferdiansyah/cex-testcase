import inquirer from 'inquirer';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { DatabaseController } from '../database/controller';
import { createRedisSubscriber } from '../utils/redis-event';
import { startWithdrawalService } from '../service/withdrawal/index';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

enum MenuOption {
  // Wallet Management
  CREATE_WALLETS = 'create-wallets',
  LIST_WALLETS = 'list-wallets',
  CHECK_BALANCES = 'check-balances',
  
  // Send Transactions
  SEND_DEPOSITS = 'send-deposits',
  EXECUTE_WITHDRAWAL = 'execute-withdrawal',
  
  // Event Testing
  TRIGGER_GAS_LOW = 'trigger-gas-low',
  TRIGGER_DEPOSIT_SWEEP = 'trigger-deposit-sweep',
  MONITOR_REDIS = 'monitor-redis',
  
  // System
  CLEAR_SCREEN = 'clear',
  EXIT = 'exit'
}

interface WithdrawalResult {
  withdrawalId: number;
  walletId: number;
  amount: string;
  success: boolean;
  hash?: string;
  error?: string;
}

class TestingMenu {
  private isRunning = true;
  private dbController = new DatabaseController();
  private withdrawalResults: Map<number, WithdrawalResult> = new Map();

  async displayHeader() {
    console.clear();
    console.log('🚀 CEX Wallet Manager - Testing Menu');
    console.log('=====================================');
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log('=====================================\n');
  }

  async runCommand(command: string, args: string[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`\n🔄 Running: ${command} ${args.join(' ')}\n`);
      
      const child = spawn(command, args, { 
        stdio: 'inherit',
        shell: true 
      });
      
      child.on('close', (code) => {
        if (code !== 0) {
          console.log(`\n❌ Command exited with code ${code}`);
        }
        console.log('\n✅ Command completed. Press Enter to continue...');
        resolve();
      });
      
      child.on('error', (error) => {
        console.error(`\n❌ Error: ${error.message}`);
        resolve();
      });
    });
  }

  async runNpmScript(script: string): Promise<void> {
    await this.runCommand('npm', ['run', script]);
  }

  async waitForEnter() {
    await inquirer.prompt([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    }]);
  }

  async showMainMenu() {
    const choices = [
      new inquirer.Separator('=== 👛 Wallet Management ==='),
      { name: '1. Create test wallets', value: MenuOption.CREATE_WALLETS },
      { name: '2. List all wallets', value: MenuOption.LIST_WALLETS },
      { name: '3. Check wallet balances', value: MenuOption.CHECK_BALANCES },
      
      new inquirer.Separator('\n=== 💸 Send Transactions ==='),
      { name: '4. Send USDC deposits (interactive)', value: MenuOption.SEND_DEPOSITS },
      { name: '5. Execute withdrawals (interactive)', value: MenuOption.EXECUTE_WITHDRAWAL },
      
      new inquirer.Separator('\n=== 🔔 Event Testing ==='),
      { name: '6. Trigger gas:low event', value: MenuOption.TRIGGER_GAS_LOW },
      { name: '7. Trigger deposit sweep event', value: MenuOption.TRIGGER_DEPOSIT_SWEEP },
      { name: '8. Monitor Redis events', value: MenuOption.MONITOR_REDIS },
      
      new inquirer.Separator('\n=== 🔧 System ==='),
      { name: '9. Clear screen', value: MenuOption.CLEAR_SCREEN },
      { name: '10. Exit', value: MenuOption.EXIT }
    ];

    const answer = await inquirer.prompt([{
      type: 'list',
      name: 'option',
      message: 'Select an option:',
      choices,
      pageSize: 20
    }]);

    return answer.option;
  }

  async handleMenuOption(option: MenuOption) {
    switch (option) {
      // Wallet Management
      case MenuOption.CREATE_WALLETS:
        await this.runNpmScript('create-wallets');
        await this.waitForEnter();
        break;
        
      case MenuOption.LIST_WALLETS:
        await this.runNpmScript('test-helpers list-wallets');
        await this.waitForEnter();
        break;
        
      case MenuOption.CHECK_BALANCES:
        await this.runNpmScript('test-helpers balances');
        await this.waitForEnter();
        break;
      
      // Send Transactions
      case MenuOption.SEND_DEPOSITS:
        await this.runNpmScript('send-deposits');
        await this.waitForEnter();
        break;
        
      case MenuOption.EXECUTE_WITHDRAWAL:
        await this.executeWithdrawals();
        break;
      
      // Event Testing
      case MenuOption.TRIGGER_GAS_LOW:
        await this.triggerGasLow();
        break;
        
      case MenuOption.TRIGGER_DEPOSIT_SWEEP:
        await this.triggerDepositSweep();
        break;
        
      case MenuOption.MONITOR_REDIS:
        console.log('\n📡 Starting Redis monitor in new terminal...');
        console.log('Run this command in a new terminal:');
        console.log('\n   redis-cli psubscribe "*"\n');
        await this.waitForEnter();
        break;
      
      // System
      case MenuOption.CLEAR_SCREEN:
        console.clear();
        break;
        
      case MenuOption.EXIT:
        this.isRunning = false;
        break;
    }
  }

  async triggerGasLow() {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletType',
        message: 'Select wallet type:',
        choices: ['deposit', 'hot', 'warm', 'cold']
      },
      {
        type: 'input',
        name: 'walletId',
        message: 'Enter wallet ID (for deposit wallets only, leave empty for others):',
        when: (answers) => answers.walletType === 'deposit'
      }
    ]);

    const cmd = answer.walletId 
      ? `test-helpers trigger-gas-low ${answer.walletType} ${answer.walletId}`
      : `test-helpers trigger-gas-low ${answer.walletType}`;
    
    await this.runNpmScript(cmd);
    await this.waitForEnter();
  }

  async triggerDepositSweep() {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'walletId',
        message: 'Enter wallet ID:',
        validate: (input) => !isNaN(parseInt(input)) || 'Please enter a valid number'
      },
      {
        type: 'input',
        name: 'amount',
        message: 'Enter amount (USDC):',
        default: '100',
        validate: (input) => !isNaN(parseFloat(input)) || 'Please enter a valid number'
      }
    ]);

    await this.runNpmScript(`test-helpers trigger-sweep ${answer.walletId} ${answer.amount}`);
    await this.waitForEnter();
  }


  async monitorWithdrawalEvents(withdrawalIds: number[]): Promise<void> {
    const subscriber = await createRedisSubscriber();
    
    return new Promise((resolve, reject) => {
      let completedCount = 0;
      const totalWithdrawals = withdrawalIds.length;
      
      const handleMessage = async (message: string, channel: string) => {
        try {
          const data = JSON.parse(message);
          const withdrawalId = data.withdrawalId;
          
          if (withdrawalIds.includes(withdrawalId)) {
            const result = this.withdrawalResults.get(withdrawalId);
            if (result) {
              if (channel === 'withdrawal:success') {
                result.success = true;
                result.hash = data.hash;
                console.log(`   ✅ Withdrawal ${withdrawalId} completed: ${data.hash}`);
              } else if (channel === 'withdrawal:failed') {
                result.success = false;
                result.error = data.error;
                console.log(`   ❌ Withdrawal ${withdrawalId} failed: ${data.error}`);
              }
              
              completedCount++;
              console.log(`   📊 Progress: ${completedCount}/${totalWithdrawals} withdrawals completed`);
              
              if (completedCount === totalWithdrawals) {
                await subscriber.quit();
                resolve();
              }
            }
          }
        } catch (error) {
          console.error('Error processing withdrawal event:', error);
        }
      };
      
      subscriber.subscribe('withdrawal:success', handleMessage);
      subscriber.subscribe('withdrawal:failed', handleMessage);
      
      // Timeout after 5 minutes
      setTimeout(async () => {
        await subscriber.quit();
        reject(new Error('Withdrawal monitoring timeout'));
      }, 300000);
    });
  }

  async executeWithdrawals() {
    console.log('\n💸 Execute Withdrawals\n');
    
    // Get all wallets
    const wallets = await this.dbController.getAllWallets();
    if (wallets.length === 0) {
      console.log('❌ No wallets found. Create wallets first.');
      await this.waitForEnter();
      return;
    }
    
    // Create wallet options with balance info
    const walletOptions = [];
    for (const wallet of wallets) {
      const dbBalance = await this.dbController.getWalletBalance(wallet.id);
      const availableBalance = await this.dbController.getAvailableBalance(wallet.id);
      
      walletOptions.push({
        name: `Wallet ${wallet.id} (${wallet.address}) - DB Balance: ${dbBalance} USDC | Available: ${availableBalance} USDC`,
        value: {
          id: wallet.id,
          address: wallet.address,
          dbBalance: dbBalance,
          availableBalance: availableBalance
        }
      });
    }
    
    // Interactive prompts
    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedWallets',
        message: 'Select wallets to create withdrawals for (use space to select):',
        choices: walletOptions,
        validate: (answer) => {
          if (answer.length === 0) {
            return 'Please select at least one wallet';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'withdrawalAddress',
        message: 'Enter withdrawal address (or press Enter for default):',
        default: process.env.MASTER_SOURCE_ADDRESS || '',
        validate: (input) => {
          if (!input.trim()) {
            return 'Please provide a withdrawal address';
          }
          if (!input.startsWith('0x') || input.length !== 42) {
            return 'Please provide a valid Ethereum address';
          }
          return true;
        }
      }
    ]);
    
    const selectedWallets = answers.selectedWallets;
    const withdrawalAddress = answers.withdrawalAddress;
    
    console.log(`\n📋 Withdrawal Setup:`);
    console.log(`   Withdrawal Address: ${withdrawalAddress}`);
    console.log(`   Selected Wallets: ${selectedWallets.length}`);
    
    // Get withdrawal amounts for each wallet
    const withdrawalRequests = [];
    for (const wallet of selectedWallets) {
      const amountAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'amount',
          message: `Enter withdrawal amount for Wallet ${wallet.id} (Available: ${wallet.availableBalance} USDC):`,
          validate: (input) => {
            const num = parseFloat(input);
            if (isNaN(num) || num <= 0) {
              return 'Please enter a valid positive number';
            }
            return true;
          }
        }
      ]);
      
      withdrawalRequests.push({
        walletId: wallet.id,
        address: wallet.address,
        amount: amountAnswer.amount,
        availableBalance: wallet.availableBalance
      });
    }
    
    // Show summary
    console.log(`\n📊 Withdrawal Summary:`);
    withdrawalRequests.forEach((req, index) => {
      const willSucceed = parseFloat(req.amount) <= parseFloat(req.availableBalance);
      const status = willSucceed ? '✅ Should succeed' : '❌ Insufficient balance';
      console.log(`   ${index + 1}. Wallet ${req.walletId}: ${req.amount} USDC ${status}`);
    });
    
    const confirmation = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed with creating withdrawal requests?',
        default: false
      }
    ]);
    
    if (!confirmation.proceed) {
      console.log('❌ Withdrawal creation cancelled');
      await this.waitForEnter();
      return;
    }
    
    // Execute withdrawal requests
    console.log('\n🔄 Creating withdrawal requests...');
    const results = [];
    const withdrawalIds: number[] = [];
    
    for (const req of withdrawalRequests) {
      try {
        console.log(`\n📤 Creating withdrawal for Wallet ${req.walletId}: ${req.amount} USDC`);
        
        const withdrawal = await this.dbController.createWithdrawalQueue(
          req.walletId,
          req.amount,
          withdrawalAddress
        );
        
        console.log(`   ✅ Withdrawal created: ID ${withdrawal.id}`);
        withdrawalIds.push(withdrawal.id);
        
        // Initialize withdrawal result tracking
        this.withdrawalResults.set(withdrawal.id, {
          withdrawalId: withdrawal.id,
          walletId: req.walletId,
          amount: req.amount,
          success: false
        });
        
        results.push({
          walletId: req.walletId,
          withdrawalId: withdrawal.id,
          amount: req.amount,
          success: true
        });
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`   ❌ Failed: ${errorMessage}`);
        results.push({
          walletId: req.walletId,
          amount: req.amount,
          error: errorMessage,
          success: false
        });
      }
    }
    
    // Results summary
    console.log('\n📊 Withdrawal Creation Results:');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`   ✅ Successfully created: ${successful.length}`);
    console.log(`   ❌ Failed: ${failed.length}`);
    
    if (successful.length > 0) {
      console.log('\n✅ Successfully created withdrawals:');
      successful.forEach(r => {
        console.log(`   - Wallet ${r.walletId}: ${r.amount} USDC (Withdrawal ID: ${r.withdrawalId})`);
      });
    }
    
    if (failed.length > 0) {
      console.log('\n❌ Failed withdrawals:');
      failed.forEach(r => {
        console.log(`   - Wallet ${r.walletId}: ${r.amount} USDC - ${r.error}`);
      });
    }
    
    if (successful.length === 0) {
      console.log('\n❌ No withdrawals created successfully. Nothing to monitor.');
      await this.waitForEnter();
      return;
    }

    // Start monitoring phase
    console.log('\n🔄 Starting withdrawal processing...');
    console.log('Starting withdrawal service and monitoring for confirmations...');
    
    try {
      // Start withdrawal service in background
      console.log('   📡 Starting withdrawal service...');
      const withdrawalServicePromise = startWithdrawalService();
      
      // Give service time to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Start monitoring withdrawal events
      console.log('   👀 Monitoring withdrawal events...');
      console.log('   ⏳ Waiting for transaction confirmations...\n');
      
      await this.monitorWithdrawalEvents(withdrawalIds);
      
      // Display final results
      console.log('\n🎯 Final Withdrawal Results:');
      console.log('=====================================');
      
      const successfulWithdrawals = Array.from(this.withdrawalResults.values()).filter(r => r.success);
      const failedWithdrawals = Array.from(this.withdrawalResults.values()).filter(r => !r.success);
      
      console.log(`✅ Successful: ${successfulWithdrawals.length}`);
      console.log(`❌ Failed: ${failedWithdrawals.length}\n`);
      
      if (successfulWithdrawals.length > 0) {
        console.log('✅ Successful withdrawals:');
        successfulWithdrawals.forEach(r => {
          console.log(`   - Wallet ${r.walletId}: ${r.amount} USDC`);
          console.log(`     Transaction: ${r.hash}`);
          console.log(`     Explorer: https://sepolia.arbiscan.io/tx/${r.hash}`);
        });
      }
      
      if (failedWithdrawals.length > 0) {
        console.log('\n❌ Failed withdrawals:');
        failedWithdrawals.forEach(r => {
          console.log(`   - Wallet ${r.walletId}: ${r.amount} USDC`);
          console.log(`     Error: ${r.error}`);
        });
      }
      
      // Clear results for next run
      this.withdrawalResults.clear();
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('\n❌ Error during withdrawal monitoring:', errorMessage);
    }
    
    await this.waitForEnter();
  }

  async run() {
    while (this.isRunning) {
      await this.displayHeader();
      const option = await this.showMainMenu();
      await this.handleMenuOption(option);
    }
    
    console.log('\n👋 Goodbye! Happy testing!\n');
    process.exit(0);
  }
}

async function main() {
  const menu = new TestingMenu();
  await menu.run();
}

main().catch(console.error);