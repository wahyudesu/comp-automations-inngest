/**
 * Shared TypeScript interfaces for the workflow.
 */

/** Valid competition formats */
export type CompetitionFormat = "Online" | "Offline" | "Hybrid";

/** Valid participation types */
export type ParticipationType = "Individual" | "Team";

/** Valid participant levels */
export type ParticipantLevel = "SD" | "SMP" | "SMA" | "Mahasiswa" | "Umum";

/** Post source type */
export type PostSource = "web" | "instagram";

/** Scraped post from web or Instagram */
export interface ScrapedPost {
	title: string | null;
	link: string;
	image: string;
	description: string;
	source: PostSource;
	username: string;
}

/** AI-extracted competition data */
export interface AIExtractedData {
	title: string | null;
	organizer: string | string[] | null;
	categories: string | string[] | null;
	level: ParticipantLevel | ParticipantLevel[] | null;
	startDate: string | string[] | null;
	endDate: string | string[] | null;
	format: CompetitionFormat | null;
	participationType: ParticipationType | null;
	pricing: number | string | (number | string)[] | null;
	// contact: string[] | null;
	url: string | null;
	location: string | null;
	prizePool?: string;
	benefits?: string;
}

/** Database competition record */
export interface DbCompetition {
	id: number;
	title: string | null;
	description: string | null;
	poster: string | null;
	urlsource: string | null;
	url: string | null;
	level: ParticipantLevel[] | null;
	endDate: string | null;
	status: string;
}

/** Environment configuration */
export interface Env {
	DATABASE_URL: string;
	/** Native R2 bucket binding (does not count toward subrequest limit) */
	MY_BUCKET: R2Bucket;
	/** Legacy R2 credentials for S3 SDK (fallback, not recommended) */
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_ENDPOINT?: string;
	R2_BUCKET?: string;
	R2_PUBLIC_URL?: string;
	WAHA_BASE_URL?: string;
	WAHA_API_KEY?: string;
	WA_SESSION_ID?: string;
	WHATSAPP_CHANNEL_ID?: string;
	INNGEST_TRIGGER_URL?: string;
	INNGEST_API_KEY?: string;
	TRIGGER_SECRET_CODE?: string;
}

/** Result of uploading an image to R2 */
export interface UploadResult {
	success: boolean;
	originalUrl: string;
	r2Url?: string;
	error?: string;
}

/** Result of database insert operation */
export interface DbInsertResult {
	success: boolean;
	count: number;
	newRecordIds?: number[];
	skipped?: SkippedCounts;
}

/** Counts of skipped records during insert */
export interface SkippedCounts {
	skippedUrl: number;
	skippedDescription: number;
	skippedDuplication: number;
}

/** Result of database update operation */
export interface DbUpdateResult {
	success: boolean;
	count: number;
	skippedCount?: number;
}

/** Result of WhatsApp send operation */
export interface WhatsAppSendResult {
	sent: number;
	skipped: number;
}

/** Result of scraping operation */
export interface ScrapeResult {
	count: number;
	posts: ScrapedPost[];
	errors?: ScrapeError[];
}

/** Error from scraping operation */
export interface ScrapeError {
	username: string;
	error: string;
	code?: string;
}
