import { InstagramScraper } from "@aduptive/instagram-scraper";

const USERNAME = "infolomba.indonesia.id";
const LIMIT = 2;

console.log(`📸 Scraping @${USERNAME}...\n`);

const scraper = new InstagramScraper({
	maxRetries: 1,
	minDelay: 500,
	maxDelay: 1000,
	timeout: 10000,
});

const result = await scraper.getPosts(USERNAME, LIMIT);

console.log(`✅ Success: ${result.success}`);
console.log(`📊 Posts: ${result.posts?.length ?? 0}\n`);

if (result.success && result.posts) {
	result.posts.forEach((p, i) => {
		console.log(`#${i + 1}`);
		console.log(`  URL:  ${p.url}`);
		console.log(`  Img:  ${p.display_url}`);
		console.log(`  Cap:  ${p.caption?.slice(0, 60)}...`);
		console.log("");
	});
} else {
	console.log(`❌ Error: ${result.error}`);
	console.log(`   Code: ${result.code}`);
}

process.exit(result.success ? 0 : 1);
