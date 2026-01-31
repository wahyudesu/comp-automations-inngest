import { Inngest } from "inngest";
import { extractData } from "../workflow/4.data-extraction.js";
import { sendAllToWhatsApp } from "../workflow/6.sending-wa.js";

/**
 * Inngest client configuration
 *
 * This client is used to create and manage workflow functions
 * for the competition automation system.
 */
export const inngest = new Inngest({
	id: "comp-automations",
	eventKey: process.env.INNGEST_EVENT_KEY as string,
});

// ============================================================================
// Batch Processing: Process Draft Records in Batches (Sequential)
// ============================================================================

/**
 * Chunk array into smaller arrays of specified size
 */
function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

/**
 * Format field source map for pretty printing
 * Groups fields by their model source
 */
function formatFieldSource(fieldSource: Record<string, string | null>): string {
	const groups: Record<string, string[]> = {
		zai: [],
		mistral: [],
		gemini: [],
	};

	for (const [field, source] of Object.entries(fieldSource)) {
		if (source && groups[source]) {
			groups[source].push(field);
		}
	}

	const parts: string[] = [];
	for (const [model, fields] of Object.entries(groups)) {
		if (fields.length > 0) {
			parts.push(`${model}: ${fields.join(", ")}`);
		}
	}
	return parts.length > 0 ? parts.join(" | ") : "(none)";
}

/**
 * Main Batch Processing Function
 *
 * Called by CF Workers after scraping pipeline completes.
 * Processes draft records in batches of 2 SEQUENTIALLY to avoid CPU timeout.
 *
 * Event: "process/batches.start"
 * Data: { recordIds: number[], source: string, env: Env }
 */
export const processDraftBatchesFn = inngest.createFunction(
	{
		id: "process-draft-batches",
		name: "Process Draft Records in Batches",
		concurrency: 1, // Reduced to 1 to prevent PromiseFulfiller errors from overlapping
	},
	{ event: "process/batches.start" },
	async ({ event, step }) => {
		// Access env from event data (works both in dev and production)
		const env = event.data.env as typeof dummyEnv;
		const { recordIds, source = "unknown" } = event.data;
		const batchSize = 2; // 2 records per batch

		const batches = chunk(recordIds, batchSize);

		// Process each batch SEQUENTIALLY to avoid CPU timeout
		const batchResults: any[] = [];
		for (let index = 0; index < batches.length; index++) {
			const batchIds = batches[index];
			const result = await step.run(`process-batch-${index + 1}`, async () => {
				// Extract AI data for this batch using specific record IDs
				// Pass 0 for newCount since we want specific existing records, not newest ones
				const extractResult = await extractData(0, batchIds, env);

				return {
					batchIndex: index,
					batchIds,
					...extractResult,
				};
			});
			batchResults.push(result);
		}

		// Aggregate results
		const totalProcessed = batchResults.reduce((sum, r) => sum + (r.count || 0), 0);
		const totalErrors = batchResults.filter((r) => !r.success).length;

		// Build structured summary
		const structuredSummary = {
			totalBatches: batches.length,
			totalRecords: recordIds.length,
			totalProcessed,
			totalErrors,
			batches: batchResults.map((batch) => ({
				batchNumber: batch.batchIndex + 1,
				recordIds: batch.batchIds,
				modelUsage: batch.modelUsage || { zai: 0, mistral: 0, gemini: 0 },
				records: (batch.records || []).map((record: any) => ({
					recordId: record.recordId,
					fieldsByModel: record.fieldSource || {},
				})),
			})),
		};

		// Log detailed per-record breakdown
		await step.run("log-detailed-results", async () => {
			console.log("=== Batch Processing Summary ===");
			console.log(`Total batches: ${structuredSummary.totalBatches}`);
			console.log(`Total records: ${structuredSummary.totalRecords}`);
			console.log(`Total processed: ${structuredSummary.totalProcessed}`);
			console.log("");

			for (const batch of structuredSummary.batches) {
				console.log(`[Batch ${batch.batchNumber}] Records: ${batch.recordIds.join(", ")}`);
				const { zai, mistral, gemini } = batch.modelUsage;
				console.log(`  Model usage: Zai(${zai}), Mistral(${mistral}), Gemini(${gemini})`);
				for (const record of batch.records) {
					console.log(`  Record ${record.recordId}:`);
					console.log(`    ${formatFieldSource(record.fieldsByModel)}`);
				}
				console.log("");
			}

			return { structuredSummary };
		});

		// After all batches complete, trigger WhatsApp send
		await step.run("trigger-whatsapp", async () => {
			const whatsappResult = await sendAllToWhatsApp(env);
			return whatsappResult;
		});

		return {
			success: true,
			source,
			...structuredSummary,
		};
	}
);

// ============================================================================
// Invoke Helpers - For Testing & Development
// ============================================================================

/**
 * Create dummy environment data for testing
 *
 * Usage:
 * ```ts
 * import { inngest, dummyEnv } from "./inngest/index.js";
 *
 * // Invoke batch processing
 * await inngest.send({
 *   name: "process/batches.start",
 *   data: {
 *     recordIds: [1, 2, 3, 4],
 *     source: "test",
 *     env: dummyEnv
 *   },
 * });
 * ```
 */
export const dummyEnv = {
	DATABASE_URL: process.env.DATABASE_URL ?? "",
	R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
	R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
	R2_ENDPOINT: process.env.R2_ENDPOINT ?? "https://4c7c10d0a0b9ffcead7f92c375ec9f12.r2.cloudflarestorage.com",
	R2_BUCKET: process.env.R2_BUCKET ?? "bucket-competition",
	R2_PUBLIC_URL: process.env.R2_PUBLIC_URL ?? "https://objectcompetition.wahyuikbal.com",
	WAHA_BASE_URL: process.env.WAHA_BASE_URL ?? "https://waha-qxjcatc8.sumopod.in",
	WAHA_API_KEY: process.env.WAHA_API_KEY ?? "",
	WA_SESSION_ID: process.env.WA_SESSION_ID ?? "session_01jx523c9fdzcaev186szgc67h",
	WHATSAPP_CHANNEL_ID: process.env.WHATSAPP_CHANNEL_ID ?? "120363421736160206@g.us",
} as const;

/**
 * Inngest functions array
 * Export all functions for the Inngest handler
 */
export const functions = [
	processDraftBatchesFn,
];
