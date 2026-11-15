export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Whether STATPAD_MCP_LOG names a level or off, ignoring case and surrounding spaces. */
export function isLogSetting(setting: string): boolean {
  const value = setting.trim().toLowerCase();
  return value === 'off' || value in ORDER;
}

/**
 * Writes one JSON line per event to stderr through console.error. stdout carries the MCP
 * protocol over stdio, so nothing may log there. Set STATPAD_MCP_LOG to debug, info, warn,
 * error or off; anything else logs at info.
 */
export function stderrLogger(setting: string | undefined = 'info'): Logger {
  const value = setting.trim().toLowerCase();
  if (value === 'off') return silentLogger;
  const min = ORDER[value as LogLevel] ?? ORDER.info;
  return (level, message, fields) => {
    if (ORDER[level] < min) return;
    console.error(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
  };
}

export const silentLogger: Logger = () => {};
