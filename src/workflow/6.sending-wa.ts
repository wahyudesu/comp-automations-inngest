import postgres from "postgres";
import {
  createLogger,
  type EnhancedLogger,
  logError,
  ErrorCategory,
} from "../utils/enhanced-logger.js";
import { config, type WhatsAppConfig } from "./lib/config.js";
import type { WhatsAppSendResult, Env } from "./lib/types.js";

interface Competition {
  id: string;
  title: string;
  poster: string;
  level: string[] | null;
  url: string;
  endDate: string | null;
}

const DATE_LOCALE = "id-ID";

function formatDeadline(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: "numeric",
    month: "long",
  }).format(date);
}

function buildCaption(
  competition: Competition,
  levelStr: string,
  deadlineStr: string,
): string {
  let caption = `*${competition.title}*\n`;
  if (levelStr) caption += `\n🎓 ${levelStr}`;
  if (deadlineStr) caption += `\n⏰ Deadline: ${deadlineStr}`;
  caption += `\n`;
  if (competition.url) caption += `\n${competition.url}`;
  return caption;
}

async function sendSingleCompetition(
  comp: Competition,
  waConfig: WhatsAppConfig,
  sql: ReturnType<typeof postgres>,
  postLog: EnhancedLogger,
): Promise<boolean> {
  const level =
    Array.isArray(comp.level) && comp.level.length > 0
      ? comp.level.join(", ")
      : "";

  const deadline = comp.endDate ? formatDeadline(comp.endDate) : "";
  const filename = comp.poster.split("/").pop() ?? "image.jpg";
  const caption = buildCaption(comp, level, deadline);

  postLog.debug("Sending to WhatsApp API", {
    title: comp.title,
    hasLevel: !!level,
    hasDeadline: !!deadline,
    hasUrl: !!comp.url,
    channelCount: waConfig.channelIds.length,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (waConfig.apiKey) {
    headers["X-Api-Key"] = waConfig.apiKey;
  }

  // Send to all channel IDs
  const sendPromises = waConfig.channelIds.map((chatId) =>
    postLog.time(
      `whatsapp-send-${comp.id}-${chatId}`,
      async () =>
        await fetch(`${waConfig.baseUrl}/api/sendImage`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            session: waConfig.sessionId,
            chatId,
            file: {
              mimetype: "image/jpeg",
              filename,
              url: comp.poster,
            },
            reply_to: null,
            caption,
          }),
        }),
    ),
  );

  const responses = await Promise.allSettled(sendPromises);

  // Check if any send failed
  const failedSends = responses.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
  );

  if (failedSends.length > 0) {
    const errors = failedSends
      .map((f, i) => {
        if (f.status === "rejected") {
          return `Channel ${waConfig.channelIds[i]}: ${f.reason}`;
        }
        return `Channel ${waConfig.channelIds[i]}: ${f.value.status}`;
      })
      .join("; ");
    throw new Error(`Some WhatsApp sends failed: ${errors}`);
  }

  await postLog.time(`db-update-${comp.id}`, async () => {
    await sql`UPDATE competitions SET "whatsappChannel" = true, "updatedAt" = NOW() WHERE id = ${comp.id}`;
  });

  postLog.info("Successfully sent to WhatsApp", {
    title: comp.title,
    channels: waConfig.channelIds.length,
  });

  return true;
}

async function sendCompetitions(
  comps: Competition[],
  env: Env,
  parentLog?: EnhancedLogger,
): Promise<WhatsAppSendResult> {
  const log = parentLog ?? createLogger({ workflowStep: "6-whatsapp" });

  if (!env.DATABASE_URL) {
    log.fatal("DATABASE_URL is not set", undefined, {
      required: true,
      provided: false,
    });
    return { sent: 0, skipped: 0 };
  }

  const WAHA_BASE_URL = "https://waha-qxjcatc8.sumopod.in";
  const WA_SESSION = "session_01jx523c9fdzcaev186szgc67h";
  const WHATSAPP_CHANNEL_ID = "120363421736160206@g.us";

  const waConfig: WhatsAppConfig = {
    baseUrl: WAHA_BASE_URL,
    apiKey: env.WAHA_API_KEY,
    sessionId: WA_SESSION,
    channelId: WHATSAPP_CHANNEL_ID,
  };

  if (!waConfig.apiKey) {
    log.warn("WAHA_API_KEY not set, skipping WhatsApp send");
    return { sent: 0, skipped: comps.length };
  }

  const dbConfig = config.db;
  const sql = postgres(env.DATABASE_URL, {
    ssl: dbConfig.ssl,
    max: dbConfig.max,
  });

  try {
    log.info("Starting WhatsApp send", { count: comps.length });

    let sent = 0;
    let skipped = 0;

    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i];
      const postLog = log.child({
        workflowStep: `6-send-comp-${comp.id}`,
      });

      postLog.debug("Processing competition", {
        title: comp.title,
        index: i + 1,
        total: comps.length,
      });

      try {
        await sendSingleCompetition(comp, waConfig, sql, postLog);
        sent++;
      } catch (error) {
        logError(postLog, error as Error, {
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

async function fetchDraftCompetitions(
  sql: ReturnType<typeof postgres>,
): Promise<Competition[]> {
  return await sql<Competition[]>`
		SELECT id, title, poster, level, url, "endDate"
		FROM competitions
		WHERE ("whatsappChannel" = false OR "whatsappChannel" IS NULL)
			AND title IS NOT NULL
			AND title != ''
			AND poster IS NOT NULL
			AND poster != ''
			AND ("endDate" IS NULL OR "endDate" >= CURRENT_DATE)
		ORDER BY id ASC
	`;
}

/**
 * Send ALL competitions with whatsappChannel = false to WhatsApp channel.
 * Only sends competitions that have BOTH title AND poster.
 */
export async function sendAllToWhatsApp(
  env: Env,
  parentLog?: EnhancedLogger,
): Promise<WhatsAppSendResult> {
  const log = parentLog ?? createLogger({ workflowStep: "6-whatsapp" });

  if (!env.DATABASE_URL) {
    log.fatal("DATABASE_URL is not set", undefined, {
      required: true,
      provided: false,
    });
    return { sent: 0, skipped: 0 };
  }

  const dbConfig = config.db;
  const sql = postgres(env.DATABASE_URL, {
    ssl: dbConfig.ssl,
    max: dbConfig.max,
  });

  try {
    log.info(
      "Fetching competitions with whatsappChannel = false from database",
    );

    const comps = await log.time("db-fetch-all", async () =>
      fetchDraftCompetitions(sql),
    );

    if (!comps.length) {
      log.warn(
        "No competitions to send (whatsappChannel = false with title + poster)",
      );
      return { sent: 0, skipped: 0 };
    }

    log.info("Found competitions to send", { count: comps.length });

    await sql.end();

    return sendCompetitions(comps, env, log);
  } catch (error) {
    logError(log, error as Error, {
      operation: "whatsapp-fetch-competitions",
      category: ErrorCategory.DATABASE,
      recoverable: false,
    });
    await sql.end();
    throw error;
  }
}

/**
 * Send a RANDOM subset of competitions with whatsappChannel = false to WhatsApp channel.
 * Only sends competitions that have BOTH title AND poster.
 */
export async function sendRandomToWhatsApp(
  env: Env,
  limit: number,
  parentLog?: EnhancedLogger,
): Promise<WhatsAppSendResult> {
  const log = parentLog ?? createLogger({ workflowStep: "6-whatsapp-random" });

  if (!env.DATABASE_URL) {
    log.fatal("DATABASE_URL is not set", undefined, {
      required: true,
      provided: false,
    });
    return { sent: 0, skipped: 0 };
  }

  const dbConfig = config.db;
  const sql = postgres(env.DATABASE_URL, {
    ssl: dbConfig.ssl,
    max: dbConfig.max,
  });

  try {
    log.info(
      "Fetching competitions with whatsappChannel = false from database for random selection",
    );

    const comps = await log.time("db-fetch-all", async () =>
      fetchDraftCompetitions(sql),
    );

    if (!comps.length) {
      log.warn(
        "No competitions to send (whatsappChannel = false with title + poster)",
      );
      return { sent: 0, skipped: 0 };
    }

    log.info("Found competitions, selecting random subset", {
      total: comps.length,
      limit,
    });

    const shuffled = [...comps].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, limit);

    log.info("Selected competitions to send", { count: selected.length });

    await sql.end();

    return sendCompetitions(selected, env, log);
  } catch (error) {
    logError(log, error as Error, {
      operation: "whatsapp-fetch-random",
      category: ErrorCategory.DATABASE,
      recoverable: false,
    });
    await sql.end();
    throw error;
  }
}
