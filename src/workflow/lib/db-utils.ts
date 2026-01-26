import postgres from "postgres";

/**
 * Build update object from AI-extracted data
 * Only includes fields that are present (non-null/undefined)
 */
export function buildUpdateObject(ai: Record<string, any>, sql: typeof postgres) {
  const updates: Record<string, any> = {};

  if (ai.title) updates.title = ai.title;
  if (ai.description) updates.description = ai.description;
  if (ai.organizer) updates.organizer = sql.json(ai.organizer);
  if (ai.categories) updates.categories = sql.json(ai.categories);
  if (ai.level) updates.level = sql.json(ai.level);
  if (ai.startDate) updates.startDate = ai.startDate;
  if (ai.endDate) updates.endDate = ai.endDate;
  if (ai.format) updates.format = ai.format;
  if (ai.participationType) updates.participationType = ai.participationType;
  if (ai.pricing) updates.pricing = sql.json(ai.pricing);
  if (ai.contact) updates.contact = sql.json(ai.contact);
  if (ai.url) updates.url = ai.url;
  if (ai.location) updates.location = ai.location;
  if (ai.prizePool) updates.prizePool = ai.prizePool;
  if (ai.benefits) updates.benefits = ai.benefits;

  return updates;
}

/**
 * Execute UPDATE query with built update object
 */
export async function updateCompetition(
  sql: typeof postgres,
  id: number,
  ai: Record<string, any>
): Promise<void> {
  const updates = buildUpdateObject(ai, sql);

  if (Object.keys(updates).length === 0) {
    return; // Nothing to update
  }

  await sql`
    UPDATE competitions
    SET ${sql(updates)}
    WHERE id = ${id}
  `;
}
