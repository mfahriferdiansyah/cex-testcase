# CEX Wallet Manager

A 3-tier wallet system for managing USDC deposits, withdrawals, and automatic fund sweeping on Arbitrum Sepolia testnet.

## Quick Start

**Prerequisites:** PostgreSQL, Redis, Node.js

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your wallet keys and RPC endpoint

# 3. Set up database and run migrations
npm run setup

# 4. Create test wallets
npm run create-wallets

# 5. Start services (run each in separate terminal)
npm run start:gas
npm run start:sweep
npm run start:withdrawal
```

**Important:** Replace the dummy keys in `.env` with real wallet addresses and private keys. Use `cast wallet new` to generate test wallets.

## Testing

Open the test menu:
```bash
npm test
```

**Key test scenarios:**
- Create wallets → Send deposits → Execute withdrawals
- Check balances after each step
- Monitor gas refills automatically happening

**Testing deposit flow:**
1. Use "Send USDC deposits" to send test funds
2. Watch services detect deposits and sweep funds
3. Try withdrawals to see money flow back

## System Flow

**3-Tier Wallet System:**
- **Deposit wallets** → **Warm wallet** → **Cold wallet**
- **Hot wallet** ← **Warm wallet** (for withdrawals)

**Money Flow:**
1. User deposits USDC → Deposit wallet
2. System sweeps → Warm wallet (when > 100 USDC)
3. Warm wallet sweeps → Cold wallet (when > 10,000 USDC)
4. Withdrawals pull from Hot wallet (kept at 1,000 USDC)

**Gas Management:**
- Automatic ETH refills when transactions fail
- Each wallet type has gas buffers (Hot: 10 tx, Warm: 5 tx, Deposit: 1 tx)

**Event System:**
- Services communicate via Redis pub/sub
- Reactive: operations trigger gas refills when needed
- Proactive: monitors balances every 30 seconds

## Troubleshooting

**Services won't start:**
- Check PostgreSQL and Redis are running
- Verify .env file exists with correct DATABASE_URL

**Deposits not sweeping:**
- Check if sweep service is running
- Verify deposit wallet has ETH for gas fees
- Look for gas:low events in logs

**Withdrawals failing:**
- Check hot wallet USDC balance
- Ensure hot wallet has ETH for gas
- Verify withdrawal service is processing queue

**Check balances:**
```bash
npm test
# Select "Check wallet balances"
```

**Monitor events:**
```bash
redis-cli psubscribe "*"
```

## Environment

Uses Mock USDC on Arbitrum Sepolia testnet. System wallets and settings are in `.env` file.

**Database:** `cex_wallet_manager`  
**Network:** Arbitrum Sepolia  
**Token:** Mock USDC (0xb6df7f56e1dff4073fd557500719a37232fc3337)