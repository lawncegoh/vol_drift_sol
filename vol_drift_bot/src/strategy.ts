import { Candle, SignalSummary, StrategyConfig, StrategyResult, StrategyStatus } from './types';

const DEFAULT_CONFIG: Omit<StrategyConfig, 'maxLeverage'> = {
  intervals: ['4h'],
  limit: 500,
  rvWindow: 42,
  rvZWindow: 42,
  rvPctWindow: 126,
  quietLookback: 24,
  quietPct: 0.25,
  rvZEntry: 1.2,
  rvPctEntry: 0.85,
  donchianLookback: 30,
  donchianBuffer: 0.001,
  holdBars: 6,
  rampPerBar: 0.6,
  cooldownBars: 6,
  baseIntervalHours: 4,
};

function calcLogReturns(closes: number[]): number[] {
  const returns = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i += 1) {
    returns[i] = Math.log(closes[i] / closes[i - 1]);
  }
  return returns;
}

function sampleStd(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentileRank(values: number[], target: number): number {
  if (values.length === 0) {
    return 0;
  }
  const count = values.filter((value) => value <= target).length;
  return count / values.length;
}

function takeNumberWindow(
  series: number[],
  endIndex: number,
  length: number,
  minStart = 0
): number[] | null {
  const start = endIndex - length + 1;
  if (start < minStart) {
    return null;
  }
  return series.slice(start, endIndex + 1);
}

function takeDefinedWindow(
  series: Array<number | null>,
  endIndex: number,
  length: number
): number[] | null {
  const start = endIndex - length + 1;
  if (start < 0) {
    return null;
  }
  const values: number[] = [];
  for (let i = start; i <= endIndex; i += 1) {
    const value = series[i];
    if (value === null || value === undefined) {
      return null;
    }
    values.push(value);
  }
  return values;
}

function computeDonchian(
  bars: Candle[],
  index: number,
  lookback: number
): { upper: number | null; lower: number | null } {
  const start = index - lookback;
  if (start < 0) {
    return { upper: null, lower: null };
  }
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = start; i < index; i += 1) {
    const bar = bars[i];
    highest = Math.max(highest, bar.high);
    lowest = Math.min(lowest, bar.low);
  }
  return { upper: highest, lower: lowest };
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

export function buildStrategyConfig(maxLeverage: number): StrategyConfig {
  return {
    ...DEFAULT_CONFIG,
    maxLeverage,
  };
}

export function evaluateStrategy(
  candles: Candle[],
  config: StrategyConfig
): StrategyResult {
  if (candles.length === 0) {
    throw new Error('No candles available for strategy evaluation');
  }
  const closes = candles.map((candle) => candle.close);
  const logReturns = calcLogReturns(closes);
  const rvSeries: Array<number | null> = new Array(candles.length).fill(null);
  const rvZSeries: Array<number | null> = new Array(candles.length).fill(null);
  const rvPctSeries: Array<number | null> = new Array(candles.length).fill(null);
  const quietMinSeries: Array<number | null> = new Array(candles.length).fill(null);

  for (let i = 0; i < candles.length; i += 1) {
    const returnsWindow = takeNumberWindow(
      logReturns,
      i,
      config.rvWindow,
      1
    );
    if (returnsWindow) {
      const rv =
        sampleStd(returnsWindow) * Math.sqrt(24 / config.baseIntervalHours);
      rvSeries[i] = rv;
    }
    const rvWindow = takeDefinedWindow(rvSeries, i, config.rvZWindow);
    if (rvWindow) {
      const mean = rvWindow.reduce((sum, value) => sum + value, 0) / rvWindow.length;
      const std = sampleStd(rvWindow);
      rvZSeries[i] = std === 0 ? 0 : (rvSeries[i]! - mean) / std;
    }
    const pctWindow = takeDefinedWindow(rvSeries, i, config.rvPctWindow);
    if (pctWindow && rvSeries[i] !== null) {
      rvPctSeries[i] = percentileRank(pctWindow, rvSeries[i]!);
    }
    const quietWindow = takeDefinedWindow(
      rvPctSeries,
      i,
      config.quietLookback
    );
    if (quietWindow) {
      quietMinSeries[i] = Math.min(...quietWindow);
    }
  }

  let status: StrategyStatus = 'flat';
  let direction = 0;
  let barsSinceEntry = 0;
  let cooldownRemaining = 0;
  let targetLeverage = 0;
  let barsInPosition = 0;
  let reasoning: string[] = [];

  for (let i = 0; i < candles.length; i += 1) {
    const rv = rvSeries[i];
    const rvZ = rvZSeries[i];
    const rvPct = rvPctSeries[i];
    const quietMin = quietMinSeries[i];
    const quietCondition = quietMin !== null && quietMin <= config.quietPct;
    const burstCondition =
      (rvZ !== null && rvZ >= config.rvZEntry) ||
      (rvPct !== null && rvPct >= config.rvPctEntry);
    const { upper, lower } = computeDonchian(
      candles,
      i,
      config.donchianLookback
    );
    let breakoutDirection = 0;
    if (upper !== null && candles[i].close >= upper * (1 + config.donchianBuffer)) {
      breakoutDirection = 1;
    } else if (
      lower !== null &&
      candles[i].close <= lower * (1 - config.donchianBuffer)
    ) {
      breakoutDirection = -1;
    }

    reasoning = [];
    if (quietCondition) {
      reasoning.push('quiet regime observed');
    }
    if (burstCondition) {
      reasoning.push('volatility burst detected');
    }
    if (breakoutDirection === 1) {
      reasoning.push('donchian breakout long');
    } else if (breakoutDirection === -1) {
      reasoning.push('donchian breakout short');
    }

    if (status === 'cooldown') {
      reasoning.push(`cooldown ${cooldownRemaining} bars remaining`);
    }

    if (
      status === 'flat' &&
      cooldownRemaining === 0 &&
      quietCondition &&
      burstCondition &&
      breakoutDirection !== 0
    ) {
      status = breakoutDirection === 1 ? 'long' : 'short';
      direction = breakoutDirection;
      barsSinceEntry = 0;
      reasoning.push('entered position');
    }

    if (status === 'long' || status === 'short') {
      barsInPosition = barsSinceEntry + 1;
      const ramp = Math.min(
        config.maxLeverage,
        config.rampPerBar * barsInPosition
      );
      if (barsInPosition >= config.holdBars) {
        status = 'cooldown';
        cooldownRemaining = config.cooldownBars;
        direction = 0;
        barsSinceEntry = 0;
        targetLeverage = 0;
        barsInPosition = 0;
        reasoning.push('exiting position into cooldown');
      } else {
        targetLeverage = ramp * direction;
        barsSinceEntry += 1;
      }
    } else {
      targetLeverage = 0;
      barsInPosition = 0;
      if (status === 'cooldown' && cooldownRemaining > 0) {
        cooldownRemaining -= 1;
        if (cooldownRemaining === 0) {
          status = 'flat';
          reasoning.push('cooldown finished');
        }
      }
    }

    if (i === candles.length - 1) {
      return {
        timestamp: candles[i].closeTime,
        price: candles[i].close,
        rv: rv ?? undefined,
        rvZ: rvZ ?? undefined,
        rvPct: rvPct ?? undefined,
        quietMin: quietMin ?? undefined,
        quietCondition,
        burstCondition,
        breakoutDirection,
        status,
        barsInPosition,
        cooldownRemaining,
        targetLeverage: clamp(targetLeverage, -config.maxLeverage, config.maxLeverage),
        reasoning,
      } satisfies StrategyResult;
    }
  }

  throw new Error('Strategy evaluation failed to return a result');
}

export function summarizeSignal(
  result: StrategyResult,
  maxNotionalUsdc: number
): SignalSummary {
  const baseUnit = result.price > 0 ? maxNotionalUsdc / result.price : 0;
  const targetBase = baseUnit * result.targetLeverage;
  return {
    ...result,
    targetBase,
  };
}
