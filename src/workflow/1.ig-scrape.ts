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
				errors.push({ username, error: errorMsg, code: errorMsg });
				accountLog.warn(`Failed to fetch posts: ${errorMsg}`, {
					username,
					errorCode: errorMsg,
				});
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

			errors.push({ username, error: errorMsg, code: errorCode });

			logError(
				accountLog,
				error instanceof Error ? error : new Error(errorMsg),
				{
					operation: "instagram-scrape",
					category: ErrorCategory.NETWORK,
					recoverable: true,
					metadata: { username, errorCode },
				},
			);
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
