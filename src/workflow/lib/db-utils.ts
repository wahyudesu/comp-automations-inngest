import type { Sql } from "postgres";
import type { AIExtractedData } from "./types.js";

/**
 * Build update object from AI-extracted data.
 * Only includes fields that are present (non-null/undefined).
 */
export function buildUpdateObject(
	ai: Partial<AIExtractedData>,
	sql: Sql<Record<string, never>>,
): Record<string, unknown> {
	const updates: Record<string, unknown> = {};

	if (ai.title) updates.title = ai.title;
	if (ai.organizer) updates.organizer = sql.json(ai.organizer);
	if (ai.categories) updates.categories = sql.json(ai.categories);
	if (ai.level) updates.level = sql.json(ai.level);
	if (ai.startDate) updates.startDate = ai.startDate;
	if (ai.endDate) updates.endDate = ai.endDate;
	if (ai.format) updates.format = ai.format;
	if (ai.participationType) updates.participationType = ai.participationType;
	if (ai.pricing) updates.pricing = sql.json(ai.pricing);
	// if (ai.contact) updates.contact = sql.json(ai.contact);
	if (ai.url) updates.url = ai.url;
	if (ai.location) updates.location = ai.location;
	if (ai.prizePool) updates.prizePool = ai.prizePool;
	if (ai.benefits) updates.benefits = ai.benefits;

	return updates;
}

/**
 * Execute UPDATE query with built update object.
 */
export async function updateCompetition(
	sql: Sql<Record<string, never>>,
	id: number,
	ai: Partial<AIExtractedData>,
): Promise<void> {
	const updates = buildUpdateObject(ai, sql);

	if (Object.keys(updates).length === 0) {
		return;
	}

	await sql`
    UPDATE competitions
    SET ${sql(updates)}
    WHERE id = ${id}
  `;
}
