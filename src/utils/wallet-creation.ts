import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export class WalletUtils {
  private readonly key: Buffer;
  
  constructor() {
    const secret = process.env.WALLET_SECRET || 'default-secret';
    this.key = createHash('sha256').update(secret).digest();
  }

  create() {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    
    return {
      address: account.address,
      encryptedKey: this.encrypt(privateKey)
    };
  }

  getAccount(encryptedKey: string) {
    const privateKey = this.decrypt(encryptedKey);
    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = createDecipheriv('aes-256-cbc', this.key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}