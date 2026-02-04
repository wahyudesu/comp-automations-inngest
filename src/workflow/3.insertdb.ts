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

		const existingUrls = new Set(
			existingData.map((r) => r.urlsource).filter((u): u is string => typeof u === "string"),
		);
		const existingDescriptions = new Set(
			existingData
				.map((r) => r.description)
				.filter((d): d is string => typeof d === "string" && d.trim() !== "")
				.map((d) => d.trim()),
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
			const urlsource = typeof post.link === "string" ? post.link : "";
			const description =
				typeof post.description === "string" ? post.description.trim() : "";

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

		// Use batch INSERT to reduce subrequest count (single query instead of N queries)
		const insertValues = filteredPosts.map((post) => [
			typeof post.title === "string" ? post.title : "",
			typeof post.description === "string" ? post.description : "",
			typeof post.image === "string" ? post.image : "",
			typeof post.link === "string" ? post.link : "",
			"draft",
		]);

		const result = await log.time(`db-insert-batch`, async () => {
			return await sql`
				INSERT INTO competitions (
					title,
					description,
					poster,
					urlsource,
					status
				) SELECT * FROM ${sql(insertValues)}
				RETURNING id
			`;
		});

		const newRecordIds = result.map((r) => r.id);

		const totalTime = log.endTimer("db-insert-total");

		log.info("All posts saved successfully to database", {
			count: newRecordIds.length,
			totalDuration: Math.round(totalTime),
			avgDuration: newRecordIds.length > 0 ? Math.round(totalTime / newRecordIds.length) : 0,
		});

		return {
			success: true,
			count: newRecordIds.length,
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
