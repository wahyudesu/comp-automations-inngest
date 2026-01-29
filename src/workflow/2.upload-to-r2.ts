import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";
import { config } from "./lib/config.js";
import type { UploadResult, Env } from "./lib/types.js";

/** Retry configuration for R2 uploads */
interface RetryConfig {
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	requestTimeoutMs: number;
}

const DEFAULT_RETRY_CONFIG = {
	maxAttempts: 3,
	baseDelayMs: 1000,
	maxDelayMs: 10000,
	requestTimeoutMs: 30000,
} as const satisfies RetryConfig;

/** Sleep for specified milliseconds */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate exponential backoff with jitter */
function calculateBackoff(attempt: number, retryConfig: RetryConfig): number {
	const exponentialDelay = Math.min(
		retryConfig.baseDelayMs * Math.pow(2, attempt),
		retryConfig.maxDelayMs,
	);
	const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
	return Math.max(0, exponentialDelay + jitter);
}

/** Fetch with timeout */
async function fetchWithTimeout(
	url: string,
	options: RequestInit = {},
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		return response;
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Request timeout after ${timeoutMs}ms`);
		}
		throw error;
	}
}

/** Check if error is retryable */
function isRetryableError(error: Error): boolean {
	const message = error.message;
	return (
		message.includes("Network connection lost") ||
		message.includes("timeout") ||
		message.includes("ECONNRESET") ||
		message.includes("fetch") ||
		message.includes("HTTP 5")
	);
}

interface PostData {
	title?: string | null;
	username?: string;
	image: string;
}

async function uploadSingleImage(
	post: PostData,
	s3Client: S3Client,
	retryConfig: RetryConfig,
	r2Bucket: string,
	r2PublicUrl: string,
	parentLog?: EnhancedLogger,
): Promise<UploadResult> {
	const log = parentLog ?? createLogger({ workflowStep: "2-upload-single" });
	const imageUrl = post.image;

	if (!imageUrl || !imageUrl.startsWith("http")) {
		log.warn("Invalid image URL", { url: imageUrl?.substring(0, 100) });
		return { success: false, originalUrl: imageUrl, error: "Invalid URL" };
	}

	let lastError: Error | undefined;

	for (let attempt = 0; attempt < retryConfig.maxAttempts; attempt++) {
		const attemptLog = log.child({
			workflowStep: `2-upload-attempt-${attempt + 1}`,
		});

		try {
			attemptLog.debug("Fetching image", {
				url: imageUrl.substring(0, 100),
				attempt: attempt + 1,
				maxAttempts: retryConfig.maxAttempts,
			});

			const response = await attemptLog.time(
				`fetch-image-${attempt}`,
				async () =>
					await fetchWithTimeout(
						imageUrl,
						{
							headers: {
								"User-Agent":
									"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
								Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
							},
						},
						retryConfig.requestTimeoutMs,
					),
			);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const buffer = await response.arrayBuffer();

			if (buffer.byteLength === 0) {
				throw new Error("Received empty buffer");
			}

			attemptLog.debug("Image fetched", {
				size: buffer.byteLength,
				contentType: response.headers.get("content-type"),
			});

			const sanitizedTitle = post.title
				? post.title
						.replace(/[^a-z0-9]/gi, "_")
						.toLowerCase()
						.slice(0, 50)
				: post.username ?? "instagram";
			const filename = `${Date.now()}-${sanitizedTitle}.jpg`;

			await attemptLog.time(`upload-to-r2-${attempt}`, async () => {
				await s3Client.send(
					new PutObjectCommand({
						Bucket: r2Bucket,
						Key: filename,
						Body: new Uint8Array(buffer),
						ContentType: response.headers.get("content-type") ?? "image/jpeg",
					}),
				);
			});

			const r2Url = `${r2PublicUrl}/${filename}`;
			attemptLog.debug("Successfully uploaded to R2", { filename, r2Url });

			return {
				success: true,
				originalUrl: imageUrl,
				r2Url,
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (!isRetryableError(lastError)) {
				logError(attemptLog, lastError, {
					operation: "r2-upload",
					category: ErrorCategory.UNKNOWN,
					recoverable: false,
					metadata: { url: imageUrl.substring(0, 100) },
				});
				break;
			}

			logError(attemptLog, lastError, {
				operation: "r2-upload",
				category: ErrorCategory.NETWORK,
				recoverable: true,
				metadata: { url: imageUrl.substring(0, 100), attempt: attempt + 1 },
			});

			if (attempt < retryConfig.maxAttempts - 1) {
				const delay = calculateBackoff(attempt, retryConfig);
				attemptLog.warn("Retrying after delay", {
					delay: Math.round(delay),
					nextAttempt: attempt + 2,
				});
				await sleep(delay);
			}
		}
	}

	return {
		success: false,
		originalUrl: imageUrl,
		error: lastError?.message ?? "Unknown error",
	};
}

export async function uploadToR2(
	posts: PostData[],
	env: Env,
	retryConfig: Partial<RetryConfig> = {},
	parentLog?: EnhancedLogger,
): Promise<PostData[]> {
	const log = parentLog ?? createLogger({ workflowStep: "2-upload-r2" });
	const r2Config = config.r2;

	const accessKeyId = env.R2_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? process.env.R2_SECRET_ACCESS_KEY;

	if (!accessKeyId || !secretAccessKey) {
		log.warn(
			"R2 credentials not found, skipping upload and returning original URLs",
			{
				hasAccessKeyId: !!accessKeyId,
				hasSecretAccessKey: !!secretAccessKey,
			},
		);
		return posts;
	}

	log.info("Starting R2 upload", { postCount: posts.length });

	const s3Client = new S3Client({
		region: "auto",
		endpoint: r2Config.endpoint,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	const configWithDefaults = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
	const updatedPosts: PostData[] = [];
	let successCount = 0;
	let failureCount = 0;

	log.startTimer("r2-upload-total");

	for (let i = 0; i < posts.length; i++) {
		const post = posts[i];
		const postLog = log.child({
			workflowStep: `2-upload-post-${i}`,
		});

		postLog.debug("Processing post", {
			index: i + 1,
			total: posts.length,
			title: post.title?.substring(0, 50),
		});

		const result = await uploadSingleImage(
			post,
			s3Client,
			configWithDefaults,
			r2Config.bucket,
			r2Config.publicUrl,
			postLog,
		);

		if (result.success) {
			successCount++;
			postLog.debug("Upload successful", { r2Url: result.r2Url });
			updatedPosts.push({
				...post,
				image: result.r2Url!,
			});
		} else {
			failureCount++;
			postLog.error("Upload failed", {
				title: post.title?.substring(0, 50),
				error: result.error,
			});
			updatedPosts.push({
				...post,
				image: result.originalUrl,
			});
		}
	}

	const totalTime = log.endTimer("r2-upload-total");

	log.info("R2 upload completed", {
		successCount,
		failureCount,
		totalCount: posts.length,
		totalDuration: Math.round(totalTime),
		avgDuration: Math.round(totalTime / posts.length),
	});

	return updatedPosts;
}
