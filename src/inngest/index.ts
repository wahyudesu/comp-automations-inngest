import { Inngest } from "inngest";
import { scrape as webScrape } from "../workflow/1.web-scrape.js";
import { scrape as igScrape } from "../workflow/1.ig-scrape.js";
import { uploadToR2 } from "../workflow/2.upload-to-r2.js";
import { insertToDb } from "../workflow/3.insertdb.js";
import { extractData } from "../workflow/4.data-extraction.js";
import { saveToDb } from "../workflow/5.update-db.js";
import { sendAllToWhatsApp } from "../workflow/6.sending-wa.js";

/**
 * Inngest client configuration
 *
 * This client is used to create and manage workflow functions
 * for the competition automation system.
 */
export const inngest = new Inngest({
	id: "comp-automations",
});

// ============================================================================
// Step 1: Web Scrape from infolombait.com
// ============================================================================
export const webScrapeFn = inngest.createFunction(
	{
		id: "web-scrape",
		name: "Web Scrape - Infolombait",
	},
	{ event: "scrape/web.start" },
	async ({ step }) => {
		const result = await step.run("scrape-web", async () => {
			return await webScrape();
		});
		return {
			source: "web",
			count: result.count,
			posts: result.posts,
		};
	}
);

// ============================================================================
// Step 1 (Alternate): Instagram Scrape
// ============================================================================
export const igScrapeFn = inngest.createFunction(
	{
		id: "ig-scrape",
		name: "Instagram Scrape",
	},
	{ event: "scrape/instagram.start" },
	async ({ step }) => {
		const result = await step.run("scrape-instagram", async () => {
			return await igScrape();
		});
		return {
			source: "instagram",
			count: result.count,
			posts: result.posts,
			errors: result.errors,
		};
	}
);

// ============================================================================
// Step 2: Upload Images to R2
// ============================================================================
export const uploadToR2Fn = inngest.createFunction(
	{
		id: "upload-to-r2",
		name: "Upload Images to R2",
	},
	{ event: "upload/r2.start" },
	async ({ event, step }) => {
		const { posts, env } = event.data;

		const result = await step.run("upload-images", async () => {
			return await uploadToR2(posts, env);
		});

		return {
			uploadedPosts: result,
			count: result.length,
		};
	}
);

// ============================================================================
// Step 3: Insert to Database
// ============================================================================
export const insertToDbFn = inngest.createFunction(
	{
		id: "insert-to-db",
		name: "Insert Posts to Database",
	},
	{ event: "db/insert.start" },
	async ({ event, step }) => {
		const { posts, env } = event.data;

		const result = await step.run("insert-db", async () => {
			return await insertToDb(posts, env);
		});

		// Handle union type - check if success with count
		if (result && "count" in result && typeof result.count === "number") {
			return {
				success: result.success,
				count: result.count,
				newRecordIds: result.newRecordIds,
				skipped: result.skipped,
			};
		}

		// Error case
		return {
			success: false,
			count: 0,
			newRecordIds: [],
			skipped: { skippedUrl: 0, skippedDescription: 0, skippedDuplication: 0 },
		};
	}
);

// ============================================================================
// Step 4: AI Data Extraction
// ============================================================================
export const extractDataFn = inngest.createFunction(
	{
		id: "ai-data-extraction",
		name: "AI Data Extraction from Posts",
	},
	{ event: "extract/ai.start" },
	async ({ event, step }) => {
		const { newCount, existingIds, env } = event.data;

		const result = await step.run("extract-ai-data", async () => {
			return await extractData(newCount, existingIds || [], env);
		});

		return {
			success: result.success,
			count: result.count,
			modelUsage: result.modelUsage,
			totalDuration: result.totalDuration,
		};
	}
);

// ============================================================================
// Step 5: Update Database with AI Data
// ============================================================================
export const updateDbFn = inngest.createFunction(
	{
		id: "update-db",
		name: "Update Database with AI Data",
	},
	{ event: "db/update.start" },
	async ({ event, step }) => {
		const { posts, env } = event.data;

		const result = await step.run("update-db", async () => {
			return await saveToDb(posts, env);
		});

		// Handle null return
		if (!result) {
			return {
				success: false,
				count: 0,
				skippedCount: 0,
			};
		}

		return {
			success: result.success ?? false,
			count: result.count ?? 0,
			skippedCount: result.skippedCount ?? 0,
		};
	}
);

// ============================================================================
// Step 6: Send to WhatsApp (All)
// ============================================================================
export const sendWhatsAppFn = inngest.createFunction(
	{
		id: "send-whatsapp",
		name: "Send All to WhatsApp",
	},
	{ event: "whatsapp/send.start" },
	async ({ event, step }) => {
		const { env } = event.data;

		const result = await step.run("send-whatsapp", async () => {
			return await sendAllToWhatsApp(env);
		});

		return {
			sent: result.sent,
			skipped: result.skipped,
		};
	}
);

// ============================================================================
// Main Workflow: Complete Competition Automation (Web Source)
// ============================================================================
export const competitionWorkflowWeb = inngest.createFunction(
	{
		id: "competition-workflow-web",
		name: "Competition Automation - Web Source",
	},
	{ event: "workflow/web.start" },
	async ({ event, step }) => {
		const env = event.data.env;

		// Step 1: Scrape web
		const scrapedData = await step.run("scrape-web", async () => {
			return await webScrape();
		});

		// Step 2: Upload images to R2
		const uploadedPosts = await step.run("upload-to-r2", async () => {
			return await uploadToR2(scrapedData.posts, env);
		});

		// Step 3: Insert to database
		const insertResult = await step.run("insert-to-db", async () => {
			return await insertToDb(uploadedPosts, env);
		});

		// Get count with fallback for error case
		const insertCount = (insertResult && "count" in insertResult) ? insertResult.count : 0;

		// Skip remaining steps if no new records
		if (insertCount === 0) {
			return {
				success: true,
				message: "No new records to process",
				scrapedCount: scrapedData.count,
				insertedCount: 0,
			};
		}

		// Step 4: AI data extraction
		const extractResult = await step.run("ai-extraction", async () => {
			return await extractData(insertCount, [], env);
		});

		// Step 5: Update database with AI data
		const updateResult = await step.run("update-db", async () => {
			return await saveToDb(extractResult.posts || [], env);
		});

		// Step 6: Send to WhatsApp
		const whatsappResult = await step.run("send-whatsapp", async () => {
			return await sendAllToWhatsApp(env);
		});

		return {
			success: true,
			scrapedCount: scrapedData.count,
			insertedCount: insertCount,
			extractedCount: extractResult.count,
			sentCount: whatsappResult.sent,
			modelUsage: extractResult.modelUsage,
		};
	}
);

// ============================================================================
// Main Workflow: Complete Competition Automation (Instagram Source)
// ============================================================================
export const competitionWorkflowIG = inngest.createFunction(
	{
		id: "competition-workflow-ig",
		name: "Competition Automation - Instagram Source",
	},
	{ event: "workflow/instagram.start" },
	async ({ event, step }) => {
		const env = event.data.env;

		// Step 1: Scrape Instagram
		const scrapedData = await step.run("scrape-instagram", async () => {
			return await igScrape();
		});

		// Step 2: Upload images to R2
		const uploadedPosts = await step.run("upload-to-r2", async () => {
			return await uploadToR2(scrapedData.posts, env);
		});

		// Step 3: Insert to database
		const insertResult = await step.run("insert-to-db", async () => {
			return await insertToDb(uploadedPosts, env);
		});

		// Get count with fallback for error case
		const insertCount = (insertResult && "count" in insertResult) ? insertResult.count : 0;

		// Skip remaining steps if no new records
		if (insertCount === 0) {
			return {
				success: true,
				message: "No new records to process",
				scrapedCount: scrapedData.count,
				insertedCount: 0,
			};
		}

		// Step 4: AI data extraction
		const extractResult = await step.run("ai-extraction", async () => {
			return await extractData(insertCount, [], env);
		});

		// Step 5: Update database with AI data
		const updateResult = await step.run("update-db", async () => {
			return await saveToDb(extractResult.posts || [], env);
		});

		// Step 6: Send to WhatsApp
		const whatsappResult = await step.run("send-whatsapp", async () => {
			return await sendAllToWhatsApp(env);
		});

		return {
			success: true,
			scrapedCount: scrapedData.count,
			insertedCount: insertCount,
			extractedCount: extractResult.count,
			sentCount: whatsappResult.sent,
			modelUsage: extractResult.modelUsage,
			errors: scrapedData.errors,
		};
	}
);

// ============================================================================
// Scheduled: Daily Web Scraping Workflow
// ============================================================================
export const scheduledWebWorkflow = inngest.createFunction(
	{
		id: "scheduled-web-workflow",
		name: "Scheduled Daily Web Scraping",
	},
	{ cron: "0 8 * * *" }, // Run daily at 8 AM
	async ({ step }) => {
		// This would need env passed - you might want to use Inngest's env management
		// or fetch from secrets/config
		const result = await step.run("scheduled-scrape", async () => {
			return await webScrape();
		});

		return {
			success: true,
			count: result.count,
		};
	}
);

// ============================================================================
// Scheduled: Daily Instagram Scraping Workflow
// ============================================================================
export const scheduledIGWorkflow = inngest.createFunction(
	{
		id: "scheduled-ig-workflow",
		name: "Scheduled Daily Instagram Scraping",
	},
	{ cron: "0 9 * * *" }, // Run daily at 9 AM
	async ({ step }) => {
		const result = await step.run("scheduled-scrape", async () => {
			return await igScrape();
		});

		return {
			success: true,
			count: result.count,
		};
	}
);

/**
 * Inngest functions array
 * Export all functions for the Inngest handler
 */
export const functions = [
	webScrapeFn,
	igScrapeFn,
	uploadToR2Fn,
	insertToDbFn,
	extractDataFn,
	updateDbFn,
	sendWhatsAppFn,
	competitionWorkflowWeb,
	competitionWorkflowIG,
	scheduledWebWorkflow,
	scheduledIGWorkflow,
];