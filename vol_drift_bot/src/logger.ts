import fs from 'fs';
import path from 'path';

const LOG_PATH = path.join(process.cwd(), 'logs', 'trades.jsonl');

function ensureLogDir(): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
}

export function appendLog(event: Record<string, unknown>): void {
  ensureLogDir();
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf-8');
}
