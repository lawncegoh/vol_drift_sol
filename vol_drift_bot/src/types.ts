export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: string;
}

export type StrategyStatus = 'flat' | 'long' | 'short' | 'cooldown';

export interface StrategyConfig {
  intervals: string[];
  limit: number;
  rvWindow: number;
  rvZWindow: number;
  rvPctWindow: number;
  quietLookback: number;
  quietPct: number;
  rvZEntry: number;
  rvPctEntry: number;
  donchianLookback: number;
  donchianBuffer: number;
  holdBars: number;
  rampPerBar: number;
  cooldownBars: number;
  baseIntervalHours: number;
  maxLeverage: number;
}

export interface StrategyResult {
  timestamp: number;
  price: number;
  rv?: number;
  rvZ?: number;
  rvPct?: number;
  quietMin?: number;
  quietCondition: boolean;
  burstCondition: boolean;
  breakoutDirection: number;
  status: StrategyStatus;
  barsInPosition: number;
  cooldownRemaining: number;
  targetLeverage: number;
  reasoning: string[];
}

export interface EnvConfig {
  solanaRpcUrl: string;
  keypairPath: string;
  driftEnv: string;
  subaccountId: number;
  maxNotionalUsdc: number;
  maxLeverage: number;
  dryRun: boolean;
  binanceIntervals: string[];
}

export interface SignalSummary extends StrategyResult {
  targetBase: number;
}

export interface DriftStateSummary {
  totalCollateral: number;
  freeCollateral: number;
  solPerpBase: number;
}

export interface TradeDecision {
  desiredBase: number;
  currentBase: number;
  deltaBase: number;
  clippedBase: number;
  dryRun: boolean;
}
