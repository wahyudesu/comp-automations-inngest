/**
 * Centralized configuration management
 */

/** Instagram accounts to scrape for competition posts */
const IG_LOMBA = [
	"infolomba.indonesia.id",
	"lomba_mahasiswa",
	"infolombaeventid",
	// "infolomba",
	"infolombamahasiswa.id",
	"infolombaevent.id",
	"pusatinfolomba",
	// "lombasmpupdate",
	// "lombasma"
] as const;

/** Retry configuration for API calls */
export interface RetryConfig {
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	requestTimeoutMs: number;
}

/** Instagram scraper configuration */
export interface InstagramConfig {
	accounts: readonly string[];
	imageLimit: number;
	maxRetries: number;
	minDelay: number;
	maxDelay: number;
	timeout: number;
	rateLimitPerMinute: number;
	retryDelayMs: number;
}

/** R2 storage configuration */
export interface R2Config {
	endpoint: string;
	bucket: string;
	publicUrl: string;
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	requestTimeoutMs: number;
}

/** WhatsApp configuration */
export interface WhatsAppConfig {
	baseUrl: string;
	apiKey: string;
	sessionId: string;
	channelId: string;
}

/** Database configuration */
export interface DbConfig {
	ssl: "require";
	max: number;
}

/** Application configuration */
export interface AppConfig {
	instagram: InstagramConfig;
	r2: R2Config;
	whatsapp: WhatsAppConfig;
	db: DbConfig;
}

/**
 * Get environment variable with optional default
 * Throws if required and not present
 */
function getEnvVar(
	key: string,
	defaultValue: string | undefined = undefined,
): string {
	const value = process.env[key];
	if (value === undefined && defaultValue === undefined) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return (value ?? defaultValue) as string;
}

/** Configuration validation result */
export interface ValidationResult {
	valid: boolean;
	missing: string[];
}

/**
 * Create config from environment variables
 * Uses provided defaults for development
 */
export function createConfig(env: Record<string, string | undefined> = process.env): AppConfig {
	const getEnv = (key: string, defaultValue?: string): string => {
		const value = env[key];
		if (value === undefined && defaultValue === undefined) {
			throw new Error(`Missing required environment variable: ${key}`);
		}
		return (value ?? defaultValue) as string;
	};

	const RETRY_DELAY_MINUTES = 5;
	const MS_PER_MINUTE = 60 * 1000;

	return {
		instagram: {
			accounts: IG_LOMBA,
			imageLimit: 2,
			maxRetries: 1,
			minDelay: 500,
			maxDelay: 1000,
			timeout: 10000,
			rateLimitPerMinute: 20,
			retryDelayMs: RETRY_DELAY_MINUTES * MS_PER_MINUTE,
		},
		r2: {
			endpoint: getEnv("R2_ENDPOINT", "https://4c7c10d0a0b9ffcead7f92c375ec9f12.r2.cloudflarestorage.com"),
			bucket: getEnv("R2_BUCKET", "bucket-competition"),
			publicUrl: getEnv("R2_PUBLIC_URL", "https://objectcompetition.wahyuikbal.com"),
			maxAttempts: 3,
			baseDelayMs: 1000,
			maxDelayMs: 10000,
			requestTimeoutMs: 30000,
		},
		whatsapp: {
			baseUrl: "https://waha-qxjcatc8.sumopod.in",
			apiKey: env.WAHA_API_KEY ?? "",
			sessionId: "session_01jx523c9fdzcaev186szgc67h",
			channelId: "120363421736160206@g.us",
		},
		db: {
			ssl: "require",
			max: 1,
		},
	};
}

/** Default configuration instance */
export const config = createConfig();

/**
 * Validate required environment configuration
 */
export function validateConfig(env: Record<string, string | undefined> = process.env): ValidationResult {
	const missing: string[] = [];

	if (!env.DATABASE_URL) {
		missing.push("DATABASE_URL");
	}

	// R2 credentials are optional but must both be set if one is
	const hasR2KeyId = !!env.R2_ACCESS_KEY_ID;
	const hasR2Secret = !!env.R2_SECRET_ACCESS_KEY;

	if (hasR2KeyId !== hasR2Secret) {
		missing.push("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (both required if one is set)");
	}

	return {
		valid: missing.length === 0,
		missing,
	};
}
