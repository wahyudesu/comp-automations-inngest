# Competition Automation Workflow

Complete workflow documentation for the competition automation system built on Cloudflare Workers with Inngest batch processing.

---

## System Architecture

The system operates as a **two-phase pipeline**:

1. **Phase 1: Cloudflare Workers Workflow** (Cron-triggered) - Scraping and storage
2. **Phase 2: Inngest Batch Processing** (Event-triggered) - AI extraction and WhatsApp delivery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUDFLARE CRON                                │
│                           (Every 6 hours)                                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 1: CLOUDFLARE WORKERS WORKFLOW                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │ 1. IG Scrape    │───▶│ 2. Upload to R2 │───▶│ 3. Insert to DB │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│         │                       │                       │                   │
│         │                       │                       │                   │
│         ▼                       ▼                       ▼                   │
│  8 IG accounts         Download & upload      Batch insert with            │
│  4 posts/account       images to R2            deduplication               │
│  ~24 posts total       (40/batch)             status='draft'               │
│                                                                             │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               │ newRecordIds[]
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 2: INNGEST                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │ 4. AI Extract   │───▶│ 5. Update DB    │───▶│ 6. Send to WA   │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│         │                       │                       │                   │
│         │                       │                       │                   │
│         ▼                       ▼                       ▼                   │
│  Batch size: 2          Update extracted       Send to 2 channels          │
│  Zai → Mistral →        fields to DB           whatsappChannel=true        │
│  Gemini fallback        extractedFrom={}      Filter expired               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Cloudflare Workers Workflow

### Entry Point
**File:** `src/workflows/competition-workflow.ts`
**Class:** `CompetitionAutomationWorkflow`

Triggered by cron schedule: `0 */6 * * *` (Every 6 hours)

---

### Step 1: Instagram Scraping
**File:** `src/workflow/1.ig-scrape.ts`
**Function:** `scrape(log: EnhancedLogger): Promise<ScrapeResult>`

#### Configuration (`src/workflow/lib/config.ts`)
```typescript
// Instagram accounts to scrape
IG_LOMBA = [
  "infolomba.indonesia.id",
  "lomba_mahasiswa",
  "infolombaeventid",
  "infolombamahasiswa.id",
  "infolombaevent.id",
  "pusatinfolomba",
]

// Scraping limits
imageLimit: 4           // Max posts per account
maxRetries: 1           // Retry attempts
timeout: 10000          // Request timeout (ms)
rateLimitPerMinute: 20  // Rate limiting
```

#### Process Flow
```
For each IG account:
  1. Fetch profile using @aduptive/instagram-scraper
  2. Extract recent posts (limit: imageLimit)
  3. Extract: title, link, image, description, source, username
  4. Handle rate limiting with exponential backoff
  5. Collect all posts into results array
```

#### Output Format
```typescript
interface ScrapeResult {
  count: number;           // Total posts scraped
  posts: Array<{
    title: string | null;
    link: string;          // Instagram post URL
    image: string;         // Image URL (Instagram CDN)
    description: string;   // Caption text
    source: string;        // Account username
    username: string;
  }>;
  errors?: string[];       // Any errors during scraping
}
```

#### Retry Mechanism
- **Max attempts:** `config.instagram.maxRetries`
- **Delay:** Random between `minDelay` and `maxDelay`
- **Exponential backoff:** For network errors

---

### Step 2: Upload to R2
**File:** `src/workflow/2.upload-to-r2.ts`
**Function:** `uploadToR2(posts, env, retryConfig?, batchConfig?, log?): Promise<PostData[]>`

#### Configuration
```typescript
// Batch configuration to avoid Cloudflare subrequest limits
maxBatchSize: 40      // Max 40 images per batch (CF free tier: 50 subrequests)
batchDelayMs: 2000    // 2 second delay between batches

// R2 retry configuration
maxAttempts: 3
baseDelayMs: 1000
maxDelayMs: 10000
requestTimeoutMs: 30000
```

#### Process Flow
```
For each batch (max 40 posts):
  For each post:
    1. Fetch image from Instagram URL (counts as 1 subrequest)
    2. Upload to R2 bucket using native binding (NO subrequest)
    3. Generate R2 public URL
    4. Replace original Instagram URL with R2 URL
    5. Track success/failure

  Wait batchDelayMs before next batch (if not last batch)
```

#### R2 URL Format
```
Format: {R2_PUBLIC_URL}/{filename}
Example: https://objectcompetition.wahyuikbal.com/1738574123456-lomba_national.jpg

Filename pattern: {timestamp}-{sanitized_title}.jpg
```

#### Subrequest Management
| Operation | Subrequest Count |
|-----------|------------------|
| Fetch from Instagram | 1 per image |
| Upload to R2 (native) | 0 |
| **Per batch (40 images)** | ~40 |
| **Safe limit** | 50 (CF free tier) |

#### Output
```typescript
interface UploadResult {
  success: boolean;
  originalUrl: string;
  r2Url?: string;        // R2 public URL if successful
  error?: string;        // Error message if failed
}
```

**Fallback:** If upload fails, original Instagram URL is preserved

---

### Step 3: Insert to Database
**File:** `src/workflow/3.insertdb.ts`
**Function:** `insertToDb(posts, env, log?): Promise<DbInsertResult>`

#### Database Schema
```sql
CREATE TABLE competitions (
  id SERIAL PRIMARY KEY,
  title TEXT,
  description TEXT,
  poster TEXT,
  urlsource TEXT,
  url TEXT,
  level JSONB,              -- ["SMA", "Mahasiswa"]
  endDate DATE,
  status TEXT,              -- 'draft' | 'published'
  organizer JSONB,          -- ["Universitas X"]
  categories JSONB,         -- ["Teknologi & IT"]
  startDate DATE,
  format TEXT,              -- 'Online' | 'Offline' | 'Hybrid'
  participationType TEXT,   -- 'Individual' | 'Team'
  pricing JSONB,            -- [50000, 100000]
  contact JSONB,
  location TEXT,
  prizePool TEXT,
  benefits TEXT,
  whatsappChannel BOOLEAN,  -- false | true
  extractedFrom JSONB,      -- {"title": "zai", "level": "mistral", ...}
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
)
```

#### Process Flow
```
1. Fetch existing data (urlsource, description)
2. Filter duplicates:
   - Skip if urlsource exists in DB
   - Skip if description exists in DB
   - Skip duplicates within current batch
3. Batch INSERT all filtered posts (single query)
4. Return new record IDs for Inngest trigger
```

#### Deduplication Logic
```typescript
// Priority order
1. urlsource match → skip
2. description match (DB) → skip
3. description match (current batch) → skip
```

#### Batch INSERT
```typescript
// Uses postgres.js batch insert for efficiency
// Single query instead of N individual queries
const insertValues = filteredPosts.map(post => [
  post.title,
  post.description,
  post.image,      // R2 URL now
  post.link,
  'draft'
]);

await sql`
  INSERT INTO competitions (title, description, poster, urlsource, status)
  SELECT * FROM ${sql(insertValues)}
  RETURNING id
`;
```

#### Output
```typescript
interface DbInsertResult {
  success: boolean;
  count: number;           // Number of records inserted
  newRecordIds: number[];  // IDs for Inngest processing
  skipped: {
    skippedUrl: number;
    skippedDescription: number;
    skippedDuplication: number;
  };
}
```

#### Trigger Inngest
After successful insert, `newRecordIds` is sent to Inngest:
```typescript
// Triggered from scheduled handler
await inngest.send({
  name: "process/batches.start",
  data: { newRecordIds }
})
```

---

## Phase 2: Inngest Batch Processing

### Entry Point
**File:** `src/inngest/index.ts`
**Function:** `processDraftBatchesFn`

**Event:** `process/batches.start`
**Concurrency:** 1 (to avoid PromiseFulfiller errors)

---

### Step 4: AI Data Extraction
**File:** `src/workflow/4.data-extraction.ts`
**Function:** `extractData(newCount, existingIds, env, log?): Promise<ExtractionResult>`

#### Multi-Model AI Pipeline
```
┌─────────────────────────────────────────────────────────────────┐
│                    AI EXTRACTION PIPELINE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐     ┌─────────────┐     ┌─────────────┐          │
│  │  Zai    │────▶│  Mistral    │────▶│   Gemini    │          │
│  │ (Text)  │     │  (OCR)      │     │  (Fallback) │          │
│  └─────────┘     └─────────────┘     └─────────────┘          │
│       │                │                   │                   │
│       ▼                ▼                   ▼                   │
│  Caption text    Poster image         Poster image            │
│  extraction      OCR extraction      Image-to-text            │
│  (OpenRouter)    (Mistral API)       (Gemini API)             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Step-by-Step Extraction

**Step 4.1: Zai Text Extraction**
```typescript
// Source: Instagram caption (description)
// Model: OpenRouter (Zai)
// Extracts: title, organizer, level, dates, format, etc.

const textResult = await zaiTextToText(description);
data = merge(data, normalize(textResult));
fieldSource[key] = "zai";  // Track source
```

**Step 4.2: Mistral OCR Extraction**
```typescript
// Source: Poster image
// Model: Mistral Pixtral Large (OCR)
// Fills: Missing fields from Zai

const mistralData = await mistralOCR(poster);
data = merge(data, normalize(mistralData));
trackNewFields(data, mistralData, "mistral");
```

**Step 4.3: Gemini Fallback**
```typescript
// Triggered: Only if Mistral fails
// Model: Gemini 2.0 Flash
// Purpose: Backup image extraction

if (!mistralSuccess) {
  const geminiResult = await geminiImageToText(poster);
  data = merge(data, normalize(geminiResult));
  trackNewFields(data, geminiResult, "gemini");
}
```

#### Data Normalization

**Level Normalization**
```typescript
VALID_LEVELS = ["SD", "SMP", "SMA", "Mahasiswa", "Umum"]

// Fuzzy matching
"sekolah dasar" → "SD"
"mts" → "SMP"
"smk" → "SMA"
"kuliah" → "Mahasiswa"
```

**Category Normalization**
```typescript
CompetitionCategory = [
  "Akademik & Sains",
  "Teknologi & IT",
  "Seni & Kreatif",
  "Bisnis & Startup",
  "Olahraga & E-sports",
  "Sastra & Bahasa",
  "Sosial & Lingkungan",
  "Keagamaan",
  "Lainnya"
]

// Keywords mapping
"coding", "ui/ux" → "Teknologi & IT"
"fotografi", "desain" → "Seni & Kreatif"
```

**Format Normalization**
```typescript
VALID_FORMATS = ["Online", "Offline", "Hybrid"]

"zoom", "gmeet" → "Online"
"tatap muka" → "Offline"
```

**Date Normalization**
```typescript
// Input formats accepted:
// - "2024-12-31" (YYYY-MM-DD)
// - "31/12/2024" (DD/MM/YYYY)
// - "31-12-2024" (DD-MM-YYYY)

// Output: Always YYYY-MM-DD
```

**Pricing Normalization**
```typescript
// Handles various formats:
// - "Rp 50.000" → 50000
// - "50.000" → 50000
// - 50000 → 50000
// - {"amount": "Rp 50.000"} → [50000]
```

#### Schema Validation
```typescript
// Using Zod schema (src/workflow/lib/competition-schema.ts)
const result = CompetitionSchema.safeParse(data);

if (!result.success) {
  // Partial validation - save valid fields only
  // Log validation errors for debugging
}
```

#### Field Source Tracking
```typescript
// Tracks which AI model provided each field
fieldSource = {
  title: "zai",
  level: "mistral",
  endDate: "gemini",
  organizer: null,
  // ...
}
```

#### Stream Processing
```typescript
// Each record is updated to DB immediately after extraction
// Prevents data loss on failure

for (const post of posts) {
  const extracted = await extractSingle(post);
  await updateSingleRecord(sql, post.id, extracted.aiAnalysis);
  // ^ Immediate DB update per record
}
```

#### Batch Processing
```typescript
// Process in batches of 2 to avoid CPU timeout
batchSize: 2  // Records per Inngest step
```

#### Output
```typescript
interface ExtractionResult {
  success: boolean;
  count: number;           // Successfully extracted
  modelUsage: {
    zai: number;           // Zai calls
    mistral: number;       // Mistral calls
    gemini: number;        // Gemini calls
  };
  totalDuration: number;   // Milliseconds
  records: Array<{
    recordId: number;
    fieldSource: FieldSource;
  }>;
}
```

---

### Step 5: Update Database
**File:** `src/workflow/5.update-db.ts` (deprecated - integrated in Step 4)
**File:** `src/workflow/lib/db-utils.ts`

#### Update Object Builder
```typescript
function buildUpdateObject(ai: AIAnalysis, sql): SqlSet {
  return {
    title: ai.title,
    level: sql.json(ai.level),
    organizer: sql.json(ai.organizer),
    categories: sql.json(ai.categories),
    pricing: sql.json(ai.pricing),
    // ... other fields
  };
}
```

#### SQL Update
```typescript
await sql`
  UPDATE competitions
  SET ${sql(updates)}
  WHERE id = ${recordId}
`;
```

---

### Step 6: Send to WhatsApp
**File:** `src/workflow/6.sending-wa.ts`
**Functions:** `sendAllToWhatsApp()`, `sendRandomToWhatsApp()`

#### Configuration
```typescript
whatsapp: {
  baseUrl: "https://waha-qxjcatc8.sumopod.in",
  apiKey: env.WAHA_API_KEY,
  sessionId: "session_01jx523c9fdzcaev186szgc67h",
  channelIds: [
    "120363408171323961@newsletter",  // Channel 1
    "120363407021321600@newsletter",  // Channel 2
  ]
}
```

#### Process Flow
```
1. Fetch competitions with whatsappChannel = false
2. Filter requirements:
   - title IS NOT NULL AND title != ''
   - poster IS NOT NULL AND poster != ''
   - endDate IS NULL OR endDate >= CURRENT_DATE
3. For each competition:
   a. Format caption (title, level, deadline, URL)
   b. Send to all channel IDs (parallel)
   c. Update whatsappChannel = true
4. Log success/failure
```

#### Caption Format
```typescript
*{title}*

🎓 {level}          // Optional: "SMA, Mahasiswa"
⏰ Deadline: {date}  // Optional: "31 Desember"

{url}                // Registration URL
```

#### Date Formatting
```typescript
// Indonesian locale
formatDeadline("2024-12-31") → "31 Desember"
```

#### API Call
```typescript
POST {baseUrl}/api/sendImage
Headers: {
  "Content-Type": "application/json",
  "X-Api-Key": "{apiKey}"
}
Body: {
  session: "{sessionId}",
  chatId: "{channelId}",
  file: {
    mimetype: "image/jpeg",
    filename: "{filename}",
    url: "{posterUrl}"  // R2 URL
  },
  caption: "{formattedCaption}"
}
```

#### Output
```typescript
interface WhatsAppSendResult {
  sent: number;     // Successfully sent
  skipped: number;  // Failed/skipped
}
```

---

## Web Scrape (Backup)
**File:** `src/workflow/1.web-scrape.ts`
**Function:** `scrapeWeb(log): Promise<ScrapeResult>`

#### Configuration
```typescript
// Target website
baseUrl: "https://infolombait.com"
endpoint: "/lomba?page={page}"
```

#### Process Flow
```
1. Fetch HTML page
2. Parse with Cheerio
3. Extract competition cards
4. Parse: title, link, image, description, source
5. Handle pagination (optional)
```

#### Status
**NOT part of main automated flow** - Available as backup data source

---

## Type Definitions
**File:** `src/workflow/lib/types.ts`

### Key Types
```typescript
// Environment variables
interface Env {
  MY_BUCKET: R2Bucket;
  DATABASE_URL: string;
  R2_PUBLIC_URL: string;
  WAHA_API_KEY: string;
  CHAT_1: string;
  CHAT_2: string;
}

// Competition data
interface Competition {
  id: number;
  title: string;
  description: string;
  poster: string;
  urlsource: string;
  url: string;
  level: string[];
  endDate: string;
  status: 'draft' | 'published';
  // ...
}

// Extraction result
interface ExtractionResult {
  success: boolean;
  count: number;
  modelUsage: ModelUsage;
  totalDuration: number;
  records: RecordExtractionDetail[];
}
```

---

## AI Model Functions
**File:** `src/workflow/lib/model-function.ts`

### Available Models
| Function | Model | Purpose | API |
|----------|-------|---------|-----|
| `zaiTextToText()` | Zai (OpenRouter) | Text extraction | OpenRouter |
| `mistralOCR()` | Pixtral Large | Image OCR | Mistral AI |
| `geminiImageToText()` | Gemini 2.0 Flash | Fallback image | Google AI |
| `groqImageToText()` | Llama 3.2 Vision | Alternative | Groq |
| `openrouterTextToText()` | Various | Alternative text | OpenRouter |

---

## Prompts
**File:** `src/workflow/lib/prompts.ts`

### EXTRACTION_PROMPT
Detailed instructions for AI models including:
- Field definitions
- Output format (JSON)
- Validation rules
- Examples

---

## Configuration Summary
**File:** `src/workflow/lib/config.ts`

| Section | Key Settings |
|---------|--------------|
| **Instagram** | 6 accounts, 4 posts/account, 20 req/min |
| **R2** | Bucket: `bucket-competition`, batch: 40 |
| **WhatsApp** | 2 newsletter channels |
| **Database** | SSL required, max connections: 1 |

---

## Error Handling

### Error Categories
**File:** `src/utils/enhanced-logger.ts`

```typescript
enum ErrorCategory {
  NETWORK,       // Network/HTTP errors
  DATABASE,      // Database errors
  AI_MODEL,      // AI API errors
  UNKNOWN,       // Uncategorized
}
```

### Retry Strategies
| Operation | Retry | Backoff |
|-----------|-------|---------|
| IG Scrape | Yes (1x) | Random 500-1000ms |
| R2 Upload | Yes (3x) | Exponential + jitter |
| AI Extraction | Yes (fallback) | Switch model |
| WhatsApp | No | Log error |

---

## Performance Metrics

### Subrequest Count
| Phase | Operation | Count (per 24 posts) |
|-------|-----------|---------------------|
| 1 | IG Scrape | ~24 fetches |
| 2 | R2 Upload | ~24 fetches (downloads) |
| 3 | DB Insert | 2 queries (SELECT + INSERT) |
| 4 | AI Extraction | 0 (external APIs) |
| 6 | WhatsApp | ~24 API calls |
| **Total** | **Per request** | ~50 subrequests |

### Timing Estimates
| Step | Duration (per 24 posts) |
|------|-------------------------|
| IG Scrape | ~30s |
| R2 Upload | ~40s |
| DB Insert | ~2s |
| AI Extraction | ~60-120s |
| WhatsApp | ~30s |
| **Total** | **~3-4 minutes** |

---

## Manual Trigger

### Endpoint
```
POST /api/trigger-scraping?code={TRIGGER_SECRET_CODE}
```

### Usage
```bash
curl -X POST "https://your-worker.workers.dev/api/trigger-scraping?code=secret"
```

### Security
Set `TRIGGER_SECRET_CODE` environment variable

---

## Development Commands

```bash
# Install dependencies
bun install

# Start local dev server
bun run dev

# Start Inngest dev server
bun run dev:inngest

# Deploy to Cloudflare
bun run deploy

# Generate types from wrangler.jsonc
bun run cf-typegen
```

---

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string

### Optional (with defaults)
- `R2_ENDPOINT` - R2 API endpoint
- `R2_BUCKET` - R2 bucket name
- `R2_PUBLIC_URL` - R2 public URL
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `WAHA_API_KEY` - WhatsApp API key
- `CHAT_1` - WhatsApp channel 1 ID
- `CHAT_2` - WhatsApp channel 2 ID
- `MISTRAL_API_KEY` - Mistral AI API key
- `OPENROUTER_API_KEY` - OpenRouter API key
- `GOOGLE_API_KEY` - Google AI API key
- `GROQ_API_KEY` - Groq API key
- `TRIGGER_SECRET_CODE` - Manual trigger secret

---

## Database Queries

### Fetch Draft Records for Extraction
```sql
SELECT id, title, description, poster
FROM competitions
WHERE status = 'draft'
ORDER BY "createdAt" DESC
LIMIT {count};
```

### Fetch Records for WhatsApp
```sql
SELECT id, title, poster, level, url, "endDate"
FROM competitions
WHERE ("whatsappChannel" = false OR "whatsappChannel" IS NULL)
  AND title IS NOT NULL AND title != ''
  AND poster IS NOT NULL AND poster != ''
  AND ("endDate" IS NULL OR "endDate" >= CURRENT_DATE)
ORDER BY id ASC;
```

### Check Duplicates
```sql
-- Check URL duplicate
SELECT COUNT(*) FROM competitions WHERE urlsource = '{url}';

-- Check description duplicate
SELECT COUNT(*) FROM competitions WHERE description = '{desc}';
```

---

## Troubleshooting

### "Too many subrequests"
**Cause:** Exceeding Cloudflare's 50 subrequest limit
**Fix:** Implemented batch processing in R2 upload (Step 2)

### AI Model Timeout
**Cause:** Long-running extraction on many records
**Fix:** Process in batches of 2 records

### WhatsApp Send Failure
**Cause:** Invalid session or API key
**Fix:** Check `WAHA_API_KEY` and session status

### Duplicate Records
**Cause:** Deduplication logic missed
**Fix:** Check `urlsource` and `description` matching

---

## File Structure

```
src/
├── index.ts                          # Hono app entry point
├── workflows/
│   └── competition-workflow.ts       # Main CF Workers workflow
├── workflow/
│   ├── 1.ig-scrape.ts                # Instagram scraping
│   ├── 1.web-scrape.ts               # Web scraping (backup)
│   ├── 2.upload-to-r2.ts             # R2 image upload
│   ├── 3.insertdb.ts                 # Database insertion
│   ├── 4.data-extraction.ts          # AI extraction
│   ├── 5.update-db.ts                # DB update (deprecated)
│   ├── 6.sending-wa.ts               # WhatsApp sending
│   └── lib/
│       ├── config.ts                 # Configuration
│       ├── types.ts                  # Type definitions
│       ├── db-utils.ts               # Database utilities
│       ├── model-function.ts         # AI model functions
│       ├── competition-schema.ts     # Zod schema
│       └── prompts.ts                # AI prompts
├── inngest/
│   └── index.ts                      # Inngest functions
└── utils/
    └── enhanced-logger.ts            # Logging utilities
```

---

## Version History

- **v1.0** - Initial workflow with sequential processing
- **v1.1** - Added batch processing for R2 upload (subrequest fix)
- **v1.2** - Added batch INSERT for database (subrequest fix)
- **v1.3** - Integrated Step 4 and Step 5 (stream processing)
- **v1.4** - Added multi-model AI pipeline with fallback
- **v1.5** - Added field source tracking

---

## License

Proprietary - Competition Automation System
