import { pgTable, serial, text, timestamp, boolean, integer, decimal } from 'drizzle-orm/pg-core';

export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  address: text('address').notNull().unique(),
  frozen: boolean('frozen').default(false),
  encryptedKey: text('encrypted_key').notNull(),
  balance: decimal('balance', { precision: 18, scale: 6 }).default('0'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const withdrawalQueue = pgTable('withdrawal_queue', {
  id: serial('id').primaryKey(),
  walletId: integer('wallet_id').references(() => wallets.id),
  amount: text('amount').notNull(),
  toAddress: text('to_address').notNull(),
  status: text('status').notNull().default('processing'),
  createdAt: timestamp('created_at').defaultNow(),
  processedAt: timestamp('processed_at'),
});