import postgres from "postgres";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";

export async function insertToDb(posts: any[], env: any, parentLog?: EnhancedLogger) {
	const log = parentLog ?? createLogger({ workflowStep: "3-insert-db" });

	if (!env.DATABASE_URL) {
		log.fatal("DATABASE_URL is not set", undefined, {
			required: true,
			provided: false,
		});
		return { success: false, error: "DATABASE_URL is not set" };
	}

	log.info("Starting database insert with filtering", { postCount: posts.length });

	const sql = postgres(env.DATABASE_URL, {
		ssl: "require",
		max: 1, // limit connections for serverless
	});

	try {
		// 1. Get existing urlsource and description from DB
		const existingData = await sql`
			SELECT urlsource, description
			FROM competitions
			WHERE urlsource IS NOT NULL OR description IS NOT NULL
		`;

		const existingUrls = new Set(existingData.map((r) => r.urlsource).filter(Boolean));
		const existingDescriptions = new Set(
			existingData.map((r) => r.description).filter(Boolean).map((d) => d.trim())
		);

		log.debug("Existing data in DB", {
			existingUrls: existingUrls.size,
			existingDescriptions: existingDescriptions.size,
		});

		// 2. Filter and dedupe posts
		const filteredPosts: any[] = [];
		const seenDescriptions = new Set<string>();

		let skippedUrl = 0;
		let skippedDescription = 0;
		let skippedDuplication = 0;

		for (const post of posts) {
			const urlsource = post.link || "";
			const description = (post.description || "").trim();

			// Skip if URL already exists in DB
			if (urlsource && existingUrls.has(urlsource)) {
				skippedUrl++;
				continue;
			}

			// Skip if description already exists in DB
			if (description && existingDescriptions.has(description)) {
				skippedDescription++;
				continue;
			}

			// Skip duplicate description in batch
			if (description && seenDescriptions.has(description)) {
				skippedDuplication++;
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
			skippedUrl,
			skippedDescription,
			skippedDuplication,
		});

		if (filteredPosts.length === 0) {
			log.info("No new posts to insert");
			return { success: true, count: 0, newRecordIds: [], skipped: { skippedUrl, skippedDescription, skippedDuplication } };
		}

		// 3. Insert filtered posts
		log.startTimer("db-insert-total");

		const newRecordIds: number[] = [];

		for (let i = 0; i < filteredPosts.length; i++) {
			const post = filteredPosts[i];
			const postLog = log.child({
				workflowStep: `3-insert-post-${i}`,
			});

			const title = post.title || "";
			const description = post.description || "";
			const poster = post.image || "";
			const urlsource = post.link || "";

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

		return { success: true, count: filteredPosts.length, newRecordIds, skipped: { skippedUrl, skippedDescription, skippedDuplication } };
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
