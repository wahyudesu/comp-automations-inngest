/**
 * Independent pipeline processor - runs complete pipeline (scrape → R2 → DB → Inngest)
 * for each source in parallel. Each source processes independently without waiting for others.
 */

import { createLogger, type EnhancedLogger } from "../utils/enhanced-logger.js";
import { scrape as igScrape } from "./1.ig-scrape.js";
import { scrape as infolombaidScrape } from "./1.web-scrape-infolombaid.js";
import { scrape as infolombaitScrape } from "./1.web-scrape-infolombait.js";
import { uploadToR2 } from "./2.upload-to-r2.js";
import { insertToDb } from "./3.insertdb.js";
import { config } from "./lib/config.js";
import type { ScrapeResult, ScrapedPost, Env } from "./lib/types.js";

interface PipelineResult {
	source: string;
	scraped: number;
	inserted: number;
	newRecordIds: number[];
	errors?: string[];
	duration: number;
	retryAttempts?: number; // Track retry attempts for web scrapers
}

interface InngestTriggerResult {
	success: boolean;
	recordIds: number[];
	source: string;
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate exponential backoff for retry (capped at 60s) */
function getRetryDelay(attempt: number, baseDelayMs: number = 5000): number {
	return Math.min(baseDelayMs * Math.pow(1.5, attempt), 60000);
}

/**
 * Run full pipeline for a single source: scrape → R2 → DB
 * Web sources have INFINITE retry until success
 * IG source uses existing retry logic (limited attempts)
 */
async function runSourcePipeline(
	source: string,
	scrapeFn: () => Promise<ScrapeResult>,
	env: Env,
	isWebSource: boolean,
	parentLog?: EnhancedLogger,
): Promise<PipelineResult> {
	const log = parentLog ?? createLogger({ workflowStep: `pipeline-${source}` });
	const startTime = Date.now();

	log.info(`[${source}] Starting pipeline`, {
		source,
		isWebSource,
		retryStrategy: isWebSource ? "infinite until success" : "limited attempts (IG)",
	});

	let scrapeResult: ScrapeResult;
	let retryAttempts = 0;
	let lastError: string | undefined;

	if (isWebSource) {
		// Web source: retry UNTIL SUCCESS with exponential backoff
		while (true) {
			try {
				log.info(`[${source}] Scraping attempt ${retryAttempts + 1}...`);
				scrapeResult = await scrapeFn();

				if (scrapeResult.count > 0) {
					log.info(`[${source}] ✓ Scraping successful! ${scrapeResult.count} posts fetched`, {
						attempts: retryAttempts + 1,
					});
					break; // Success! Exit the retry loop
				}

				// Got 0 posts - treat as failure and retry
				const warningMsg = `[${source}] Got 0 posts, will retry...`;
				log.warn(warningMsg);
				lastError = warningMsg;
				retryAttempts++;

				const delay = getRetryDelay(retryAttempts);
				log.info(`[${source}] Waiting ${Math.round(delay / 1000)}s before retry...`);
				await sleep(delay);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				log.error(`[${source}] Scraping failed: ${errorMsg}`);
				lastError = errorMsg;
				retryAttempts++;

				const delay = getRetryDelay(retryAttempts);
				log.info(`[${source}] Waiting ${Math.round(delay / 1000)}s before retry...`);
				await sleep(delay);
			}
		}
	} else {
		// IG source: use existing retry logic (no changes)
		try {
			log.info(`[${source}] Scraping (using existing retry logic)...`);
			scrapeResult = await scrapeFn();
			log.info(`[${source}] Scraping completed: ${scrapeResult.count} posts`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			log.error(`[${source}] IG scraping failed`, { error: errorMsg });

			return {
				source,
				scraped: 0,
				inserted: 0,
				newRecordIds: [],
				errors: [errorMsg],
				duration: Date.now() - startTime,
			};
		}
	}

	// If no posts scraped, return early
	if (scrapeResult.count === 0) {
		log.info(`[${source}] No posts scraped, skipping pipeline`);
		return {
			source,
			scraped: 0,
			inserted: 0,
			newRecordIds: [],
			errors: lastError ? [lastError] : undefined,
			duration: Date.now() - startTime,
			retryAttempts,
		};
	}

	// Now execute R2 + DB steps
	try {
		const result = await executeR2AndDbSteps(source, scrapeResult, env, log, startTime, retryAttempts);
		return result;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		log.error(`[${source}] Pipeline failed after scraping`, { error: errorMsg });

		return {
			source,
			scraped: scrapeResult.count,
			inserted: 0,
			newRecordIds: [],
			errors: [errorMsg],
			duration: Date.now() - startTime,
			retryAttempts,
		};
	}
}

/** Execute R2 upload and DB insert steps */
async function executeR2AndDbSteps(
	source: string,
	scrapeResult: ScrapeResult,
	env: Env,
	log: EnhancedLogger,
	startTime: number,
	retryAttempts: number,
): Promise<PipelineResult> {
	// Step 2: Upload to R2
	log.info(`[${source}] Step 2: Uploading to R2...`);
	const uploadedPosts = await uploadToR2(scrapeResult.posts, env, {}, {}, log);
	log.info(`[${source}] R2 upload completed: ${uploadedPosts.length} posts`);

	// Step 3: Insert to DB
	log.info(`[${source}] Step 3: Inserting to database...`);
	const insertResult = await insertToDb(uploadedPosts, env, log);

	if (!insertResult || typeof insertResult !== "object") {
		throw new Error("Database insert returned invalid result");
	}

	const insertCount = "count" in insertResult ? (insertResult.count as number) : 0;
	const newRecordIds = "newRecordIds" in insertResult ? (insertResult.newRecordIds as number[]) : [];

	log.info(`[${source}] ✓ Pipeline completed successfully`, {
		scraped: scrapeResult.count,
		inserted: insertCount,
		newRecordIds: newRecordIds.length,
		retryAttempts,
	});

	return {
		source,
		scraped: scrapeResult.count,
		inserted: insertCount,
		newRecordIds,
		errors: scrapeResult.errors?.map((e) => `${e.username}: ${e.error}`),
		duration: Date.now() - startTime,
		retryAttempts,
	};
}

/**
 * Run all source pipelines in parallel.
 * Web sources retry UNTIL SUCCESS before proceeding to R2/DB.
 * IG source uses existing retry logic.
 */
export async function runParallelPipelines(
	env: Env,
	parentLog?: EnhancedLogger,
): Promise<{
	results: PipelineResult[];
	totalScraped: number;
	totalInserted: number;
	totalNewRecordIds: number[];
	allErrors: string[];
}> {
	const log = parentLog ?? createLogger({ workflowStep: "parallel-pipelines" });

	log.info("Starting parallel pipelines", {
		igAccounts: config.instagram.accounts.length,
		webSources: config.webScraping.enabled ? config.webScraping.sources.length : 0,
		note: "Web sources will retry until successful",
	});

	// Define all pipelines to run in parallel
	// Web sources: isWebSource = true (infinite retry)
	// IG: isWebSource = false (existing retry logic)
	const pipelinePromises: Promise<PipelineResult>[] = [
		// Instagram pipeline (existing retry logic)
		runSourcePipeline("instagram", igScrape, env, false, log),

		// Web scrapers (infinite retry until success)
		...(config.webScraping.enabled
			? config.webScraping.sources.map((source) => {
					const scrapeFn =
						source.name === "infolombaid"
							? infolombaidScrape
							: source.name === "infolombait"
								? infolombaitScrape
								: async () => ({ count: 0, posts: [] });
					return runSourcePipeline(source.name, scrapeFn, env, true, log);
				})
			: []),
	];

	// Run all pipelines in parallel
	const outcomes = await Promise.allSettled(pipelinePromises);

	// Collect results
	const results: PipelineResult[] = [];
	const allErrors: string[] = [];
	let totalScraped = 0;
	let totalInserted = 0;
	const totalNewRecordIds: number[] = [];

	for (const outcome of outcomes) {
		if (outcome.status === "fulfilled") {
			const result = outcome.value;
			results.push(result);
			totalScraped += result.scraped;
			totalInserted += result.inserted;
			totalNewRecordIds.push(...result.newRecordIds);

			if (result.errors?.length) {
				allErrors.push(...result.errors);
			}

			log.info(`[${result.source}] Pipeline summary`, {
				scraped: result.scraped,
				inserted: result.inserted,
				newRecords: result.newRecordIds.length,
				duration: result.duration,
				retryAttempts: result.retryAttempts ?? 0,
			});
		} else {
			const errorMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
			allErrors.push(`Unknown pipeline error: ${errorMsg}`);
			log.error("Pipeline failed with exception", { error: errorMsg });
		}
	}

	log.info("All parallel pipelines completed", {
		totalScraped,
		totalInserted,
		totalNewRecordIds: totalNewRecordIds.length,
		totalErrors: allErrors.length,
		sources: results.map(r => ({
			source: r.source,
			scraped: r.scraped,
			inserted: r.inserted,
			duration: r.duration,
			retryAttempts: r.retryAttempts ?? 0,
		})),
	});

	return {
		results,
		totalScraped,
		totalInserted,
		totalNewRecordIds,
		allErrors,
	};
}

/**
 * Legacy alias for compatibility - runs all scrapers in parallel
 * but returns combined results (old behavior)
 */
export async function scrapeAllSources(parentLog?: EnhancedLogger): Promise<ScrapeResult> {
	const log = parentLog ?? createLogger({ workflowStep: "1-parallel-scrape" });

	log.info("Starting parallel scraping (legacy mode)", {
		igAccounts: config.instagram.accounts.length,
		webSources: config.webScraping.enabled ? config.webScraping.sources.length : 0,
	});

	const scraperPromises = [
		// Instagram scraping
		(async () => {
			const result = await igScrape(log);
			return { source: "instagram", result };
		})(),

		// Web scrapers (only if enabled)
		...(config.webScraping.enabled
			? config.webScraping.sources.map((source) =>
					(async () => {
						let result: ScrapeResult;
						if (source.name === "infolombaid") {
							result = await infolombaidScrape();
						} else if (source.name === "infolombait") {
							result = await infolombaitScrape();
						} else {
							result = { count: 0, posts: [] };
						}
						return { source: source.name, result };
					})(),
				)
			: []),
	];

	const outcomes = await Promise.allSettled(scraperPromises);

	const allPosts: ScrapedPost[] = [];
	const allErrors: { username: string; error: string }[] = [];
	const sourceSummary: Record<string, { count: number; errors: number }> = {};

	for (const outcome of outcomes) {
		if (outcome.status === "fulfilled") {
			const { source, result } = outcome.value;
			allPosts.push(...result.posts);

			if (result.errors) {
				for (const err of result.errors) {
					allErrors.push({ ...err, username: `${source}:${err.username}` });
				}
			}

			sourceSummary[source] = {
				count: result.count,
				errors: result.errors?.length ?? 0,
			};

			log.info(`Scraped ${source}`, {
				source,
				count: result.count,
				errors: result.errors?.length ?? 0,
			});
		} else {
			const errorMsg =
				outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
			allErrors.push({ username: "unknown", error: errorMsg });
			log.error("Scraper failed with exception", { error: errorMsg });
		}
	}

	log.info("Parallel scraping completed", {
		totalPosts: allPosts.length,
		totalErrors: allErrors.length,
		sources: sourceSummary,
	});

	return {
		count: allPosts.length,
		posts: allPosts,
		errors: allErrors.length > 0 ? allErrors : undefined,
	};
}
