// Test script untuk infolomba.id scraper
// Run: bun run test-infolombaid.ts

import { scrape } from "./src/workflow/1.web-scrape-infolombaid.js";

console.log("=== Testing infolomba.id Scraper ===\n");

const result = await scrape();

console.log("\n=== Results ===");
console.log("Total posts:", result.count);
console.log("\nPosts:\n");

result.posts.forEach((post, i) => {
  console.log(`[${i + 1}] ${post.title}`);
  console.log(`    Link: ${post.link}`);
  console.log(`    Image: ${post.image}`); // Full URL
  console.log(`    Description: ${post.description.substring(0, 100)}...`);
  console.log();
});
