import { scrape as igScrape } from "../workflow/1.ig-scrape.js";
import { uploadToR2 } from "../workflow/2.upload-to-r2.js";
import { insertToDb } from "../workflow/3.insertdb.js";
import { createLogger } from "../utils/enhanced-logger.js";
import type { Env } from "../workflow/lib/types.js";

/**
 * Cloudflare Workers Scheduled Event
 */
export interface ScheduledEvent {
	scheduledTime: number;
	cron: string;
}

/**
 * Cloudflare Workers Execution Context
 */
export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

/**
 * Cloudflare Workers Cron Handler
 *
 * Runs the scraping pipeline: IG Scraping → R2 Upload → DB Insert → Trigger Inngest
 * This is designed to run directly in Cloudflare Workers with nodejs_compat.
 *
 * @param env - Environment variables from Cloudflare Workers bindings
 * @param inngestUrl - Optional Inngest trigger URL (defaults to local)
 * @returns Result with counts and record IDs
 */
export async function handleCronScraping(
	env: Env,
	inngestUrl?: string,
): Promise<{
	success: boolean;
	scrapedCount: number;
	insertedCount: number;
	newRecordIds: number[];
	errors?: string[];
}> {
	const log = createLogger({ workflowStep: "cf-workers-cron" });

	log.info("Starting Cloudflare Workers cron scraping pipeline");

	try {
		// Step 1: Instagram Scraping
		log.info("Step 1: Instagram scraping started");
		const scrapeResult = await log.time("ig-scrape", () => igScrape(log));

		if (scrapeResult.count === 0) {
			log.info("No posts scraped, exiting early");
			return {
				success: true,
				scrapedCount: 0,
				insertedCount: 0,
				newRecordIds: [],
			};
		}

		log.info("Instagram scraping completed", {
			count: scrapeResult.count,
			errors: scrapeResult.errors?.length,
		});

		// Step 2: Upload to R2
		log.info("Step 2: Uploading images to R2");
		const uploadedPosts = await log.time("r2-upload", () =>
			uploadToR2(scrapeResult.posts, env, undefined, log),
		);

		log.info("R2 upload completed", { count: uploadedPosts.length });

		// Step 3: Insert to Database
		log.info("Step 3: Inserting to database");
		const insertResult = await log.time("db-insert", () =>
			insertToDb(uploadedPosts, env, log),
		);

		// Handle error case
		if (!insertResult || typeof insertResult !== "object") {
			log.error("Database insert returned invalid result");
			return {
				success: false,
				scrapedCount: scrapeResult.count,
				insertedCount: 0,
				newRecordIds: [],
				errors: ["Invalid insert result"],
			};
		}

		// Check if insertResult has count property
		const insertCount = "count" in insertResult ? (insertResult.count as number) : 0;
		const newRecordIds =
			"newRecordIds" in insertResult ? (insertResult.newRecordIds as number[]) : [];

		log.info("Database insert completed", {
			count: insertCount,
			newRecordIds: newRecordIds.length,
		});

		// Skip triggering Inngest if no new records
		if (insertCount === 0 || newRecordIds.length === 0) {
			log.info("No new records inserted, skipping Inngest trigger");
			return {
				success: true,
				scrapedCount: scrapeResult.count,
				insertedCount: 0,
				newRecordIds: [],
			};
		}

		// Step 4: Trigger Inngest for batch processing
		log.info("Step 4: Triggering Inngest batch processing", {
			recordIds: newRecordIds,
		});

		const triggerUrl =
			inngestUrl || env.INNGEST_TRIGGER_URL || "http://localhost:8788/api/trigger-inngest";

		const triggerResult = await log.time("inngest-trigger", async () => {
			return await fetch(triggerUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(env.INNGEST_API_KEY ? { Authorization: `Bearer ${env.INNGEST_API_KEY}` } : {}),
				},
				body: JSON.stringify({
					recordIds: newRecordIds,
					source: "instagram",
					// Note: env is no longer sent in payload - accessed via ctx.env in the function
				}),
			});
		});

		if (!triggerResult.ok) {
			const errorText = await triggerResult.text();
			log.error("Failed to trigger Inngest", {
				status: triggerResult.status,
				error: errorText,
			});
			return {
				success: false,
				scrapedCount: scrapeResult.count,
				insertedCount: insertCount,
				newRecordIds,
				errors: [`Inngest trigger failed: ${triggerResult.status}`],
			};
		}

		const triggerData = await triggerResult.json();
		log.info("Inngest triggered successfully", { triggerData });

		return {
			success: true,
			scrapedCount: scrapeResult.count,
			insertedCount: insertCount,
			newRecordIds,
		};
	} catch (error) {
		log.error("Error in cron scraping pipeline", { error });
		return {
			success: false,
			scrapedCount: 0,
			insertedCount: 0,
			newRecordIds: [],
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

/**
 * Export for Cloudflare Workers scheduled event handler
 * Usage in wrangler.jsonc cron triggers
 */
export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const log = createLogger({ workflowStep: "cf-workers-scheduled" });
		log.info("Scheduled event triggered", {
			scheduledTime: event.scheduledTime,
			cron: event.cron,
		});

		// Run in background to avoid timeout
		ctx.waitUntil(handleCronScraping(env));
	},
};
