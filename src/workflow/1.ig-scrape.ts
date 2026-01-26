import { InstagramScraper, ScrapeError } from "@aduptive/instagram-scraper";
import {
  createLogger,
  type EnhancedLogger,
  logError,
  ErrorCategory,
} from "../utils/enhanced-logger.js";
const IMAGE_LIMIT = 4; // ubah sesuai kebutuhan
export const IG_LOMBA = [
  "infolomba.indonesia.id",
  "lomba_mahasiswa",
  "infolombaeventid",
  "infolomba",
  "infolombamahasiswa.id",
  "infolombaevent.id",
  "pusatinfolomba",
] as const;

const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

async function scrapeOnce(log: EnhancedLogger, usernames: readonly string[]) {
  const scraper = new InstagramScraper({
    maxRetries: 2,
    minDelay: 2000,
    maxDelay: 5000,
    timeout: 10000,
    rateLimitPerMinute: 20,
  });

  const allPosts = [];
  const errors: { username: string; error: string; code?: string }[] = [];

  log.startTimer("instagram-scrape-total");

  for (const username of usernames) {
    const accountLog = log.child({
      workflowStep: `1-ig-scrape-${username}`,
    });

    try {
      // Random delay between requests (2-5 seconds)
      const delay = 2000 + Math.random() * 3000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const results = await accountLog.time(
        `instagram-fetch-${username}`,
        async () => await scraper.getPosts(username, IMAGE_LIMIT),
      );

      if (results.success && results.posts) {
        // Filter out posts without required data
        const validPosts = results.posts.filter(
          (post) => post.display_url && post.url,
        );

        accountLog.info("Fetched valid posts", {
          username,
          validCount: validPosts.length,
          totalCount: results.posts.length,
        });

        for (const post of validPosts) {
          allPosts.push({
            title: null,
            link: post.url,
            image: post.display_url,
            description: post.caption || "",
            source: "instagram",
            username: username,
          });
        }
      } else {
        const errorMsg = results.error || "Unknown error";
        errors.push({ username, error: errorMsg, code: errorMsg });
        accountLog.warn(`Failed to fetch posts: ${errorMsg}`, {
          username,
          errorCode: errorMsg,
        });
      }
    } catch (error) {
      let errorMsg = "Unknown error";
      let errorCode: string | undefined;

      if (error instanceof ScrapeError) {
        errorMsg = error.message;
        errorCode = error.code;
      } else if (error instanceof Error) {
        errorMsg = error.message;
      }

      errors.push({ username, error: errorMsg, code: errorCode });

      logError(
        accountLog,
        error instanceof Error ? error : new Error(errorMsg),
        {
          operation: "instagram-scrape",
          category: ErrorCategory.NETWORK,
          recoverable: true,
          metadata: { username, errorCode },
        },
      );
    }
  }

  const totalTime = log.endTimer("instagram-scrape-total");

  return { allPosts, errors, totalTime };
}

export async function scrape(parentLog?: EnhancedLogger) {
  const log = parentLog ?? createLogger({ workflowStep: "1-ig-scrape" });
  const usernames = IG_LOMBA;

  let attempt = 0;
  let lastError: string | undefined;

  while (true) {
    attempt++;

    log.info("Starting Instagram scraping", {
      accountsCount: usernames.length,
      imageLimit: IMAGE_LIMIT,
      attempt,
    });

    const { allPosts, errors, totalTime } = await scrapeOnce(log, usernames);

    // Check if scraping was successful (at least some posts collected)
    const successCount = IG_LOMBA.length - errors.length;
    const isSuccess = allPosts.length > 0 || successCount > 0;

    if (isSuccess) {
      // Summary log
      if (errors.length > 0) {
        log.warn("Some accounts failed during scraping", {
          skippedAccounts: errors.map((e) => e.username),
          errorCount: errors.length,
          successCount,
        });
      }

      log.info("Instagram scraping completed successfully", {
        totalCount: allPosts.length,
        successCount,
        errorCount: errors.length,
        totalDuration: Math.round(totalTime),
        avgDurationPerAccount: Math.round(totalTime / IG_LOMBA.length),
        attempt,
      });

      return {
        count: allPosts.length,
        posts: allPosts,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    // All accounts failed - retry after delay
    lastError = errors.map((e) => `${e.username}: ${e.error}`).join("; ");

    log.warn("Instagram scraping failed completely, retrying...", {
      attempt,
      delayMinutes: RETRY_DELAY_MS / 60000,
      errors,
    });

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
