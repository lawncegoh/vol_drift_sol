import { loadEnvConfig } from './config';
import { fetchIntervalMap } from './binance';
import { appendLog } from './logger';
import {
  buildStrategyConfig,
  evaluateStrategy,
  summarizeSignal,
} from './strategy';
import {
  DriftStateSummary,
  EnvConfig,
  SignalSummary,
  TradeDecision,
} from './types';
import {
  createDriftContext,
  closeDriftContext,
  getStateSummary,
  submitPerpOrder,
} from './drift';

const MIN_TRADE_BASE = 0.01;

function clamp(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

async function computeSignal(env: EnvConfig): Promise<SignalSummary> {
  if (env.binanceIntervals.length === 0) {
    throw new Error('BINANCE_INTERVALS must include at least one interval');
  }
  const strategyConfig = buildStrategyConfig(env.maxLeverage);
  strategyConfig.intervals = env.binanceIntervals;
  const candlesMap = await fetchIntervalMap(strategyConfig.intervals, strategyConfig.limit);
  const primaryInterval = strategyConfig.intervals[0];
  const candles = candlesMap[primaryInterval];
  if (!candles || candles.length === 0) {
    throw new Error(`No candles returned for ${primaryInterval}`);
  }
  const result = evaluateStrategy(candles, strategyConfig);
  const summary = summarizeSignal(result, env.maxNotionalUsdc);
  appendLog({
    command: 'signal_eval',
    interval: primaryInterval,
    extraIntervals: Object.keys(candlesMap),
    signal: summary,
  });
  return summary;
}

function printSignal(signal: SignalSummary, envMaxNotional: number): void {
  console.log(`Signal Time: ${new Date(signal.timestamp).toISOString()}`);
  console.log(
    `Status: ${signal.status} | target leverage ${signal.targetLeverage.toFixed(2)} | target base ${signal.targetBase.toFixed(4)} SOL`
  );
  const rvValue = signal.rv !== undefined ? signal.rv.toFixed(4) : 'n/a';
  const rvZ = signal.rvZ !== undefined ? signal.rvZ.toFixed(2) : 'n/a';
  const rvPct =
    signal.rvPct !== undefined ? `${(signal.rvPct * 100).toFixed(1)}%` : 'n/a';
  console.log(
    `Price: ${signal.price.toFixed(3)} | RV ${rvValue} | rv_z ${rvZ} | rv_pct ${rvPct}`
  );
  console.log(
    `quiet ${signal.quietCondition} | burst ${signal.burstCondition} | breakout ${signal.breakoutDirection}`
  );
  console.log(
    `Cooldown remaining: ${signal.cooldownRemaining} | Bars in position: ${signal.barsInPosition}`
  );
  console.log(`Max notional: ${envMaxNotional.toFixed(2)} USDC`);
  console.log(`Reasoning: ${signal.reasoning.join(', ')}`);
}

async function handleState(): Promise<void> {
  const env = loadEnvConfig();
  const ctx = await createDriftContext(env);
  try {
    const summary = getStateSummary(ctx);
    printState(summary);
    appendLog({ command: 'state', summary });
  } finally {
    await closeDriftContext(ctx);
  }
}

function printState(summary: DriftStateSummary): void {
  console.log(`Total collateral: ${summary.totalCollateral.toFixed(3)} USDC`);
  console.log(`Free collateral: ${summary.freeCollateral.toFixed(3)} USDC`);
  console.log(`SOL-PERP base: ${summary.solPerpBase.toFixed(4)} SOL`);
}

async function handleSignal(): Promise<void> {
  const env = loadEnvConfig();
  const signal = await computeSignal(env);
  printSignal(signal, env.maxNotionalUsdc);
}

async function handleTrade(): Promise<void> {
  const env = loadEnvConfig();
  const signal = await computeSignal(env);
  const ctx = await createDriftContext(env);
  try {
    const state = getStateSummary(ctx);
    const desiredBase = signal.targetBase;
    const deltaBase = desiredBase - state.solPerpBase;
    const maxBasePerTrade = signal.price > 0 ? env.maxNotionalUsdc / signal.price : 0;
    const clippedBase = clamp(deltaBase, maxBasePerTrade);
    const decision: TradeDecision = {
      desiredBase,
      currentBase: state.solPerpBase,
      deltaBase,
      clippedBase,
      dryRun: env.dryRun,
    };
    if (Math.abs(clippedBase) < MIN_TRADE_BASE) {
      console.log('Delta below minimum trade threshold. Skipping.');
      appendLog({ command: 'trade_skip', signal, state, decision });
      return;
    }
    const notional = Math.abs(clippedBase * signal.price);
    if (notional > env.maxNotionalUsdc + 1e-6) {
      console.log('Clipped delta still exceeds max notional. Adjusting.');
    }
    if (env.dryRun) {
      console.log(
        `[DRY_RUN] Would trade ${clippedBase.toFixed(4)} SOL (delta ${deltaBase.toFixed(4)})`
      );
      appendLog({ command: 'trade_dry_run', signal, state, decision });
      return;
    }
    const txSig = await submitPerpOrder(ctx, clippedBase);
    console.log(`Submitted order: ${txSig}`);
    appendLog({ command: 'trade', txSig, signal, state, decision });
  } finally {
    await closeDriftContext(ctx);
  }
}

async function main(): Promise<void> {
  const [, , command] = process.argv;
  if (!command) {
    console.error('Usage: npm run dev -- <state|signal|trade>');
    process.exit(1);
  }
  if (command === 'state') {
    await handleState();
    return;
  }
  if (command === 'signal') {
    await handleSignal();
    return;
  }
  if (command === 'trade') {
    await handleTrade();
    return;
  }
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch((error) => {
  console.error('Error running bot:', error);
  appendLog({ command: 'error', message: error.message, stack: error.stack });
  process.exit(1);
});
