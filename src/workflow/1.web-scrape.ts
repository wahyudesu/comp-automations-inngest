import { load } from "cheerio";
import { createLogger } from "../utils/logger.js";
// import type { ScraperResult } from "./types";

const logger = createLogger({ workflowStep: "1-web-scrape" });

interface ScraperResult {
	count: number;
	images: string[];
	posts: Array<{
		title: string;
		link: string;
		image?: string;
		description?: string;
	}>;
}

export const name = "lombait";
const IMAGE_LIMIT = 5; // ubah sesuai kebutuhan

export async function scrape(): Promise<ScraperResult> {
	const TARGET_URL = "https://www.infolombait.com/";
	const BASE_URL = TARGET_URL;

	try {
		const res = await fetch(TARGET_URL, {
			headers: { "User-Agent": "Mozilla/5.0" },
		});

		if (!res.ok) throw new Error("upstream fetch failed");

	const body = await res.text();
	const $ = load(body);

	const imagesArr: string[] = [];
	const posts: Array<{
		title: string;
		link: string;
		image?: string;
		description?: string;
	}> = [];

	$("#Blog1 .blog-posts .date-outer .thumb a").each((_, el) => {
		if (imagesArr.length >= IMAGE_LIMIT) {
			return false; // stop iterasi cheerio
		}

		const style = $(el).attr("style") || "";

		// extract background:url(...) — permissive
		const match = style.match(/url\(([^)]+)\)/i);
		if (!match) return;

		let rawUrl = match[1].replace(/['"]/g, "").trim();

		try {
			const normalizeImageSize = (u: string) =>
				u.replace(/\/s\d+(-c)?\//, "/s1600/");
			const abs = new URL(rawUrl, BASE_URL).toString();
			imagesArr.push(normalizeImageSize(abs));
		} catch (e) {
			// ignore invalid
		}
	});

	// collect titles and links from post-title
	$("h2.post-title.entry-title a").each((i, el) => {
		if (posts.length >= IMAGE_LIMIT) return false;

		const $el = $(el);
		const href = $el.attr("href");
		const title = $el.text().trim();
		if (!href && !title) return;
		try {
			const abs = href ? new URL(href, BASE_URL).toString() : "";
			posts.push({ title, link: abs, image: imagesArr[i] || "" });
		} catch (e) {
			posts.push({ title, link: href || "", image: imagesArr[i] || "" });
		}
	});

	// fetch each post page and extract description from div.post-body.entry-content
	await Promise.all(
		posts.map(async (p) => {
			if (!p.link) return;
			try {
				const r = await fetch(p.link, {
					headers: { "User-Agent": "Mozilla/5.0" },
				});
				if (!r.ok) return;
				const html = await r.text();
				const $d = load(html);
				const node = $d("div.post-body.entry-content").first();
				if (node && node.length) {
					// keep inner HTML as description (trimmed)
					p.description = node
						.text()
						.replace(/\s+/g, " ")
						.replace(/\u00a0/g, " ")
						.trim();
				}
			} catch (e) {
				// ignore per-post errors
			}
		}),
	);

	logger.info(`Web scraping completed: ${posts.length} posts fetched`, { count: posts.length });

	return {
		count: posts.length,
		images: imagesArr,
		posts,
	};
	} catch (error) {
		logger.error("Web scraping failed", error as Error);
		throw error;
	}
}
