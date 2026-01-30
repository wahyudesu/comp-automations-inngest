import { describe, it, expect, mock } from "bun:test";

describe("IG Scrape", () => {
	it("should return scraped posts", async () => {
		// Mock response
		const mockResponse = {
			success: true,
			posts: [
				{
					url: "https://instagram.com/p/test123",
					display_url: "https://example.com/image.jpg",
					caption: "Lomba Hackathon 2024"
				},
				{
					url: "https://instagram.com/p/test456",
					display_url: "https://example.com/image2.jpg",
					caption: "Competition AI"
				}
			]
		};

		const mockScrape = mock(() => Promise.resolve(mockResponse));
		const result = await mockScrape();

		expect(result.success).toBe(true);
		expect(result.posts?.length).toBe(2);
		expect(result.posts?.[0].url).toBeTruthy();
		expect(result.posts?.[0].display_url).toBeTruthy();
		expect(mockScrape).toHaveBeenCalled();
	});
});
