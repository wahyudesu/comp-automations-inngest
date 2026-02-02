import { InstagramScraper, ScrapeError } from "@aduptive/instagram-scraper";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";
import { config } from "./lib/config.js";
import type { ScrapeResult, ScrapeError as ScrapeErrorType, ScrapedPost } from "./lib/types.js";

function randomDelay(minMs: number, maxMs: number): Promise<void> {
	const delayMs = minMs + Math.random() * (maxMs - minMs);
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Maximum retry attempts per account */
const MAX_RETRY_PER_ACCOUNT = 3;

/** Delay between retries (5 minutes) */
const RETRY_DELAY_MS = 5 * 60 * 1000;

/** Error codes that should trigger a retry with delay */
const RETRYABLE_ERROR_CODES = ["429", "429_TOO_MANY_REQUESTS", "RATE_LIMITED"];

async function scrapeOnce(
	log: EnhancedLogger,
	usernames: readonly string[],
): Promise<{
	posts: ScrapedPost[];
	errors: ScrapeErrorType[];
	totalTime: number;
}> {
	const igConfig = config.instagram;
	const scraper = new InstagramScraper({
		maxRetries: igConfig.maxRetries,
		minDelay: igConfig.minDelay,
		maxDelay: igConfig.maxDelay,
		timeout: igConfig.timeout,
		rateLimitPerMinute: igConfig.rateLimitPerMinute,
	});

	const posts: ScrapedPost[] = [];
	const errors: ScrapeErrorType[] = [];

	log.startTimer("instagram-scrape-total");

	for (const username of usernames) {
		const accountLog = log.child({
			workflowStep: `1-ig-scrape-${username}`,
		});

		let attempt = 0;
		let lastError: { error: string; code?: string } | null = null;
		let succeeded = false;

		while (attempt < MAX_RETRY_PER_ACCOUNT && !succeeded) {
			attempt++;

			try {
				// Add delay before retry (not on first attempt)
				if (attempt > 1) {
					accountLog.info(`Retrying account ${username} after ${RETRY_DELAY_MS / 60000} min delay`, {
						username,
						attempt,
						maxAttempts: MAX_RETRY_PER_ACCOUNT,
					});
					await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				} else {
					await randomDelay(igConfig.minDelay, igConfig.maxDelay);
				}

				const results = await accountLog.time(
					`instagram-fetch-${username}-${attempt}`,
					async () => await scraper.getPosts(username, igConfig.imageLimit),
				);

				if (results.success && results.posts) {
					const validPosts = results.posts.filter(
						(post) => post.display_url && post.url,
					);

					accountLog.info("Fetched valid posts", {
						username,
						validCount: validPosts.length,
						totalCount: results.posts.length,
						attempt,
					});

					for (const post of validPosts) {
						posts.push({
							title: null,
							link: post.url,
							image: post.display_url,
							description: post.caption || "",
							source: "instagram",
							username,
						});
					}
					succeeded = true;
				} else {
					const errorMsg = results.error ?? "Unknown error";
					lastError = { error: errorMsg, code: errorMsg };

					// Check if error is retryable
					const isRetryable = RETRYABLE_ERROR_CODES.some((code) =>
						errorMsg.includes(code) || errorMsg === code,
					);

					if (isRetryable && attempt < MAX_RETRY_PER_ACCOUNT) {
						accountLog.warn(`Failed to fetch posts (retryable): ${errorMsg}`, {
							username,
							errorCode: errorMsg,
							attempt,
							willRetry: true,
						});
						// Continue to next iteration for retry
					} else {
						accountLog.error(`Failed to fetch posts (non-retryable or max retries): ${errorMsg}`, {
							username,
							errorCode: errorMsg,
							attempt,
							willRetry: false,
						});
						errors.push({ username, error: errorMsg, code: errorMsg });
						break; // Exit retry loop
					}
				}
			} catch (error) {
				let errorMsg = "Unknown error";
				let errorCode: string | undefined;

				if (error instanceof ScrapeError) {
					errorMsg = error.message;
					errorCode = error.code;
				} else if (error instanceof Error) {
					errorMsg = error.message;
				}

				lastError = { error: errorMsg, code: errorCode };

				// Check if error is retryable
				const isRetryable =
					RETRYABLE_ERROR_CODES.some((code) =>
						errorMsg.includes(code) || errorCode === code,
					) || errorMsg.includes("429");

				if (isRetryable && attempt < MAX_RETRY_PER_ACCOUNT) {
					accountLog.warn(`Exception occurred (retryable): ${errorMsg}`, {
						username,
						errorCode,
						attempt,
						willRetry: true,
					});
					// Continue to next iteration for retry
				} else {
					errors.push({ username, error: errorMsg, code: errorCode });

					logError(
						accountLog,
						error instanceof Error ? error : new Error(errorMsg),
						{
							operation: "instagram-scrape",
							category: ErrorCategory.NETWORK,
							recoverable: true,
							metadata: { username, errorCode, attempt },
						},
					);
					break; // Exit retry loop
				}
			}
		}

		// Log if account was skipped after max retries
		if (!succeeded && attempt >= MAX_RETRY_PER_ACCOUNT) {
			accountLog.error(`Account ${username} skipped after ${MAX_RETRY_PER_ACCOUNT} failed attempts`, {
				username,
				maxAttemptsReached: true,
				lastError: lastError?.error,
			});
		}
	}

	const totalTime = log.endTimer("instagram-scrape-total");

	return { posts, errors, totalTime };
}

export async function scrape(parentLog?: EnhancedLogger): Promise<ScrapeResult> {
	const log = parentLog ?? createLogger({ workflowStep: "1-ig-scrape" });
	const usernames = config.instagram.accounts;
	const retryDelayMs = config.instagram.retryDelayMs;

	let attempt = 0;

	while (true) {
		attempt++;

		log.info("Starting Instagram scraping", {
			accountsCount: usernames.length,
			imageLimit: config.instagram.imageLimit,
			attempt,
		});

		const { posts, errors, totalTime } = await scrapeOnce(log, usernames);

		const successCount = usernames.length - errors.length;
		const isSuccess = posts.length > 0 || successCount > 0;

		if (isSuccess) {
			if (errors.length > 0) {
				log.warn("Some accounts failed during scraping", {
					skippedAccounts: errors.map((e) => e.username),
					errorCount: errors.length,
					successCount,
				});
			}

			log.info("Instagram scraping completed successfully", {
				totalCount: posts.length,
				successCount,
				errorCount: errors.length,
				totalDuration: Math.round(totalTime),
				avgDurationPerAccount: Math.round(totalTime / usernames.length),
				attempt,
			});

			return {
				count: posts.length,
				posts,
				errors: errors.length > 0 ? errors : undefined,
			};
		}

		log.warn("Instagram scraping failed completely, retrying...", {
			attempt,
			delayMinutes: retryDelayMs / 60000,
			errors,
		});

		await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
	}
}
