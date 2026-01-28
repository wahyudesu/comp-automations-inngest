import { load } from "cheerio";
import { createLogger } from "../utils/logger.js";
import type { ScrapeResult } from "./lib/types.js";

const logger = createLogger({ workflowStep: "1-web-scrape" });

const TARGET_URL = "https://www.infolombait.com/" as const;
const IMAGE_LIMIT = 5;

interface ScraperPost {
	title: string;
	link: string;
	image?: string;
	description?: string;
}

interface ScraperResult {
	count: number;
	images: string[];
	posts: ScraperPost[];
}

/** Normalize Blogger image URL to higher resolution */
function normalizeImageUrl(url: string): string {
	return url.replace(/\/s\d+(-c)?\//, "/s1600/");
}

/** Extract URL from CSS background-image style */
function extractBackgroundUrl(style: string): string | null {
	const match = style.match(/url\(([^)]+)\)/i);
	if (!match) return null;
	return match[1].replace(/['"]/g, "").trim();
}

/** Clean description text */
function cleanDescription(text: string): string {
	return text
		.replace(/\s+/g, " ")
		.replace(/\u00a0/g, " ")
		.trim();
}

/** Fetch post description from detail page */
async function fetchPostDescription(link: string): Promise<string> {
	try {
		const response = await fetch(link, {
			headers: { "User-Agent": "Mozilla/5.0" },
		});
		if (!response.ok) return "";
		const html = await response.text();
		const $ = load(html);
		const node = $("div.post-body.entry-content").first();
		if (node && node.length) {
			return cleanDescription(node.text());
		}
		return "";
	} catch {
		return "";
	}
}

export const name = "lombait";

export async function scrape(): Promise<ScraperResult> {
	try {
		const response = await fetch(TARGET_URL, {
			headers: { "User-Agent": "Mozilla/5.0" },
		});

		if (!response.ok) {
			throw new Error("upstream fetch failed");
		}

		const body = await response.text();
		const $ = load(body);

		const imagesArr: string[] = [];
		const posts: ScraperPost[] = [];

		$("#Blog1 .blog-posts .date-outer .thumb a").each((_, el) => {
			if (imagesArr.length >= IMAGE_LIMIT) {
				return false;
			}

			const style = $(el).attr("style") ?? "";
			const rawUrl = extractBackgroundUrl(style);
			if (!rawUrl) return;

			try {
				const abs = new URL(rawUrl, TARGET_URL).toString();
				imagesArr.push(normalizeImageUrl(abs));
			} catch {
				// ignore invalid URLs
			}
		});

		$("h2.post-title.entry-title a").each((i, el) => {
			if (posts.length >= IMAGE_LIMIT) return false;

			const $el = $(el);
			const href = $el.attr("href");
			const title = $el.text().trim();
			if (!href && !title) return;

			try {
				const abs = href ? new URL(href, TARGET_URL).toString() : "";
				posts.push({
					title,
					link: abs,
					image: imagesArr[i] ?? "",
				});
			} catch {
				posts.push({
					title,
					link: href ?? "",
					image: imagesArr[i] ?? "",
				});
			}
		});

		await Promise.all(
			posts.map(async (post) => {
				if (!post.link) return;
				post.description = await fetchPostDescription(post.link);
			}),
		);

		logger.info(`Web scraping completed: ${posts.length} posts fetched`, {
			count: posts.length,
		});

		return {
			count: posts.length,
			images: imagesArr,
			posts,
		};
	} catch (error) {
		logger.error("Web scraping failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
