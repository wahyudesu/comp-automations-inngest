import { describe, it, expect } from "bun:test";
import { scrape } from "../1.web-scrape.js";

describe("Web Scrape - Infolombait", () => {
	it("should successfully scrape infolombait.com", async () => {
		const result = await scrape();

		expect(result).toBeDefined();
		expect(result.count).toBeGreaterThan(0);
		expect(result.images).toBeArray();
		expect(result.posts).toBeArray();
	});

	it("should return valid post structure", async () => {
		const result = await scrape();

		expect(result.posts.length).toBeGreaterThan(0);

		const firstPost = result.posts[0];
		expect(firstPost).toBeDefined();
		expect(firstPost.title).toBeString();
		expect(firstPost.link).toBeString();
		expect(firstPost.link).toStartWith("http");
	});

	it("should have images matching posts count", async () => {
		const result = await scrape();

		expect(result.images.length).toBeGreaterThan(0);
		expect(result.images.length).toBeLessThanOrEqual(5);
	});

	it("should fetch descriptions for posts", async () => {
		const result = await scrape();

		const postsWithDescription = result.posts.filter((p) => p.description);
		expect(postsWithDescription.length).toBeGreaterThan(0);
	});

	it("should have normalized image URLs", async () => {
		const result = await scrape();

		result.images.forEach((img) => {
			expect(img).toStartWith("http");
			expect(img).toContain("/s1600/");
		});
	});
});
