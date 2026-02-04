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

type FailedAccount = { username: string; error: string; code?: string };

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
	const failedAccounts: FailedAccount[] = []; // Akun yang gagal (429, etc)

	log.startTimer("instagram-scrape-total");

	// Pass 1: Coba semua akun tanpa retry
	log.info("Pass 1: Attempting to scrape all accounts");
	for (const username of usernames) {
		const accountLog = log.child({
			workflowStep: `1-ig-scrape-${username}`,
		});

		try {
			await randomDelay(igConfig.minDelay, igConfig.maxDelay);

			const results = await accountLog.time(
				`instagram-fetch-${username}`,
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
			} else {
				const errorMsg = results.error ?? "Unknown error";
				const isRetryable = RETRYABLE_ERROR_CODES.some((code) =>
					errorMsg.includes(code) || errorMsg === code,
				);

				if (isRetryable) {
					accountLog.warn(`Failed (will retry): ${errorMsg}`, { username });
					failedAccounts.push({ username, error: errorMsg, code: errorMsg });
				} else {
					accountLog.error(`Failed (non-retryable): ${errorMsg}`, { username });
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

			const isRetryable =
				RETRYABLE_ERROR_CODES.some((code) =>
					errorMsg.includes(code) || errorCode === code,
				) || errorMsg.includes("429");

			if (isRetryable) {
				accountLog.warn(`Exception (will retry): ${errorMsg}`, { username, errorCode });
				failedAccounts.push({ username, error: errorMsg, code: errorCode });
			} else {
				accountLog.error(`Exception (non-retryable): ${errorMsg}`, { username, errorCode });
			}
		}
	}

	// Pass 2: Retry akun yang gagal (tunggu 5 menit SEKALI untuk semua)
	if (failedAccounts.length > 0) {
		log.info(`Pass 2: Retrying ${failedAccounts.length} failed accounts after ${RETRY_DELAY_MS / 60000} min delay`);
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

		for (const { username } of failedAccounts) {
			const accountLog = log.child({
				workflowStep: `1-ig-scrape-${username}-retry`,
			});

			try {
				await randomDelay(igConfig.minDelay, igConfig.maxDelay);

				const results = await accountLog.time(
					`instagram-fetch-${username}-retry`,
					async () => await scraper.getPosts(username, igConfig.imageLimit),
				);

				if (results.success && results.posts) {
					const validPosts = results.posts.filter(
						(post) => post.display_url && post.url,
					);

					accountLog.info("Fetched valid posts (retry)", {
						username,
						validCount: validPosts.length,
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
				} else {
					accountLog.error(`Failed on retry: ${results.error}`, { username });
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

				accountLog.error(`Exception on retry: ${errorMsg}`, { username, errorCode });
			}
		}
	}

	const totalTime = log.endTimer("instagram-scrape-total");
	const errors = failedAccounts.map(({ username, error, code }) => ({ username, error, code }));

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
