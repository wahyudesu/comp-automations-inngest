// import {
// 	pgTable,
// 	text,
// 	integer,
// 	boolean,
// 	timestamp,
// 	uuid,
// 	jsonb,
// 	date,
// } from "drizzle-orm/pg-core";

// export const competitions = pgTable("competitions", {
// 	id: uuid("id").primaryKey(),
// 	title: text("title"),
// 	description: text("description"),
// 	organizer: jsonb("organizer").$type<{
// 		id?: string;
// 		name: string;
// 		abbreviation?: string;
// 		type?: "University" | "Government" | "Corporate" | "Community" | "NGO" | "School" | "Individual" | "Other";
// 		logoUrl?: string;
// 		description?: string;
// 		website?: string;
// 		instagram?: string;
// 		linkedin?: string;
// 		tiktok?: string;
// 		isVerified?: boolean;
// 	}>(),
// 	categories: text("categories").$type<
// 		"Akademik & Sains" |
// 		"Teknologi & IT" |
// 		"Seni & Kreatif" |
// 		"Bisnis & Startup" |
// 		"Olahraga & E-sports" |
// 		"Sastra & Bahasa" |
// 		"Sosial & Lingkungan" |
// 		"Keagamaan" |
// 		"Gaya Hidup & Hobi" |
// 		"Lainnya"
// 	>(),
// 	views: integer("views").default(0),
// 	poster: text("poster").notNull(),
// 	urlsource: text("urlsource").notNull(),
// 	level: jsonb("level").$type<string[]>(),
// 	startDate: date("startDate"),
// 	endDate: date("endDate"),
// 	format: text("format").$type<"Online" | "Offline" | "Hybrid">(),
// 	participationType: text("participationType").$type<"Individual" | "Team">(),
// 	status: text("status").$type<"draft" | "published" | "archived">().notNull().default("draft"),
// 	pricing: jsonb("pricing").$type<number[]>(),
// 	contact: jsonb("contact").$type<Array<{ name: string; phone: string }>>(),
// 	location: text("location"),
// 	whatsappChannel: boolean("whatsappChannel"),
// 	socialMedia: jsonb("socialMedia").$type<{
// 		instagram?: string;
// 		tiktok?: string;
// 		linkedin?: string;
// 		youtube?: string;
// 		twitter?: string;
// 	}>(),
// 	createdAt: timestamp("createdAt").notNull().defaultNow(),
// 	updatedAt: timestamp("updatedAt").notNull().defaultNow(),
// 	url: text("url"),
// });

// export type Competition = typeof competitions.$inferSelect;
// export type NewCompetition = typeof competitions.$inferInsert;
