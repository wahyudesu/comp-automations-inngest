import postgres from "postgres";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";
import { config } from "./lib/config.js";
import type { DbInsertResult, Env, SkippedCounts } from "./lib/types.js";

interface PostData {
	title?: string | null;
	description?: string | null;
	image?: string | null;
	link?: string | null;
}

export async function insertToDb(
	posts: PostData[],
	env: Env,
	parentLog?: EnhancedLogger,
): Promise<DbInsertResult | { success: false; error: string }> {
	const log = parentLog ?? createLogger({ workflowStep: "3-insert-db" });

	if (!env.DATABASE_URL) {
		log.fatal("DATABASE_URL is not set", undefined, {
			required: true,
			provided: false,
		});
		return { success: false, error: "DATABASE_URL is not set" };
	}

	log.info("Starting database insert with filtering", { postCount: posts.length });

	const dbConfig = config.db;
	const sql = postgres(env.DATABASE_URL, {
		ssl: dbConfig.ssl,
		max: dbConfig.max,
	});

	try {
		const existingData = await sql`
			SELECT urlsource, description
			FROM competitions
			WHERE urlsource IS NOT NULL OR description IS NOT NULL
		`;

		const existingUrls = new Set(existingData.map((r) => r.urlsource).filter(Boolean));
		const existingDescriptions = new Set(
			existingData.map((r) => r.description).filter(Boolean).map((d) => d.trim()),
		);

		log.debug("Existing data in DB", {
			existingUrls: existingUrls.size,
			existingDescriptions: existingDescriptions.size,
		});

		const filteredPosts: PostData[] = [];
		const seenDescriptions = new Set<string>();

		const skipped: SkippedCounts = {
			skippedUrl: 0,
			skippedDescription: 0,
			skippedDuplication: 0,
		};

		for (const post of posts) {
			const urlsource = post.link ?? "";
			const description = (post.description ?? "").trim();

			if (urlsource && existingUrls.has(urlsource)) {
				skipped.skippedUrl++;
				continue;
			}

			if (description && existingDescriptions.has(description)) {
				skipped.skippedDescription++;
				continue;
			}

			if (description && seenDescriptions.has(description)) {
				skipped.skippedDuplication++;
				continue;
			}

			filteredPosts.push(post);
			if (description) {
				seenDescriptions.add(description);
			}
		}

		log.info("Filtering completed", {
			original: posts.length,
			filtered: filteredPosts.length,
			skipped,
		});

		if (filteredPosts.length === 0) {
			log.info("No new posts to insert");
			return {
				success: true,
				count: 0,
				newRecordIds: [],
				skipped,
			};
		}

		log.startTimer("db-insert-total");

		const newRecordIds: number[] = [];

		for (let i = 0; i < filteredPosts.length; i++) {
			const post = filteredPosts[i];
			const postLog = log.child({
				workflowStep: `3-insert-post-${i}`,
			});

			const title = post.title ?? "";
			const description = post.description ?? "";
			const poster = post.image ?? "";
			const urlsource = post.link ?? "";

			const result = await postLog.time(`db-insert-${i}`, async () => {
				return await sql`
					INSERT INTO competitions (
						title,
						description,
						poster,
						urlsource,
						status
					) VALUES (
						${title},
						${description},
						${poster},
						${urlsource},
						'draft'
					)
					RETURNING id
				`;
			});

			if (result && result.length > 0) {
				newRecordIds.push(result[0].id);
			}

			postLog.debug("Inserted draft record", {
				title: title.substring(0, 50),
				index: i + 1,
				total: filteredPosts.length,
				recordId: result[0]?.id,
			});
		}

		const totalTime = log.endTimer("db-insert-total");

		log.info("All posts saved successfully to database", {
			count: filteredPosts.length,
			totalDuration: Math.round(totalTime),
			avgDuration: Math.round(totalTime / filteredPosts.length),
		});

		return {
			success: true,
			count: filteredPosts.length,
			newRecordIds,
			skipped,
		};
	} catch (error) {
		logError(log, error as Error, {
			operation: "db-insert",
			category: ErrorCategory.DATABASE,
			recoverable: false,
			metadata: { postCount: posts.length },
		});
		throw error;
	} finally {
		await sql.end();
	}
}
