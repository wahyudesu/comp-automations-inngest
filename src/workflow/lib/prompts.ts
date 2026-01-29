import { CompetitionCategory } from "./competition-schema.js";

// ============================================================================
// PROMPT FOR AI (Gemini, OpenRouter, ZAI, Groq)
// ============================================================================
export const EXTRACTION_PROMPT = `Extract competition information from this poster.

Categories: ${[...CompetitionCategory].join(", ")}
Level: SD, SMP, SMA, Mahasiswa, Umum
Format: Online, Offline, Hybrid
Participation: Individual, Team
Date: YYYY-MM-DD format
Pricing: Array of numbers in Rupiah (empty = free)

CRITICAL - DO NOT HALLUCINATE:
- organizer: Only if EXPLICITLY written. Use null if unclear.
- title: Clean, professional title. Remove excessive emojis, hype words (🔥,!!!,FREE), promotional text.

URL EXTRACTION RULES:
- url: Return ONLY ONE registration URL (the most important one). If multiple exist, pick the registration/pendaftaran link. Use null if no valid URL found.
- Valid URLs: http/https links, bit.ly, forms.gle, linktr.ee, wa.me, social links with "daftar/register/join"
- IGNORE: QR codes without URL, "Link di bio", incomplete URLs like "bit.ly/"

All fields optional. Use null for missing data, empty array [] for pricing. Better null than wrong. Only extract CLEARLY visible info.`;