import fs from 'fs';
import { logFile } from './paths';

/**
 * Diagnostic log at <data>/debug.log, mirroring FlankLog: fire-and-forget
 * tasks and init failures land here instead of being swallowed.
 */
export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // Logging must never throw.
  }
}

export function logError(context: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  log(`[${context}] ${detail}`);
}

/** Wrap a fire-and-forget promise so failures reach debug.log. */
export function fireAndForget(context: string, promise: Promise<unknown>): void {
  promise.catch((err) => logError(context, err));
}

export function installGlobalErrorLogging(): void {
  process.on('uncaughtException', (err) => logError('uncaughtException', err));
  process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));
}
