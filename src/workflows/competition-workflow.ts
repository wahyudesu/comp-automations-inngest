import { scrape as igScrape } from "../workflow/1.ig-scrape.js";
import { insertToDb } from "../workflow/3.insertdb.js";
import { createLogger, type EnhancedLogger } from "../utils/enhanced-logger.js";
import type { Env } from "../workflow/lib/types.js";
import { inngest } from "../inngest/index.js";

/**
 * Cloudflare Workers Workflow - Competition Automation
 *
 * Alur: IG Scraping → Upload to R2 → Insert to DB → Trigger Inngest
 *
 * Ini berjalan di Cloudflare Workflows dengan retry otomatis
 * dan step-based execution yang durable.
 */

export interface CompetitionWorkflowParams {
	/** Instagram usernames to scrape (optional, uses config default) */
	accounts?: string[];
	/** Maximum posts per account */
	imageLimit?: number;
}

export interface CompetitionWorkflowResult {
	success: boolean;
	scrapedCount: number;
	insertedCount: number;
	newRecordIds: number[];
	errors?: string[];
}

export class CompetitionAutomationWorkflow {
	// Cloudflare Workflows akan inject env ini
	env!: Env;

	/**
	 * Step 1: Instagram Scraping
	 */
	async step1_scrapeInstagram(params: CompetitionWorkflowParams): Promise<{
		count: number;
		posts: Array<{
			title: string | null;
			link: string;
			image: string;
			description: string;
			source: string;
			username: string;
		}>;
	}> {
		const log = createLogger({ workflowStep: "cf-workflow-step1" });
		log.info("Workflow Step 1: Instagram scraping started", { params });

		const result = await igScrape(log);

		log.info("Workflow Step 1: Instagram scraping completed", {
			count: result.count,
			errors: result.errors?.length,
		});

		return {
			count: result.count,
			posts: result.posts,
		};
	}

	/**
	 * Step 2: Upload Images to R2
	 */
	async step2_uploadToR2(input: {
		posts: Array<{
			title: string | null;
			link: string;
			image: string;
			description: string;
			source: string;
			username: string;
		}>;
	}): Promise<{
		uploadedCount: number;
		posts: Array<{
			title: string | null;
			link: string;
			image: string;
			description: string;
		}>;
	}> {
		const log = createLogger({ workflowStep: "cf-workflow-step2" });
		log.info("Workflow Step 2: Skipping R2 upload (using original IG URLs)", {
			count: input.posts.length,
		});

		// Skip R2 upload for now - use original IG URLs directly due to local dev SSL issues
		const postsForDb = input.posts.map((p) => ({
			title: p.title ?? null,
			link: p.link,
			image: p.image, // Keep original IG URL
			description: p.description || "",
		}));

		return {
			uploadedCount: input.posts.length,
			posts: postsForDb,
		};
	}

	/**
	 * Step 3: Insert to Database
	 */
	async step3_insertToDb(input: {
		posts: Array<{
			title: string | null;
			link: string;
			image: string;
			description: string;
		}>;
	}): Promise<{
		insertedCount: number;
		newRecordIds: number[];
		skipped: {
			skippedUrl: number;
			skippedDescription: number;
			skippedDuplication: number;
		};
	}> {
		const log = createLogger({ workflowStep: "cf-workflow-step3" });
		log.info("Workflow Step 3: Inserting to database", {
			count: input.posts.length,
		});

		const result = await insertToDb(input.posts, this.env, log);

		if (!result || typeof result !== "object" || !("count" in result)) {
			log.error("Database insert returned invalid result");
			throw new Error("Database insert failed");
		}

		const insertCount = result.count as number;
		const newRecordIds = (result.newRecordIds as number[]) || [];
		const skipped = result.skipped || {
			skippedUrl: 0,
			skippedDescription: 0,
			skippedDuplication: 0,
		};

		log.info("Workflow Step 3: Database insert completed", {
			count: insertCount,
			newRecordIds: newRecordIds.length,
			skipped,
		});

		return {
			insertedCount: insertCount,
			newRecordIds,
			skipped,
		};
	}

	/**
	 * Step 4: Trigger Inngest for AI Processing
	 */
	async step4_triggerInngest(input: {
		recordIds: number[];
		source: string;
	}): Promise<{
		triggered: boolean;
		recordCount: number;
	}> {
		const log = createLogger({ workflowStep: "cf-workflow-step4" });
		log.info("Workflow Step 4: Triggering Inngest", {
			recordIds: input.recordIds,
		});

		if (input.recordIds.length === 0) {
			log.info("No new records to process, skipping Inngest trigger");
			return { triggered: false, recordCount: 0 };
		}

		// Prepare env object to send with event (needed for Inngest functions)
		const envForInngest = {
			DATABASE_URL: this.env.DATABASE_URL,
			R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID,
			R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY,
			R2_ENDPOINT: this.env.R2_ENDPOINT,
			R2_BUCKET: this.env.R2_BUCKET,
			R2_PUBLIC_URL: this.env.R2_PUBLIC_URL,
			WAHA_BASE_URL: this.env.WAHA_BASE_URL,
			WAHA_API_KEY: this.env.WAHA_API_KEY,
			WA_SESSION_ID: this.env.WA_SESSION_ID,
			WHATSAPP_CHANNEL_ID: this.env.WHATSAPP_CHANNEL_ID,
		};

		try {
			await inngest.send({
				name: "process/batches.start",
				data: {
					recordIds: input.recordIds,
					source: input.source,
					env: envForInngest,
				},
			});

			log.info("Workflow Step 4: Inngest triggered successfully", {
				recordCount: input.recordIds.length,
			});

			return {
				triggered: true,
				recordCount: input.recordIds.length,
			};
		} catch (error) {
			log.error("Failed to trigger Inngest", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Main Workflow Run - connects all steps
	 */
	async run(params: CompetitionWorkflowParams = {}): Promise<CompetitionWorkflowResult> {
		const log = createLogger({ workflowStep: "cf-workflow-main" });
		log.info("Starting Competition Automation Workflow", { params });

		try {
			// Step 1: Scrape Instagram
			const scrapeResult = await this.step1_scrapeInstagram(params);

			if (scrapeResult.count === 0) {
				log.info("No posts scraped, exiting workflow");
				return {
					success: true,
					scrapedCount: 0,
					insertedCount: 0,
					newRecordIds: [],
				};
			}

			// Step 2: Upload to R2
			const uploadResult = await this.step2_uploadToR2({
				posts: scrapeResult.posts,
			});

			// Step 3: Insert to DB
			const insertResult = await this.step3_insertToDb({
				posts: uploadResult.posts,
			});

			// Step 4: Trigger Inngest
			await this.step4_triggerInngest({
				recordIds: insertResult.newRecordIds,
				source: "instagram",
			});

			return {
				success: true,
				scrapedCount: scrapeResult.count,
				insertedCount: insertResult.insertedCount,
				newRecordIds: insertResult.newRecordIds,
			};
		} catch (error) {
			log.error("Workflow failed", { error });
			return {
				success: false,
				scrapedCount: 0,
				insertedCount: 0,
				newRecordIds: [],
				errors: [error instanceof Error ? error.message : String(error)],
			};
		}
	}
}

// Export untuk Cloudflare Workers binding
export default CompetitionAutomationWorkflow;
