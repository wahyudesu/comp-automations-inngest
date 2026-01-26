import postgres from "postgres";
import {
	createLogger,
	type EnhancedLogger,
	logError,
	ErrorCategory,
} from "../utils/enhanced-logger.js";

interface Competition {
	id: string;
	title: string;
	poster: string;
	level: string[] | null;
	url: string;
	endDate: string | null;
}

// Hardcoded WhatsApp configuration
const WAHA_BASE_URL = "https://waha-qxjcatc8.sumopod.in";
const WAHA_API_KEY = "nxYLkYFvsjs6BG5j5C6cYK7KpDxuZUQg";
const WHATSAPP_CHANNEL_ID = "120363421736160206@g.us";
const WA_SESSION = "session_01jx523c9fdzcaev186szgc67h";

/**
 * Send ALL competitions with status 'draft' to WhatsApp channel
 * Only sends competitions that have BOTH title AND poster
 */
export async function sendAllToWhatsApp(env: any, parentLog?: EnhancedLogger) {
	const log = parentLog ?? createLogger({ workflowStep: "6-whatsapp" });

	if (!env.DATABASE_URL) {
		log.fatal("DATABASE_URL is not set", undefined, {
			required: true,
			provided: false,
		});
		return { sent: 0, skipped: 0 };
	}

	const sql = postgres(env.DATABASE_URL, { ssl: "require", max: 1 });

	try {
		log.info("Fetching all draft competitions from database");

		// Fetch ALL competitions with status 'draft' that have title AND poster
		// Filter: endDate must be NULL or >= today (skip expired competitions)
		const comps = await log.time("db-fetch-all", async () =>
			await sql<Competition[]>`
				SELECT id, title, poster, level, url, "endDate"
				FROM competitions
				WHERE status = 'draft'
					AND title IS NOT NULL
					AND title != ''
					AND poster IS NOT NULL
					AND poster != ''
					AND ("endDate" IS NULL OR "endDate" >= CURRENT_DATE)
				ORDER BY id ASC
			`
		);

		if (!comps.length) {
			log.warn("No competitions with status 'draft' found (with title + poster)");
			return { sent: 0, skipped: 0 };
		}

		log.info("Found competitions to send", { count: comps.length });

		let sent = 0,
			skipped = 0;

		for (let i = 0; i < comps.length; i++) {
			const comp = comps[i];
			const compLog = log.child({
				workflowStep: `6-send-comp-${comp.id}`,
			});

			compLog.debug("Processing competition", {
				title: comp.title,
				index: i + 1,
				total: comps.length,
			});

			try {
				// Level: kosongin jika null/empty
				const level =
					Array.isArray(comp.level) && comp.level.length > 0
						? comp.level.join(", ")
						: "";

				// Format deadline: "20 Desember" dari "2025-12-20"
				let deadline = "";
				if (comp.endDate) {
					const date = new Date(comp.endDate);
					deadline = new Intl.DateTimeFormat("id-ID", {
						day: "numeric",
						month: "long",
					}).format(date);
				}

				const filename = comp.poster.split("/").pop() || "image.jpg";

				// Build caption
				let caption = `*${comp.title}*\n`;
				if (level) caption += `\n🎓 ${level}`;
				if (deadline) caption += `\n⏰ Deadline: ${deadline}`;
				caption += `\n`;
				if (comp.url) caption += `\n${comp.url}`;

				compLog.debug("Sending to WhatsApp API", {
					title: comp.title,
					hasLevel: !!level,
					hasDeadline: !!deadline,
					hasUrl: !!comp.url,
				});

				const response = await compLog.time(
					`whatsapp-send-${comp.id}`,
					async () =>
						await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Api-Key": WAHA_API_KEY,
							},
							body: JSON.stringify({
								session: WA_SESSION,
								chatId: WHATSAPP_CHANNEL_ID,
								file: {
									mimetype: "image/jpeg",
									filename,
									url: comp.poster,
								},
								reply_to: null,
								caption,
							}),
						})
				);

				const result = await response.text();

				if (!response.ok) {
					throw new Error(`WAHA returned ${response.status}: ${result}`);
				}

				// Update status to 'published'
				await compLog.time(`db-update-${comp.id}`, async () => {
					await sql`UPDATE competitions SET status = 'published', "updatedAt" = NOW() WHERE id = ${comp.id}`;
				});

				compLog.info("Successfully sent to WhatsApp", {
					title: comp.title,
					responseStatus: response.status,
				});
				sent++;
			} catch (e) {
				logError(compLog, e as Error, {
					operation: "whatsapp-send",
					category: ErrorCategory.NETWORK,
					recoverable: true,
					metadata: { title: comp.title, id: comp.id },
				});
				skipped++;
			}
		}

		log.info("WhatsApp sending completed", {
			sent,
			skipped,
			total: comps.length,
		});

		return { sent, skipped };
	} catch (error) {
		logError(log, error as Error, {
			operation: "whatsapp-batch-send",
			category: ErrorCategory.DATABASE,
			recoverable: false,
		});
		throw error;
	} finally {
		await sql.end();
	}
}

/**
 * Send a RANDOM subset of competitions with status 'draft' to WhatsApp channel
 * Only sends competitions that have BOTH title AND poster
 */
export async function sendRandomToWhatsApp(
	env: any,
	limit: number,
	parentLog?: EnhancedLogger,
) {
	const log = parentLog ?? createLogger({ workflowStep: "6-whatsapp-random" });

	if (!env.DATABASE_URL) {
		log.fatal("DATABASE_URL is not set", undefined, {
			required: true,
			provided: false,
		});
		return { sent: 0, skipped: 0 };
	}

	const sql = postgres(env.DATABASE_URL, { ssl: "require", max: 1 });

	try {
		log.info("Fetching draft competitions from database for random selection");

		// Fetch ALL competitions with status 'draft' that have title AND poster
		// Filter: endDate must be NULL or >= today (skip expired competitions)
		const comps = await log.time("db-fetch-all", async () =>
			await sql<Competition[]>`
				SELECT id, title, poster, level, url, "endDate"
				FROM competitions
				WHERE status = 'draft'
					AND title IS NOT NULL
					AND title != ''
					AND poster IS NOT NULL
					AND poster != ''
					AND ("endDate" IS NULL OR "endDate" >= CURRENT_DATE)
				ORDER BY id ASC
			`
		);

		if (!comps.length) {
			log.warn("No competitions with status 'draft' found (with title + poster)");
			return { sent: 0, skipped: 0 };
		}

		log.info("Found competitions, selecting random subset", {
			total: comps.length,
			limit,
		});

		// Shuffle array and select first 'limit' items
		const shuffled = [...comps].sort(() => Math.random() - 0.5);
		const selected = shuffled.slice(0, limit);

		log.info("Selected competitions to send", { count: selected.length });

		let sent = 0,
			skipped = 0;

		for (let i = 0; i < selected.length; i++) {
			const comp = selected[i];
			const compLog = log.child({
				workflowStep: `6-send-comp-${comp.id}`,
			});

			compLog.debug("Processing competition", {
				title: comp.title,
				index: i + 1,
				total: selected.length,
			});

			try {
				// Level: kosongin jika null/empty
				const level =
					Array.isArray(comp.level) && comp.level.length > 0
						? comp.level.join(", ")
						: "";

				// Format deadline: "20 Desember" dari "2025-12-20"
				let deadline = "";
				if (comp.endDate) {
					const date = new Date(comp.endDate);
					deadline = new Intl.DateTimeFormat("id-ID", {
						day: "numeric",
						month: "long",
					}).format(date);
				}

				const filename = comp.poster.split("/").pop() || "image.jpg";

				// Build caption
				let caption = `*${comp.title}*\n`;
				if (level) caption += `\n🎓 ${level}`;
				if (deadline) caption += `\n⏰ Deadline: ${deadline}`;
				caption += `\n`;
				if (comp.url) caption += `\n${comp.url}`;

				compLog.debug("Sending to WhatsApp API", {
					title: comp.title,
					hasLevel: !!level,
					hasDeadline: !!deadline,
					hasUrl: !!comp.url,
				});

				const response = await compLog.time(
					`whatsapp-send-${comp.id}`,
					async () =>
						await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Api-Key": WAHA_API_KEY,
							},
							body: JSON.stringify({
								session: WA_SESSION,
								chatId: WHATSAPP_CHANNEL_ID,
								file: {
									mimetype: "image/jpeg",
									filename,
									url: comp.poster,
								},
								reply_to: null,
								caption,
							}),
						})
				);

				const result = await response.text();

				if (!response.ok) {
					throw new Error(`WAHA returned ${response.status}: ${result}`);
				}

				// Update status to 'published'
				await compLog.time(`db-update-${comp.id}`, async () => {
					await sql`UPDATE competitions SET status = 'published', "updatedAt" = NOW() WHERE id = ${comp.id}`;
				});

				compLog.info("Successfully sent to WhatsApp", {
					title: comp.title,
					responseStatus: response.status,
				});
				sent++;
			} catch (e) {
				logError(compLog, e as Error, {
					operation: "whatsapp-send",
					category: ErrorCategory.NETWORK,
					recoverable: true,
					metadata: { title: comp.title, id: comp.id },
				});
				skipped++;
			}
		}

		log.info("WhatsApp random sending completed", {
			sent,
			skipped,
			total: selected.length,
		});

		return { sent, skipped };
	} catch (error) {
		logError(log, error as Error, {
			operation: "whatsapp-batch-send",
			category: ErrorCategory.DATABASE,
			recoverable: false,
		});
		throw error;
	} finally {
		await sql.end();
	}
}
