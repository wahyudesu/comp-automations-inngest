import { runParallelPipelines } from "../workflow/1.parallel-scrape.js";
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
 * Runs parallel scraping pipelines: (IG + Web) → R2 → DB → Trigger Inngest
 * Each source (IG, infolombaid, infolombait) runs independently in parallel.
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

	log.info("Starting parallel scraping pipelines (IG + Web)");

	try {
		// Run all pipelines in parallel (IG, infolombaid, infolombait)
		const pipelineResult = await log.time("parallel-pipelines", () =>
			runParallelPipelines(env, log),
		);

		const { totalScraped, totalInserted, totalNewRecordIds, allErrors } = pipelineResult;

		log.info("All pipelines completed", {
			totalScraped,
			totalInserted,
			newRecordIdsCount: totalNewRecordIds.length,
			errorsCount: allErrors.length,
		});

		// Skip triggering Inngest if no new records
		if (totalNewRecordIds.length === 0) {
			log.info("No new records inserted, skipping Inngest trigger");
			return {
				success: true,
				scrapedCount: totalScraped,
				insertedCount: totalInserted,
				newRecordIds: [],
			};
		}

		// Trigger Inngest for batch processing
		log.info("Triggering Inngest batch processing", {
			recordIds: totalNewRecordIds,
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
					recordIds: totalNewRecordIds,
					source: "parallel-scrape",
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
				scrapedCount: totalScraped,
				insertedCount: totalInserted,
				newRecordIds: totalNewRecordIds,
				errors: allErrors.concat([`Inngest trigger failed: ${triggerResult.status}`]),
			};
		}

		const triggerData = await triggerResult.json();
		log.info("Inngest triggered successfully", { triggerData });

		return {
			success: true,
			scrapedCount: totalScraped,
			insertedCount: totalInserted,
			newRecordIds: totalNewRecordIds,
			errors: allErrors.length > 0 ? allErrors : undefined,
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
