import { WalletUtils } from '../utils/wallet-creation';
import { DatabaseController } from '../database/controller';
import dotenv from 'dotenv';

dotenv.config();

async function createTestWallets() {
  const walletUtils = new WalletUtils();
  const dbController = new DatabaseController();
  
  console.log('Creating 5 test deposit wallets...\n');
  
  const wallets = [];
  
  for (let i = 1; i <= 5; i++) {
    const wallet = walletUtils.create();
    
    const dbWallet = await dbController.createWallet(
      wallet.address.toLowerCase(),
      wallet.encryptedKey
    );
    
    wallets.push({
      id: dbWallet.id,
      address: wallet.address,
      encryptedKey: wallet.encryptedKey
    });
    
    console.log(`Wallet ${i}:`);
    console.log(`  ID: ${dbWallet.id}`);
    console.log(`  Address: ${wallet.address}`);
    console.log(`  Created at: ${dbWallet.createdAt}`);
    console.log('');
  }
  
  console.log('✅ Successfully created 5 test deposit wallets!');
  console.log('\n📋 Summary:');
  console.log('Wallet Addresses for Manual Testing:');
  wallets.forEach((wallet, index) => {
    console.log(`${index + 1}. ${wallet.address}`);
  });
  
  console.log('\n🔥 Next Steps:');
  console.log('1. Send test USDC to these addresses');
  console.log('2. Start withdrawal service to monitor deposits');
  console.log('3. Check deposit detection and gas refill events');
  
  process.exit(0);
}

createTestWallets().catch((error) => {
  console.error('❌ Error creating test wallets:', error);
  process.exit(1);
});