import fs from 'fs';
import path from 'path';
import {
  BASE_PRECISION,
  BN,
  DriftClient,
  DriftEnv,
  MarketType,
  OptionalOrderParams,
  OrderType,
  PositionDirection,
  QUOTE_PRECISION,
  User,
  Wallet,
  convertToNumber,
} from '@drift-labs/sdk';
import { Connection, Keypair, Commitment } from '@solana/web3.js';
import { EnvConfig, DriftStateSummary } from './types';

const SOL_PERP_INDEX = 0;

export interface DriftContext {
  client: DriftClient;
  user: User;
}

function loadKeypair(keypairPath: string): Keypair {
  const resolved = path.isAbsolute(keypairPath)
    ? keypairPath
    : path.resolve(process.cwd(), keypairPath);
  const keypairData = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

export async function createDriftContext(env: EnvConfig): Promise<DriftContext> {
  const keypair = loadKeypair(env.keypairPath);
  const wallet = new Wallet(keypair);
  const connection = new Connection(env.solanaRpcUrl, {
    commitment: 'confirmed' as Commitment,
  });
  const client = new DriftClient({
    connection,
    wallet,
    env: env.driftEnv as DriftEnv,
    subAccountIds: [env.subaccountId],
    activeSubAccountId: env.subaccountId,
    accountSubscription: {
      type: 'websocket',
      commitment: 'confirmed',
    },
  });
  await client.subscribe();
  const user = client.getUser(env.subaccountId);
  await user.subscribe();
  return { client, user };
}

export async function closeDriftContext(ctx: DriftContext): Promise<void> {
  await ctx.user.unsubscribe();
  await ctx.client.unsubscribe();
}

export function getStateSummary(ctx: DriftContext): DriftStateSummary {
  const totalCollateral = convertToNumber(
    ctx.user.getTotalCollateral(),
    QUOTE_PRECISION
  );
  const freeCollateral = convertToNumber(
    ctx.user.getFreeCollateral(),
    QUOTE_PRECISION
  );
  const perpPosition = ctx.user.getPerpPosition(SOL_PERP_INDEX);
  const solPerpBase = perpPosition
    ? convertToNumber(perpPosition.baseAssetAmount, BASE_PRECISION)
    : 0;
  return { totalCollateral, freeCollateral, solPerpBase };
}

function toBaseAmount(value: number): BN {
  return new BN(Math.round(value * 1e9));
}

export async function submitPerpOrder(
  ctx: DriftContext,
  baseChange: number
): Promise<string> {
  if (baseChange === 0) {
    throw new Error('No base change requested');
  }
  const direction = baseChange > 0 ? PositionDirection.LONG : PositionDirection.SHORT;
  const baseAssetAmount = toBaseAmount(Math.abs(baseChange));
  if (baseAssetAmount.eqn(0)) {
    throw new Error('Requested size is below 1 lot');
  }
  const orderParams: OptionalOrderParams = {
    orderType: OrderType.MARKET,
    marketIndex: SOL_PERP_INDEX,
    baseAssetAmount,
    direction,
    reduceOnly: false,
    marketType: MarketType.PERP,
  } as const;
  return ctx.client.placePerpOrder(orderParams, undefined, ctx.client.activeSubAccountId);
}
