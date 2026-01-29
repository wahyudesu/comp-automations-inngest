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

/** Format message with data into simple string */
function formatMessage(message: string, data?: Record<string, unknown>): string {
	if (!data || Object.keys(data).length === 0) return message;
	const parts = [message];
	for (const [key, value] of Object.entries(data)) {
		if (key === "duration" && typeof value === "number") {
			parts.push(`(${(value / 1000).toFixed(1)}s)`);
		} else if (key === "count" || key === "validCount" || key === "sent" || key === "skipped") {
			parts.push(`${value}`);
		} else if (key === "username" || key === "source") {
			parts.push(`@${value}`);
		} else if (key === "status" && value === "error") {
			parts.push("✗");
		}
	}
	return parts.join(" ");
}

/** Get prefix based on workflow step */
function getPrefix(workflowStep?: string): string {
	if (!workflowStep) return "  ";
	if (workflowStep.includes("ig-scrape")) return "  [ig] ";
	if (workflowStep.includes("web-scrape")) return "  [web] ";
	if (workflowStep.includes("upload-r2")) return "  [r2] ";
	if (workflowStep.includes("insert-db")) return "  [db] ";
	if (workflowStep.includes("extract") || workflowStep.includes("ai")) return "  [ai] ";
	if (workflowStep.includes("whatsapp") || workflowStep.includes("wa")) return "  [wa] ";
	if (workflowStep.includes("cf-workers-cron")) return "→ ";
	return "  ";
}

/**
 * Create an enhanced logger with clean, readable logging.
 */
export function createLogger(config: LoggerConfig = {}): EnhancedLogger {
	const context: LoggerContext = { ...config };

	return {
		info(message: string, data?: Record<string, unknown>) {
			const prefix = getPrefix(context.workflowStep);
			console.log(`${prefix}${formatMessage(message, data)}`);
		},
		warn(message: string, data?: Record<string, unknown>) {
			const prefix = getPrefix(context.workflowStep);
			console.warn(`${prefix}⚠ ${formatMessage(message, data)}`);
		},
		error(message: string, data?: Record<string, unknown>) {
			const prefix = getPrefix(context.workflowStep);
			console.error(`${prefix}✗ ${formatMessage(message, data)}`);
		},
		debug(message: string, data?: Record<string, unknown>) {
			// Only log debug in development
			if (process.env.NODE_ENV !== "production") {
				const prefix = getPrefix(context.workflowStep);
				console.log(`${prefix}· ${formatMessage(message, data)}`);
			}
		},
		fatal(message: string, error?: Error, data?: Record<string, unknown>) {
			const prefix = getPrefix(context.workflowStep);
			console.error(`${prefix}💀 ${message}`);
			if (error?.message && !error.message.includes("AxiosError")) {
				console.error(`${prefix}   ${error.message}`);
			}
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
				// Only log timer in non-production
				if (process.env.NODE_ENV !== "production") {
					this.debug(`${key}`, { duration });
				}
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
 * Log an error with simplified output.
 * For Axios/external API errors, shows minimal info.
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

	// Simplify Axios/external API errors
	if (error.message.includes("AxiosError") || error.message.includes("status code")) {
		const match = error.message.match(/status code (\d+)/);
		const status = match ? match[1] : "?";
		const urlMatch = error.message.match(/\/api\/v1\/media\/([A-Za-z0-9_-]+)/);
		const mediaId = urlMatch ? urlMatch[1] : "";

		if (mediaId) {
			logger.warn(`IG API ${status}: ${mediaId}`, { recoverable });
		} else {
			logger.warn(`API ${status}: ${operation}`, { recoverable });
		}
		return;
	}

	// For other errors, show simple message
	logger.error(error.message, {
		operation,
		recoverable,
	});
}
