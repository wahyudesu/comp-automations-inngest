/**
 * Centralized configuration management
 */

const IG_LOMBA = [
	"infolomba.indonesia.id",
	"lomba_mahasiswa",
	"infolombaeventid",
	"infolomba",
	"infolombamahasiswa.id",
	"infolombaevent.id",
	"pusatinfolomba",
] as const;

export const config = {
	instagram: {
		accounts: IG_LOMBA,
		imageLimit: 4,
		maxRetries: 2,
		minDelay: 2000,
		maxDelay: 5000,
		timeout: 10000,
		rateLimitPerMinute: 20,
		retryDelayMs: 5 * 60 * 1000, // 5 minutes
	},
	r2: {
		endpoint: process.env.R2_ENDPOINT ?? "https://4c7c10d0a0b9ffcead7f92c375ec9f12.r2.cloudflarestorage.com",
		bucket: process.env.R2_BUCKET ?? "bucket-competition",
		publicUrl: process.env.R2_PUBLIC_URL ?? "https://objectcompetition.wahyuikbal.com",
		maxAttempts: 3,
		baseDelayMs: 1000,
		maxDelayMs: 10000,
		requestTimeoutMs: 30000,
	},
	whatsapp: {
		baseUrl: process.env.WAHA_BASE_URL ?? "https://waha-qxjcatc8.sumopod.in",
		apiKey: process.env.WAHA_API_KEY,
		sessionId: process.env.WA_SESSION_ID ?? "session_01jx523c9fdzcaev186szgc67h",
		channelId: process.env.WHATSAPP_CHANNEL_ID ?? "120363421736160206@g.us",
	},
	db: {
		ssl: "require" as const,
		max: 1, // limit connections for serverless
	},
} as const;

/**
 * Validate required configuration
 */
export function validateConfig(): { valid: boolean; missing: string[] } {
	const missing: string[] = [];

	// Database is always required
	if (!process.env.DATABASE_URL) {
		missing.push("DATABASE_URL");
	}

	// R2 is optional but warn if partial
	const hasR2Access = !!process.env.R2_ACCESS_KEY_ID || !!process.env.R2_SECRET_ACCESS_KEY;
	const hasR2Env = !!process.env.R2_ACCESS_KEY_ID && !!process.env.R2_SECRET_ACCESS_KEY;
	if (process.env.R2_ACCESS_KEY_ID || process.env.R2_SECRET_ACCESS_KEY) {
		if (!hasR2Env) {
			missing.push("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (both required if one is set)");
		}
	}

	return {
		valid: missing.length === 0,
		missing,
	};
}
