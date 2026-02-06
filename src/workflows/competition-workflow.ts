import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { scrapeAllSources } from "../workflow/1.parallel-scrape.js";
import { uploadToR2 } from "../workflow/2.upload-to-r2.js";
import { insertToDb } from "../workflow/3.insertdb.js";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";

/**
 * Cloudflare Workers Workflow - Competition Automation
 *
 * Using proper Workflows API with step.do() so each step gets its own subrequest limit.
 *
 * Flow: Parallel Scraping (IG + web sources) → Upload to R2 → Insert to DB
 * Then the scheduled handler triggers Inngest for batch processing.
 */

export interface CompetitionWorkflowParams {
	/** Instagram usernames to scrape (optional, uses config default) */
	accounts?: string[];
	/** Maximum posts per account */
	imageLimit?: number;
}

export type Env = {
	DATABASE_URL: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_ENDPOINT: string;
	R2_BUCKET: string;
	R2_PUBLIC_URL: string;
	MY_BUCKET: R2Bucket;
	WAHA_BASE_URL?: string;
	WAHA_API_KEY: string;
	WA_SESSION_ID?: string;
	WHATSAPP_CHANNEL_ID?: string;
	INNGEST_TRIGGER_URL?: string;
	INNGEST_API_KEY?: string;
	SCRAPING_SECRET_CODE?: string;
	COMPETITION_WORKFLOW: {
		create: () => Promise<{ id: string; output: any }>;
		get: (id: string) => Promise<{ status: () => Promise<string> }>;
	};
};

export interface ScrapedPost {
	title: string | null;
	link: string;
	image: string;
	description: string;
	source: string;
	username: string;
}

export interface PostForDb {
	title: string | null;
	link: string;
	image: string;
	description: string;
}

export class CompetitionAutomationWorkflow extends WorkflowEntrypoint<
	Env,
	CompetitionWorkflowParams
> {
	async run(
		event: WorkflowEvent<CompetitionWorkflowParams>,
		step: WorkflowStep,
	): Promise<{
		success: boolean;
		scrapedCount: number;
		insertedCount: number;
		newRecordIds: number[];
	}> {
		const log = createLogger({ workflowStep: "cf-workflow-main" });
		log.info("[ai] Starting Competition Automation Workflow");

		try {
			// Step 1: Scrape all sources in parallel (IG + web)
			const scrapeResult = await step.do(
				"scrape-all-sources",
				{
					retries: {
						limit: 2,
						delay: "30 seconds",
						backoff: "exponential",
					},
					timeout: "20 minutes",
				},
				async () => {
					log.info("Workflow Step 1: Parallel scraping started");
					const result = await scrapeAllSources(log);
					log.info(`Workflow Step 1: Parallel scraping completed ${result.count} posts`);
					return result;
				},
			);

			if (scrapeResult.count === 0) {
				log.info("No posts scraped, exiting workflow");
				return {
					success: true,
					scrapedCount: 0,
					insertedCount: 0,
					newRecordIds: [],
				};
			}

			// Step 2: Upload to R2 (separate subrequest limit)
			const uploadResult = await step.do(
				"upload-to-r2",
				{
					retries: {
						limit: 2,
						delay: "10 seconds",
						backoff: "exponential",
					},
					timeout: "30 minutes",
				},
				async () => {
					log.info(`Workflow Step 2: Uploading images to R2 ${scrapeResult.posts.length}`);
					const uploadedPosts = await uploadToR2(
						scrapeResult.posts,
						this.env,
						{ maxAttempts: 2 },
						{},
						log,
					);
					log.info(`Workflow Step 2: R2 upload completed ${uploadedPosts.length}`);
					return uploadedPosts;
				},
			);

			// Step 3: Insert to DB (separate subrequest limit)
			const insertResult = await step.do(
				"insert-to-database",
				{
					retries: {
						limit: 3,
						delay: "5 seconds",
						backoff: "exponential",
					},
					timeout: "5 minutes",
				},
				async () => {
					log.info(`Workflow Step 3: Inserting to database ${uploadResult.length}`);
					const result = await insertToDb(uploadResult, this.env, log);

					if (!result || typeof result !== "object" || !("count" in result)) {
						throw new Error("Database insert returned invalid result");
					}

					const count = result.count as number;
					const newRecordIds = (result.newRecordIds as number[]) || [];

					log.info(`Workflow Step 3: Database insert completed ${count} new records`);
					return { count, newRecordIds };
				},
			);

			return {
				success: true,
				scrapedCount: scrapeResult.count,
				insertedCount: insertResult.count,
				newRecordIds: insertResult.newRecordIds,
			};
		} catch (error) {
			logError(log, error as Error, {
				operation: "workflow-main",
				category: ErrorCategory.UNKNOWN,
				recoverable: false,
				metadata: { eventPayload: event.payload },
			});
			throw error;
		}
	}
}

export default CompetitionAutomationWorkflow;
