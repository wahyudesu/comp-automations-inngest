# Workflow Directory

This directory contains the core workflow logic for the competition automation system. Each numbered file represents a step in the pipeline.

## Pipeline Overview

```
1. Parallel Scraping (IG + Web)
   ↓
2. Upload to R2 (Image Storage)
   ↓
3. Insert to Database (Draft Status)
   ↓
4. AI Data Extraction (Multi-Model)
   ↓
5. Update Database (AI Results)
   ↓
6. Send to WhatsApp
```

## Core Files

### Step 1: Scraping

| File | Purpose | Source |
|------|---------|--------|
| `1.parallel-scrape.ts` | Orchestrates parallel scraping from all sources | - |
| `1.ig-scrape.ts` | Instagram scraper using `@aduptive/instagram-scraper` | 6 accounts |
| `1.web-scrape-infolombaid.ts` | Web scraper for infolomba.id | 5 posts |
| `1.web-scrape-infolombait.ts` | Web scraper for infolombait.com | 5 posts |

**Retry Strategy:**
- Web sources: **Infinite retry** until success (exponential backoff, capped at 60s)
- IG: Limited retries with rate limiting (429 handling)

**Source Tracking:**
Each post includes `source: "instagram" | "web"` and `username` for origin tracking.

### Step 2: R2 Upload

**File:** `2.upload-to-r2.ts`

Downloads images from source URLs and uploads to Cloudflare R2 storage.

**Key Features:**
- Uses native `R2Bucket` binding (does NOT count toward Workers subrequest limit)
- Batch processing (40 images/batch by default)
- Exponential backoff retry for network errors
- Replaces original URLs with R2 public URLs

### Step 3: Database Insert

**File:** `3.insertdb.ts`

Inserts scraped posts to PostgreSQL `competitions` table with `status='draft'`.

**Duplicate Detection:**
- Skips posts with existing `urlsource`
- Skips posts with existing `description`
- Returns `newRecordIds` array for next step

### Step 4: AI Data Extraction

**File:** `4.data-extraction.ts`

Multi-model AI extraction pipeline with fallback chain:

| Model | Purpose | Input | Fallback |
|-------|---------|-------|----------|
| **Zai** | Text extraction from captions | Caption text | - |
| **Mistral OCR** | Poster image text extraction | Image URL | Gemini |
| **Gemini** | Fallback image-to-text | Image URL | - |

**Field Source Tracking:**
The `fieldSource` object tracks which AI model provided each field (`zai`, `mistral`, `gemini`).

**Stream Processing:**
Each record is updated to database immediately after extraction (no waiting for all to complete).

### Step 5: Database Update

**File:** `5.update-db.ts`

Updates competition records with AI-extracted data. Uses `buildUpdateObject()` to generate SQL update with JSONB fields.

### Step 6: WhatsApp Sending

**File:** `6.sending-wa.ts`

Sends competitions to WhatsApp channels via WAHA API. Filters out expired competitions before sending.

## Library

| File | Purpose |
|------|---------|
| `lib/types.ts` | Shared TypeScript interfaces |
| `lib/config.ts` | Centralized configuration management |
| `lib/competition-schema.ts` | Zod schema for competition data + Mistral JSON schema |
| `lib/prompts.ts` | AI prompt templates |
| `lib/model-function.ts` | AI model functions (Zai, Mistral, Gemini, Groq) |
| `lib/db-utils.ts` | Database utility functions |

## Key Types

```typescript
// Raw scraped post from any source
interface ScrapedPost {
  title: string | null;
  link: string;
  image: string;
  description: string;
  source: "web" | "instagram";
  username: string;
}

// AI-extracted data
interface AIExtractedData {
  title: string | null;
  organizer: string | string[] | null;
  categories: string | string[] | null;
  level: ParticipantLevel | ParticipantLevel[] | null;
  startDate: string | string[] | null;
  endDate: string | string[] | null;
  format: "Online" | "Offline" | "Hybrid" | null;
  participationType: "Individual" | "Team" | null;
  pricing: number | string | (number | string)[] | null;
  url: string | null;
  location: string | null;
  prizePool?: string;
  benefits?: string;
}
```

## Environment Variables

**Required:**
- `DATABASE_URL` - PostgreSQL connection string

**Optional (with defaults in config):**
- `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL` - R2 storage
- `WAHA_BASE_URL`, `WAHA_API_KEY`, `WA_SESSION_ID`, `WHATSAPP_CHANNEL_ID` - WhatsApp
- `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY` - AI models

## Data Normalization

All AI-extracted data is normalized via `normalize()` function:
- Single values → Arrays (organizer, level, categories, pricing)
- Enums validated against allowed values
- Dates → YYYY-MM-DD format
- Rupee strings → Numbers
- Invalid values → `null`

## Testing

Test files are in `__tests__/` directory:
- `1.ig-scrape.test.ts` - Instagram scraper tests
- `1.web-scrape.test.ts` - Web scraper tests

## Configuration

Instagram accounts (6 active) are defined in `lib/config.ts`:
- `infolomba.indonesia.id`
- `lomba_mahasiswa`
- `infolombaeventid`
- `infolombamahasiswa.id`
- `pusatinfolomba`

Web sources (2 active) with configurable limits.
