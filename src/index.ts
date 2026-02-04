import { Hono } from "hono";
import { inngest, functions } from "./inngest/index.js";
import { serve } from "inngest/hono";
// Import workflow class for Cloudflare Workflows binding
import { CompetitionAutomationWorkflow, type Env } from "./workflows/competition-workflow.js";

// Re-export for Cloudflare Workflows (named export required)
export { CompetitionAutomationWorkflow };

const app = new Hono<{ Bindings: Env }>();

// Health check endpoint
app.get("/", (c) => {
	return c.json({ status: "ok", message: "Competition Automation API" });
});

// Cron endpoint: Web scraping (triggered by Cloudflare Workers Cron)
app.get("/cron/web", async (c) => {
	const env = {
		DATABASE_URL: c.env.DATABASE_URL,
		R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
		R2_ENDPOINT: c.env.R2_ENDPOINT,
		R2_BUCKET: c.env.R2_BUCKET,
		R2_PUBLIC_URL: c.env.R2_PUBLIC_URL,
		WAHA_API_KEY: c.env.WAHA_API_KEY,
	};

	await inngest.send({
		name: "workflow/web.start",
		data: { env },
	});

	return c.json({ success: true, message: "Web scraping workflow triggered" });
});

// Cron endpoint: Instagram scraping (triggered by Cloudflare Workers Cron)
app.get("/cron/instagram", async (c) => {
	const env = {
		DATABASE_URL: c.env.DATABASE_URL,
		R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
		R2_ENDPOINT: c.env.R2_ENDPOINT,
		R2_BUCKET: c.env.R2_BUCKET,
		R2_PUBLIC_URL: c.env.R2_PUBLIC_URL,
		WAHA_API_KEY: c.env.WAHA_API_KEY,
	};

	await inngest.send({
		name: "workflow/instagram.start",
		data: { env },
	});

	return c.json({ success: true, message: "Instagram scraping workflow triggered" });
});

// API endpoint: Manually trigger IG scraping pipeline with security
// Usage: GET /api/trigger-scraping?code=YOUR_SECRET_CODE
app.get("/api/trigger-scraping", async (c) => {
	const { code } = c.req.query();

	// Security check
	const secretCode = c.env.SCRAPING_SECRET_CODE || process.env.SCRAPING_SECRET_CODE;
	if (!code || code !== secretCode) {
		return c.json({ success: false, error: "Unauthorized: Invalid or missing code" }, 401);
	}

	// Trigger the workflow using the Workflows API
	try {
		const instance = await c.env.COMPETITION_WORKFLOW.create();
		return c.json({
			success: true,
			message: "Competition workflow triggered",
			instanceId: instance.id,
		});
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}, 500);
	}
});

// API endpoint: Check workflow status
// Usage: GET /api/workflow-status?instanceId=INSTANCE_ID
app.get("/api/workflow-status", async (c) => {
	const { instanceId } = c.req.query();

	if (!instanceId) {
		return c.json({ success: false, error: "instanceId is required" }, 400);
	}

	try {
		const instance = await c.env.COMPETITION_WORKFLOW.get(instanceId);
		const status = await instance.status();
		return c.json({ success: true, status });
	} catch (error) {
		return c.json({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}, 500);
	}
});

// Trigger endpoint: Called by CF Workers after scraping to start batch processing
app.post("/api/trigger-inngest", async (c) => {
	const body = await c.req.json();
	const { recordIds, source, env: bodyEnv } = body;

	// Validate required fields
	if (!recordIds || !Array.isArray(recordIds)) {
		return c.json({ success: false, error: "recordIds array is required" }, 400);
	}

	if (recordIds.length === 0) {
		return c.json({ success: false, error: "recordIds cannot be empty" }, 400);
	}

	// Use provided env or fallback to bindings
	const env = bodyEnv || {
		DATABASE_URL: c.env.DATABASE_URL,
		R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
		R2_ENDPOINT: c.env.R2_ENDPOINT,
		R2_BUCKET: c.env.R2_BUCKET,
		R2_PUBLIC_URL: c.env.R2_PUBLIC_URL,
		WAHA_BASE_URL: c.env.WAHA_BASE_URL,
		WAHA_API_KEY: c.env.WAHA_API_KEY,
		WA_SESSION_ID: c.env.WA_SESSION_ID,
		WHATSAPP_CHANNEL_ID: c.env.WHATSAPP_CHANNEL_ID,
	};

	// Send event to Inngest batch processing function
	await inngest.send({
		name: "process/batches.start",
		data: {
			recordIds,
			source: source || "unknown",
			env,
		},
	});

	return c.json({
		success: true,
		message: "Batch processing triggered",
		recordCount: recordIds.length,
		source,
	});
});

// Inngest serve endpoint for Cloudflare Workers
app.on(["GET", "PUT", "POST"], "/api/inngest",
	serve({
		client: inngest,
		functions,
		signingKey: process.env.INNGEST_SIGNING_KEY as string,
	})
);

// Scheduled handler for Cron Triggers
// This is called by Cloudflare Workers when the cron schedule is triggered
export interface ScheduledEvent {
	scheduledTime: number;
	cron: string;
}

export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

// Export untuk Cloudflare Workers
export default {
	// Hono app for HTTP requests
	fetch: app.fetch,

	// Scheduled handler for cron triggers
	scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		const log = console;
		log.info("Cron trigger received", {
			scheduledTime: event.scheduledTime,
			cron: event.cron,
		});

		// Trigger the CompetitionAutomationWorkflow using Workflows API
		ctx.waitUntil(
			(async () => {
				try {
					// Create a new workflow instance
					const instance = await env.COMPETITION_WORKFLOW.create();
					log.info("Workflow instance created", { instanceId: instance.id });

					// Wait for the workflow to complete
					const result = await instance.output;

					log.info("Workflow completed", { result });

					// Only trigger Inngest if workflow succeeded and has new records
					if (result?.success && result.newRecordIds?.length > 0) {
						log.info("Triggering Inngest batch processing", {
							recordCount: result.newRecordIds.length,
						});

						// Trigger Inngest in the background (don't block)
						ctx.waitUntil(
							inngest
								.send({
									name: "process/batches.start",
									data: {
										recordIds: result.newRecordIds,
										source: "instagram",
										env: {
											DATABASE_URL: env.DATABASE_URL,
											R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
											R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
											R2_ENDPOINT: env.R2_ENDPOINT,
											R2_BUCKET: env.R2_BUCKET,
											R2_PUBLIC_URL: env.R2_PUBLIC_URL,
											WAHA_BASE_URL: env.WAHA_BASE_URL,
											WAHA_API_KEY: env.WAHA_API_KEY,
											WA_SESSION_ID: env.WA_SESSION_ID,
											WHATSAPP_CHANNEL_ID: env.WHATSAPP_CHANNEL_ID,
										},
									},
								})
								.catch((error) => {
									log.error("Failed to send event to Inngest", { error });
								})
						);
					}
				} catch (error) {
					log.error("Workflow failed", { error });
				}
			})()
		);
	},
};
