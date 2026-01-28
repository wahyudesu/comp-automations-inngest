# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Competition automation system built on Cloudflare Workers with Inngest workflows. Scrapes competition announcements from web sources and Instagram, extracts structured data using AI models, stores in a PostgreSQL database, and posts to WhatsApp channels.

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

- **src/index.ts**: Hono app entry point. Serves Inngest handler at `/api/inngest` and health check at `/`
- **src/inngest/index.ts**: Defines all Inngest functions and orchestrates workflows. Exports `inngest` client and `functions` array
- **src/workflow/\*.ts**: Individual workflow steps (numbered for execution order)
- **src/workflow/lib/\*.ts**: Shared utilities, types, config, and AI model functions
- **src/utils/\*.ts**: Logger utilities

### Workflow Pipeline

The complete automation pipeline runs in this order:

1. **Scraping** (`1.web-scrape.ts` or `1.ig-scrape.ts`)
   - Web: Scrapes infolombait.com using Cheerio
   - Instagram: Scrapes multiple competition accounts using `@aduptive/instagram-scraper`
   - Returns posts with title, link, image, description, source

2. **Upload to R2** (`2.upload-to-r2.ts`)
   - Downloads images and uploads to Cloudflare R2 storage
   - Uses S3 SDK with R2 credentials

3. **Insert to Database** (`3.insertdb.ts`)
   - Inserts new posts to PostgreSQL `competitions` table
   - Skips duplicates based on URL or description
   - Sets status to 'draft' for new records
   - Returns counts of inserted vs skipped records

4. **AI Data Extraction** (`4.data-extraction.ts`)
   - Multi-model extraction pipeline:
     - Zai (OpenRouter) for text extraction from captions
     - Mistral OCR for poster image text extraction
     - Gemini as fallback if Mistral fails
   - Normalizes and validates data against `CompetitionSchema`
   - Immediately updates each record to database (stream processing)
   - Handles partial validation failures gracefully

5. **Update Database** (`5.update-db.ts`)
   - Separate utility for batch updates (less commonly used)

6. **Send to WhatsApp** (`6.sending-wa.ts`)
   - Sends all draft competitions (or random subset) to WhatsApp channel
   - Uses WAHA API for WhatsApp integration
   - Updates status to 'published' after successful send
   - Filters out expired competitions (endDate < today)

### Inngest Functions

- **Individual steps**: `webScrapeFn`, `igScrapeFn`, `uploadToR2Fn`, `insertToDbFn`, `extractDataFn`, `updateDbFn`, `sendWhatsAppFn`, `sendWhatsAppRandomFn`
- **Complete workflows**: `competitionWorkflowWeb`, `competitionWorkflowIG` (run all steps)
- **Scheduled functions**: `scheduledWebWorkflow` (8 AM daily), `scheduledIGWorkflow` (9 AM daily), `scheduledWhatsApp` (every 4 hours)

### Data Flow

Posts enter as `ScrapedPost` → stored in DB as `draft` → AI extracts to `AIExtractedData` → validated against `CompetitionSchema` → updated in DB → sent to WhatsApp → status changed to `published`

### Configuration

Centralized in `src/workflow/lib/config.ts`:
- Instagram accounts to scrape
- R2 bucket settings
- WhatsApp API configuration
- Database connection settings

Uses environment variables for credentials. Validate with `validateConfig()`.

### AI Models

- **Zai**: Text-to-text extraction via OpenRouter (`model-function.ts`)
- **Mistral**: OCR for image text extraction (`model-function.ts`)
- **Gemini**: Fallback image-to-text (`model-function.ts`)

Models are used with fallback chain; if one fails, the next is tried.

### Database Schema (PostgreSQL)

Table: `competitions`
- Columns: id, title, description, poster, urlsource, url, level (jsonb), endDate, status, organizer (jsonb), categories (jsonb), startDate, format, participationType, pricing (jsonb), contact (jsonb), location, prizePool, benefits, createdAt, updatedAt
- Status values: 'draft' → 'published'

Uses `postgres` npm package (not pg). JSONB fields use `sql.json()` helper.

### Logger

Enhanced logger in `src/utils/enhanced-logger.ts`:
- Structured logging with child loggers
- Timing operations with `.time()` and `.endTimer()`
- Categorized errors via `ErrorCategory`
- Used throughout workflow steps for debugging

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
