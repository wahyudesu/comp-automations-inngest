import { scrape as igScrape } from "../workflow/1.ig-scrape.js";
import { uploadToR2 } from "../workflow/2.upload-to-r2.js";
import { insertToDb } from "../workflow/3.insertdb.js";
import { createLogger, type EnhancedLogger } from "../utils/enhanced-logger.js";
import type { Env } from "../workflow/lib/types.js";

/**
 * Cloudflare Workers Workflow - Competition Automation
 *
 * Alur: IG Scraping → Upload to R2 → Insert to DB → Trigger Inngest
 *
 * Ini berjalan di Cloudflare Workflows dengan retry otomatis
 * dan step-based execution yang durable.
 *
 * Step 2 (R2 Upload) sekarang AKTIF - gambar akan diupload ke Cloudflare R2
 * dan URL di database akan berupa R2 public URL (bukan URL Instagram asli).
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
		log.info("Workflow Step 2: Uploading images to R2", {
			count: input.posts.length,
		});

		// Upload to R2 - returns posts with R2 URLs (or original if upload fails)
		const uploadedPosts = await uploadToR2(input.posts, this.env, {}, log);

		const postsForDb = uploadedPosts.map((p) => ({
			title: p.title ?? null,
			link: p.link,
			image: p.image, // Now R2 URL (or original if upload failed)
			description: p.description || "",
		}));

		log.info("Workflow Step 2: R2 upload completed", {
			total: postsForDb.length,
		});

		return {
			uploadedCount: postsForDb.length,
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
	 * Main Workflow Run - connects all steps
	 * Note: Inngest trigger is now handled by scheduled handler using waitUntil
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

			// Inngest trigger is now handled by scheduled handler (src/index.ts)
			// using waitUntil to prevent PromiseFulfiller errors

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
