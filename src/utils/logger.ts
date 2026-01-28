export interface SimpleLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(
  context: Record<string, unknown> = {},
): SimpleLogger {
  return {
    info(message: string, data?: Record<string, unknown>) {
      console.log(JSON.stringify({ level: "info", message, ...context, ...data }));
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(JSON.stringify({ level: "warn", message, ...context, ...data }));
    },
    error(message: string, data?: Record<string, unknown>) {
      console.error(JSON.stringify({ level: "error", message, ...context, ...data }));
    },
    debug(message: string, data?: Record<string, unknown>) {
      console.debug(JSON.stringify({ level: "debug", message, ...context, ...data }));
    },
  };
}
