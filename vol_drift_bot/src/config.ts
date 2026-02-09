import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { EnvConfig } from './types';

dotenv.config();

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  return value.toLowerCase() === 'true';
}

export function loadEnvConfig(): EnvConfig {
  const solanaRpcUrl = process.env.SOLANA_RPC_URL;
  const keypairPath = process.env.KEYPAIR_PATH;
  if (!solanaRpcUrl) {
    throw new Error('SOLANA_RPC_URL is required');
  }
  if (!keypairPath) {
    throw new Error('KEYPAIR_PATH is required');
  }
  if (!fs.existsSync(path.resolve(keypairPath))) {
    throw new Error(`Keypair file not found at ${keypairPath}`);
  }

  return {
    solanaRpcUrl,
    keypairPath,
    driftEnv: process.env.DRIFT_ENV ?? 'mainnet-beta',
    subaccountId: parseNumber(process.env.SUBACCOUNT_ID, 0),
    maxNotionalUsdc: parseNumber(process.env.MAX_NOTIONAL_USDC, 10),
    maxLeverage: parseNumber(process.env.MAX_LEVERAGE, 3),
    dryRun: parseBool(process.env.DRY_RUN, true),
    binanceIntervals: (process.env.BINANCE_INTERVALS ?? '4h')
      .split(',')
      .map((interval) => interval.trim())
      .filter(Boolean),
  };
}
