import postgres from "postgres";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";
import { config } from "./lib/config.js";
import { buildUpdateObject } from "./lib/db-utils.js";
import type { DbUpdateResult, Env, AIExtractedData } from "./lib/types.js";

interface PostWithAi {
	id: number;
	title?: string | null;
	aiAnalysis?: AIExtractedData | null;
}

export async function saveToDb(
	posts: PostWithAi[],
	env: Env,
	parentLog?: EnhancedLogger,
): Promise<DbUpdateResult | undefined> {
	const log = parentLog ?? createLogger({ workflowStep: "5-update-db" });

	if (!env.DATABASE_URL) {
		log.fatal("DATABASE_URL is not set", undefined, {
			required: true,
			provided: false,
		});
		return;
	}

	const dbConfig = config.db;
	const sql = postgres(env.DATABASE_URL, {
		ssl: dbConfig.ssl,
		max: dbConfig.max,
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

			if (!ai) {
				postLog.debug("Skipping post - no AI analysis", {
					title: post.title?.substring(0, 50),
					index: i + 1,
				});
				skippedCount++;
				continue;
			}

			const updates = buildUpdateObject(ai, sql);

			if (Object.keys(updates).length === 0) {
				postLog.debug("No fields to update", {
					title: post.title?.substring(0, 50),
					index: i + 1,
				});
				skippedCount++;
				continue;
			}

			await postLog.time(`db-update-${i}`, async () => {
				await sql`
					UPDATE competitions
					SET ${sql(updates)}
					WHERE id = ${post.id}
				`;
			});

			updateCount++;
			postLog.debug("Updated post with AI data", {
				title: (ai.title ?? post.title)?.substring(0, 50),
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
		try {
			await sql.end({ timeout: 10 });
		} catch {
			// Ignore cleanup errors
		}
	}
}
