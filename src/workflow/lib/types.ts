/**
 * Shared TypeScript interfaces for the workflow
 */

export interface ScrapedPost {
	title: string | null;
	link: string;
	image: string;
	description: string;
	source: string;
	username: string;
}

export interface AIExtractedData {
	title: string | null;
	organizer: string | string[] | null;
	categories: string | string[] | null;
	level: string | string[] | null;
	startDate: string | string[] | null;
	endDate: string | string[] | null;
	format: "Online" | "Offline" | "Hybrid" | null;
	participationType: "Individual" | "Team" | null;
	pricing: number | string | (number | string)[] | null;
	contact: Array<Record<string, string>> | null;
	url: string | null;
	location: string | null;
	prizePool?: string;
	benefits?: string;
}

export interface DbCompetition {
	id: number;
	title: string | null;
	description: string | null;
	poster: string | null;
	urlsource: string | null;
	url: string | null;
	level: string[] | null;
	endDate: string | null;
	status: string;
}

export interface Env {
	DATABASE_URL: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_ENDPOINT?: string;
	R2_BUCKET?: string;
	R2_PUBLIC_URL?: string;
	WAHA_BASE_URL?: string;
	WAHA_API_KEY?: string;
	WA_SESSION_ID?: string;
	WHATSAPP_CHANNEL_ID?: string;
}

export interface UploadResult {
	success: boolean;
	originalUrl: string;
	r2Url?: string;
	error?: string;
}

export interface DbInsertResult {
	success: boolean;
	count: number;
	newRecordIds?: number[];
	skipped?: {
		skippedUrl: number;
		skippedDescription: number;
		skippedDuplication: number;
	};
}
