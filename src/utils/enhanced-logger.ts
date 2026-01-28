/** Error categories for logging */
export enum ErrorCategory {
	NETWORK = "network",
	DATABASE = "database",
	VALIDATION = "validation",
	EXTERNAL_API = "external_api",
	AI_MODEL = "ai_model",
	UNKNOWN = "unknown",
}

/** Logger configuration */
export interface LoggerConfig {
	workflowStep?: string;
	metadata?: Record<string, unknown>;
}

/** Extended logger context */
export interface LoggerContext extends LoggerConfig {
	[key: string]: unknown;
}

/** Enhanced logger interface */
export interface EnhancedLogger {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
	debug(message: string, data?: Record<string, unknown>): void;
	fatal(message: string, error?: Error, data?: Record<string, unknown>): void;
	child(context: LoggerConfig): EnhancedLogger;
	startTimer(key: string): void;
	endTimer(key: string): number;
	time<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** Shared timers map across all loggers */
const timers = new Map<string, number>();

/**
 * Create an enhanced logger with structured logging.
 */
export function createLogger(config: LoggerConfig = {}): EnhancedLogger {
	const context: LoggerContext = { ...config };

	const log = (
		level: string,
		message: string,
		data?: Record<string, unknown>,
	) => {
		const timestamp = new Date().toISOString();
		const logData = {
			timestamp,
			level,
			message,
			...context,
			...(data || {}),
		};
		console.log(JSON.stringify(logData));
	};

	return {
		info(message: string, data?: Record<string, unknown>) {
			log("info", message, data);
		},
		warn(message: string, data?: Record<string, unknown>) {
			log("warn", message, data);
		},
		error(message: string, data?: Record<string, unknown>) {
			log("error", message, data);
		},
		debug(message: string, data?: Record<string, unknown>) {
			log("debug", message, data);
		},
		fatal(message: string, error?: Error, data?: Record<string, unknown>) {
			const errorData = {
				name: error?.name,
				message: error?.message,
				stack: error?.stack,
				...data,
			};
			log("fatal", message, errorData);
		},
		child(childContext: LoggerConfig): EnhancedLogger {
			return createLogger({
				...context,
				...childContext,
			});
		},
		startTimer(key: string) {
			timers.set(`${context.workflowStep}:${key}`, Date.now());
		},
		endTimer(key: string): number {
			const timerKey = `${context.workflowStep}:${key}`;
			const startTime = timers.get(timerKey);
			if (startTime) {
				const duration = Date.now() - startTime;
				timers.delete(timerKey);
				return duration;
			}
			return 0;
		},
		async time<T>(key: string, fn: () => Promise<T>): Promise<T> {
			const startTime = Date.now();
			try {
				return await fn();
			} finally {
				const duration = Date.now() - startTime;
				this.debug(`Timer: ${key}`, { duration });
			}
		},
	};
}

/** Error logging options */
export interface LogErrorOptions {
	operation?: string;
	category?: ErrorCategory;
	recoverable?: boolean;
	metadata?: Record<string, unknown>;
}

/**
 * Log an error with enhanced context.
 */
export function logError(
	logger: EnhancedLogger,
	error: Error,
	options: LogErrorOptions = {},
): void {
	const {
		operation = "unknown",
		category = ErrorCategory.UNKNOWN,
		recoverable = false,
		metadata = {},
	} = options;

	logger.error(error.message, {
		operation,
		category,
		recoverable,
		name: error.name,
		stack: error.stack,
		...metadata,
	});
}
