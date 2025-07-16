import { createDecipheriv, createHash } from 'crypto';

export type WalletType = 'hot' | 'warm' | 'cold' | 'gas';

export interface SystemWallet {
  address: string;
  privateKey: string;
  gasBuffer: number;
}

export function getSystemWallet(type: WalletType): SystemWallet {
  const address = process.env[`${type.toUpperCase()}_WALLET_ADDRESS`];
  const privateKey = process.env[`${type.toUpperCase()}_WALLET_PRIVATE_KEY`];
  const gasBuffer = type === 'gas' ? 0 : parseInt(process.env[`${type.toUpperCase()}_WALLET_GAS_BUFFER`] || '0');

  if (!address || !privateKey) {
    throw new Error(`Missing ${type} wallet environment variables`);
  }

  return {
    address,
    privateKey,
    gasBuffer
  };
}

export function getDepositWalletGasBuffer(): number {
  return parseInt(process.env.DEPOSIT_WALLET_GAS_BUFFER || '1');
}

export function decryptWalletKey(encryptedKey: string): string {
  const algorithm = 'aes-256-cbc';
  const secret = process.env.WALLET_SECRET!;
  const key = createHash('sha256').update(secret).digest();
  const [iv, encrypted] = encryptedKey.split(':');
  const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}