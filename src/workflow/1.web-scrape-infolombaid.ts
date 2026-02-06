import { load } from "cheerio";
import { createLogger } from "../utils/logger.js";
import type { ScrapeResult, ScrapedPost } from "./lib/types.js";
import { config } from "./lib/config.js";

const logger = createLogger({ workflowStep: "1-web-scrape-infolombaid" });

const TARGET_URL = "https://infolomba.id/" as const;
const IMAGE_LIMIT = config.webScraping.sources.find(s => s.name === "infolombaid")?.imageLimit ?? 5;

interface ScraperPost {
	title: string;
	link: string;
	image?: string;
	description?: string;
}

/** Normalize image URL to absolute */
function normalizeImageUrl(url: string): string {
	if (url.startsWith("http")) {
		return url;
	}
	if (url.startsWith("/")) {
		return `https://infolomba.id${url}`;
	}
	return `https://infolomba.id/${url}`;
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

		// Try to find description in various possible locations
		const selectors = [
			"div.event-description-container",
			"div.event-description",
			"div.description",
			"div.event-content",
			"div.content",
			"div.detail-description",
			"div.post-content",
		];

		for (const selector of selectors) {
			const node = $(selector).first();
			if (node && node.length) {
				const desc = cleanDescription(node.text());
				if (desc.length > 50) {
					return desc.substring(0, 2000); // Limit length
				}
			}
		}

		return "";
	} catch {
		return "";
	}
}

export const name = "infolombaid";

export async function scrape(): Promise<ScrapeResult> {
	try {
		logger.info("Starting web scrape for infolomba.id");

		const response = await fetch(TARGET_URL, {
			headers: { "User-Agent": "Mozilla/5.0" },
		});

		if (!response.ok) {
			throw new Error("upstream fetch failed");
		}

		const body = await response.text();
		const $ = load(body);

		const posts: ScraperPost[] = [];
		const seenLinks = new Set<string>();

		// Find all event containers (regular events)
		$(".event-container").each((_, el) => {
			if (posts.length >= IMAGE_LIMIT) {
				return false;
			}

			const $container = $(el);

			// Get title and link - for regular events, title is in .description h4.event-title a
			const $titleLink = $container.find(".description h4.event-title a").first();
			const title = $titleLink.text().trim();
			let link = $titleLink.attr("href");

			// Get image
			const $img = $container.find("img").first();
			const imageSrc = $img.attr("src");

			if (!title) return;

			// Normalize link
			if (link && !link.startsWith("http")) {
				if (link.startsWith("/")) {
					link = `https://infolomba.id${link}`;
				} else {
					link = `https://infolomba.id/${link}`;
				}
			}

			// Skip if no link or already seen
			if (!link) return;
			if (seenLinks.has(link)) return;
			seenLinks.add(link);

			// Normalize image URL
			const normalizedImage = imageSrc ? normalizeImageUrl(imageSrc) : "";

			posts.push({
				title,
				link,
				image: normalizedImage,
			});
		});

		// Also check swiper slides for most wanted events
		if (posts.length < IMAGE_LIMIT) {
			$(".swiper-slide .event-most-container, .event-most-container").each((_, el) => {
				if (posts.length >= IMAGE_LIMIT) {
					return false;
				}

				const $container = $(el);
				const $titleLink = $container.find(".overlay h4.event-title a, h4.event-title a").first();
				const title = $titleLink.text().trim();
				let link = $titleLink.attr("href");

				const $img = $container.find("img").first();
				const imageSrc = $img.attr("src");

				if (!title) return;

				if (link && !link.startsWith("http")) {
					if (link.startsWith("/")) {
						link = `https://infolomba.id${link}`;
					} else {
						link = `https://infolomba.id/${link}`;
					}
				}

				// Skip if no link or already seen
				if (!link) return;
				if (seenLinks.has(link)) return;
				seenLinks.add(link);

				const normalizedImage = imageSrc ? normalizeImageUrl(imageSrc) : "";

				posts.push({
					title,
					link,
					image: normalizedImage,
				});
			});
		}

		// Fetch descriptions for all posts (with links)
		await Promise.all(
			posts.map(async (post) => {
				if (!post.link) return;
				post.description = await fetchPostDescription(post.link);
			}),
		);

		// Transform to ScrapedPost format
		const scrapedPosts: ScrapedPost[] = posts.map((post) => ({
			title: post.title || null,
			link: post.link,
			image: post.image || "",
			description: post.description || "",
			source: "web" as const,
			username: "infolombaid",
		}));

		logger.info(`Web scraping completed: ${posts.length} posts fetched`, {
			count: posts.length,
			posts: posts.map((p) => ({ title: p.title, link: p.link })),
		});

		return {
			count: scrapedPosts.length,
			posts: scrapedPosts,
		};
	} catch (error) {
		logger.error("Web scraping failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
