import { fetch } from 'undici';
import { Candle } from './types';

const BASE_URL = 'https://api.binance.com/api/v3/klines';

export async function fetchBinanceKlines(
  interval: string,
  limit = 500
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: 'SOLUSDT',
    interval,
    limit: String(limit),
  });
  const response = await fetch(`${BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch klines (${response.status}): ${await response.text()}`
    );
  }
  const raw = (await response.json()) as Array<unknown[]>;
  return raw.map((entry) => {
    const [openTime, open, high, low, close, volume, closeTime] = entry;
    return {
      openTime: Number(openTime),
      closeTime: Number(closeTime),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      interval,
    } satisfies Candle;
  });
}

export async function fetchIntervalMap(
  intervals: string[],
  limit: number
): Promise<Record<string, Candle[]>> {
  const entries = await Promise.all(
    intervals.map(async (interval) => {
      const candles = await fetchBinanceKlines(interval, limit);
      return [interval, candles] as const;
    })
  );
  return Object.fromEntries(entries);
}
