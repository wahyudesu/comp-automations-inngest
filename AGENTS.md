# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Competition automation system built on Cloudflare Workers with Inngest batch processing. Scrapes competition announcements from Instagram, extracts structured data using AI models, stores in a PostgreSQL database, and posts to WhatsApp channels.

**Runtime:** Uses Bun as package manager and runtime (`bun install`, `bun run ...`).

## Commands

**Development:**
```bash
bun run dev           # Start local Wrangler dev server
bun run dev:inngest   # Start Inngest CLI dev server
```

**Deployment:**
```bash
bun run deploy        # Deploy to Cloudflare Workers with minification
```

**Types:**
```bash
bun run cf-typegen    # Generate types from wrangler.jsonc into CloudflareBindings interface
```

**Install dependencies:**
```bash
bun install           # Install packages (uses bun.lock)
```

## Architecture

### Application Structure

- **src/index.ts**: Hono app entry point. Serves Inngest handler at `/api/inngest` and manual trigger at `/api/trigger-scraping`
- **src/workflows/competition-workflow.ts**: Cloudflare Workers Workflow (cron-based) for IG→R2→DB pipeline
- **src/workers/cron-handler.ts**: Alternative cron handler implementation
- **src/inngest/index.ts**: Defines `processDraftBatchesFn` for AI extraction + WhatsApp sending
- **src/workflow/\*.ts**: Individual workflow step functions
- **src/workflow/lib/\*.ts**: Shared utilities, types, config, and AI model functions
- **src/utils/\*.ts**: Logger utilities

### Workflow Pipeline

The system uses **Cloudflare Workers Workflow** for scraping and **Inngest** for AI processing:

#### Phase 1: Cloudflare Workers Workflow (Cron Triggered)

1. **Instagram Scraping** (`CompetitionAutomationWorkflow.step1_scrapeInstagram`)
   - Scrapes multiple competition accounts using `@aduptive/instagram-scraper`
   - Returns posts with title, link, image, description, source

2. **Upload to R2** (`CompetitionAutomationWorkflow.step2_uploadToR2`)
   - Downloads images and uploads to Cloudflare R2 storage
   - Uses S3 SDK with R2 credentials
   - Replaces original URLs with R2 URLs

3. **Insert to Database** (`CompetitionAutomationWorkflow.step3_insertToDb`)
   - Inserts new posts to PostgreSQL `competitions` table
   - Skips duplicates based on URL or description
   - Sets status to 'draft' for new records
   - Returns `newRecordIds` array

4. **Trigger Inngest**
   - Sends `newRecordIds` to Inngest `processDraftBatchesFn`

#### Phase 2: Inngest Batch Processing

5. **AI Data Extraction** (`processDraftBatchesFn`)
   - Processes records in batches (size=2) to avoid CPU timeouts
   - Multi-model extraction pipeline:
     - Zai (OpenRouter) for text extraction from captions
     - Mistral OCR for poster image text extraction
     - Gemini as fallback if Mistral fails
   - Normalizes and validates data against `CompetitionSchema`
   - Tracks field sources (which AI model provided which data)
   - Immediately updates each record to database (stream processing)

6. **Send to WhatsApp** (triggered after all batches complete)
   - Sends all draft competitions to WhatsApp channel
   - Uses WAHA API for WhatsApp integration
   - Updates `whatsappChannel` to true after successful send
   - Filters out expired competitions (endDate < today)

### Inngest Functions

- **`processDraftBatchesFn`**: Main Inngest function
  - Accepts `newRecordIds` array
  - Processes in batches of 2 records
  - Runs AI extraction sequentially
  - Triggers WhatsApp sending after completion

### Data Flow

```
Cloudflare Cron (daily)
        ↓
Instagram Scraping
        ↓
Upload to R2 (replace URLs)
        ↓
Insert to DB (status='draft')
        ↓
Trigger Inngest with newRecordIds
        ↓
Batch AI Extraction (2 records/batch)
        ↓
Send to WhatsApp
        ↓
whatsappChannel=true
```

### Manual Trigger

Endpoint: `POST /api/trigger-scraping`
- Requires `code` query parameter for security
- Manually triggers the IG scraping pipeline
- Useful for testing or on-demand updates

### Configuration

Centralized in `src/workflow/lib/config.ts`:
- Instagram accounts to scrape (8 accounts)
- R2 bucket settings
- WhatsApp API configuration
- Database connection settings

Uses environment variables for credentials. Validate with `validateConfig()`.

### AI Models

- **Zai**: Text-to-text extraction via OpenRouter (`model-function.ts`)
- **Mistral**: OCR for image text extraction (`model-function.ts`)
- **Gemini**: Fallback image-to-text (`model-function.ts`)

Models are used with fallback chain; if one fails, the next is tried. Field sources are tracked in `extractedFrom` field.

### Database Schema (PostgreSQL)

Table: `competitions`
- Columns: id, title, description, poster, urlsource, url, level (jsonb), endDate, status, organizer (jsonb), categories (jsonb), startDate, format, participationType, pricing (jsonb), contact (jsonb), location, prizePool, benefits, whatsappChannel, extractedFrom, createdAt, updatedAt
- Status values: 'draft' → 'published'
- whatsappChannel: false → true (tracks if sent to WhatsApp)

Uses `postgres` npm package (not pg). JSONB fields use `sql.json()` helper.

### Logger

Enhanced logger in `src/utils/enhanced-logger.ts`:
- Structured logging with child loggers
- Timing operations with `.time()` and `.endTimer()`
- Categorized errors via `ErrorCategory`
- Used throughout workflow steps for debugging

### Web Scraping (Backup)

A web scraper exists at `src/workflow/1.web-scrape.ts` but is **not part of the main automated flow**:
- Scrapes infolombait.com using Cheerio
- Can be used independently as a backup data source

### TypeScript Configuration

- ESNext target with bundler module resolution
- Strict mode enabled
- JSX for Hono (react-jsx)
- Use `.js` extensions in imports (ESNext)

### Environment Variables

Required:
- `DATABASE_URL`: PostgreSQL connection string

Optional (with defaults in config):
- R2: `R2_ENDPOINT`, `R2_BUCKET`, `R2_PUBLIC_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- WhatsApp: `WAHA_BASE_URL`, `WAHA_API_KEY`, `WA_SESSION_ID`, `WHATSAPP_CHANNEL_ID`
- AI: `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`
- Security: `TRIGGER_SECRET_CODE` for manual scraping endpoint
