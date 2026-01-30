import { describe, it, expect } from "bun:test";
import { scrape } from "../1.ig-scrape.js";

describe("IG Scrape - Real", () => {
	it("scrape 1 account and show output", async () => {
		console.log("\n📸 Scraping @infolomba.indonesia.id...\n");

		const result = await scrape();

		console.log(`\n✅ Count: ${result.count}`);
		console.log(`   Errors: ${result.errors?.length ?? 0}\n`);

		if (result.posts.length > 0) {
			console.log("📱 Posts:");
			result.posts.forEach((p, i) => {
				console.log(`   ${i + 1}. ${p.link}`);
			});
		}

		if (result.errors?.length) {
			console.log("\n❌ Errors:");
			result.errors.forEach((e) => console.log(`   ${e.error}`));
		}

		// Pass regardless - just to show output
		expect(true).toBe(true);
	});
});
