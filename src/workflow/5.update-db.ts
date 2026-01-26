import postgres from "postgres";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";

export async function saveToDb(posts: any[], env: any, parentLog?: EnhancedLogger) {
	const log = parentLog ?? createLogger({ workflowStep: "5-update-db" });

	if (!env.DATABASE_URL) {
		log.fatal("DATABASE_URL is not set", undefined, {
			required: true,
			provided: false,
		});
		return;
	}

	const sql = postgres(env.DATABASE_URL, {
		ssl: "require",
		max: 1, // limit connections for serverless
	});

	try {
		log.info("Starting database update", { postCount: posts.length });

		let updateCount = 0;
		let skippedCount = 0;

		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			const postLog = log.child({
				workflowStep: `5-update-post-${i}`,
			});

			const ai = post.aiAnalysis;

			// Skip if no AI analysis
			if (!ai) {
				postLog.debug("Skipping post - no AI analysis", {
					title: post.title?.substring(0, 50),
					index: i + 1,
				});
				skippedCount++;
				continue;
			}

			// Build update object with only non-null AI fields
			const updates: any = {};
			if (ai.title) updates.title = ai.title;
			if (ai.description) updates.description = ai.description;
			if (ai.organizer) updates.organizer = sql.json(ai.organizer);
			if (ai.categories) updates.categories = sql.json(ai.categories);
			if (ai.level) updates.level = sql.json(ai.level);
			if (ai.startDate) updates.startDate = ai.startDate;
			if (ai.endDate) updates.endDate = ai.endDate;
			if (ai.format) updates.format = ai.format;
			if (ai.participationType) updates.participationType = ai.participationType;
			if (ai.pricing) updates.pricing = sql.json(ai.pricing);
			if (ai.contact) updates.contact = sql.json(ai.contact);
			if (ai.prizePool) updates.prizePool = ai.prizePool;
			if (ai.benefits) updates.benefits = ai.benefits;
			if (ai.location) updates.location = ai.location;

			// Update by id
			await postLog.time(`db-update-${i}`, async () => {
				await sql`
					UPDATE competitions
					SET ${sql(updates)}
					WHERE id = ${post.id}
				`;
			});

			updateCount++;
			postLog.debug("Updated post with AI data", {
				title: (ai.title || post.title)?.substring(0, 50),
				fieldsUpdated: Object.keys(updates).length,
			});
		}

		log.info("Database update completed", {
			updateCount,
			skippedCount,
			totalCount: posts.length,
		});

		return { success: true, count: updateCount, skippedCount };
	} catch (error) {
		logError(log, error as Error, {
			operation: "db-update",
			category: ErrorCategory.DATABASE,
			recoverable: false,
			metadata: { postCount: posts.length },
		});
		throw error;
	} finally {
		await sql.end();
	}
}
