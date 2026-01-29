import postgres from "postgres";
import { mistralOCR, geminiImageToText } from "./lib/model-function.js";
import { CompetitionSchema, CompetitionCategory } from "./lib/competition-schema.js";
import {
  createLogger,
  type EnhancedLogger,
  logError,
  ErrorCategory,
} from "../utils/enhanced-logger.js";

// Valid enum values untuk validation
const VALID_LEVELS = ["SD", "SMP", "SMA", "Mahasiswa", "Umum"];
const VALID_FORMATS = ["Online", "Offline", "Hybrid"];
const VALID_PARTICIPATION = ["Individual", "Team"];

function normalize(data: any) {
  // Remove undefined/null values entirely to prevent validation errors
  const cleaned: any = {};

  // IMPORTANT: Set all nullable fields to null if missing/invalid
  // This prevents "expected array, received undefined" errors

  // Convert single string to array for organizer
  if (typeof data.organizer === "string") {
    cleaned.organizer = [data.organizer];
  } else if (Array.isArray(data.organizer) && data.organizer.length > 0) {
    cleaned.organizer = data.organizer;
  } else {
    cleaned.organizer = null; // Explicit null instead of undefined
  }

  // Convert single string to array for level - validate against enum
  if (typeof data.level === "string") {
    const normalizedLevel = normalizeLevel(data.level);
    cleaned.level = normalizedLevel ? [normalizedLevel] : null;
  } else if (Array.isArray(data.level) && data.level.length > 0) {
    const validLevels = data.level
      .map((l: string) => normalizeLevel(l))
      .filter(Boolean);
    cleaned.level = validLevels.length > 0 ? validLevels : null;
  } else {
    cleaned.level = null;
  }

  // Convert pricing - handle string numbers and nested objects
  if (typeof data.pricing === "number") {
    cleaned.pricing = [data.pricing];
  } else if (typeof data.pricing === "string") {
    const num = parseRupiah(data.pricing);
    cleaned.pricing = num !== null ? [num] : null;
  } else if (Array.isArray(data.pricing) && data.pricing.length > 0) {
    const prices = data.pricing
      .map((p: any) => {
        if (typeof p === "number") return p;
        if (typeof p === "string") return parseRupiah(p);
        if (typeof p === "object" && p.amount) return parseRupiah(p.amount);
        return null;
      })
      .filter((p: number | null) => p !== null);
    cleaned.pricing = prices.length > 0 ? prices : null;
  } else if (data.pricing?.amount) {
    const num = parseRupiah(data.pricing.amount);
    cleaned.pricing = num !== null ? [num] : null;
  } else {
    cleaned.pricing = null;
  }

  // Handle contact - array of strings
  if (Array.isArray(data.contact) && data.contact.length > 0) {
    // Filter to only strings and non-empty values
    cleaned.contact = data.contact.filter((c: any) => typeof c === "string" && c.trim());
    if (cleaned.contact.length === 0) cleaned.contact = null;
  } else if (typeof data.contact === "string" && data.contact.trim()) {
    cleaned.contact = [data.contact.trim()];
  } else {
    cleaned.contact = null;
  }

  // Handle categories - validate against allowed values
  if (typeof data.categories === "string") {
    const normalizedCat = normalizeCategory(data.categories);
    cleaned.categories = normalizedCat ? [normalizedCat] : null;
  } else if (Array.isArray(data.categories) && data.categories.length > 0) {
    const validCategories = data.categories
      .map((c: any) => {
        if (typeof c === "string") return normalizeCategory(c);
        if (typeof c === "object" && c.type) return normalizeCategory(c.type);
        return null;
      })
      .filter(Boolean);
    cleaned.categories = validCategories.length > 0 ? validCategories : null;
  } else if (data.categories?.type) {
    const normalizedCat = normalizeCategory(data.categories.type);
    cleaned.categories = normalizedCat ? [normalizedCat] : null;
  } else {
    cleaned.categories = null;
  }

  // Validate format enum
  if (typeof data.format === "string") {
    const normalizedFormat = normalizeFormat(data.format);
    cleaned.format = normalizedFormat !== null ? normalizedFormat : null;
  } else {
    cleaned.format = null;
  }

  // Validate participationType enum - MUST be array of allowed values
  if (Array.isArray(data.participationType) && data.participationType.length > 0) {
    const validTypes = data.participationType
      .map((t: any) => {
        if (typeof t === "string") return normalizeParticipationType(t);
        return null;
      })
      .filter(Boolean);
    cleaned.participationType = validTypes.length > 0 ? validTypes : null;
  } else if (typeof data.participationType === "string") {
    // Handle single string → convert to array
    const normalizedPart = normalizeParticipationType(data.participationType);
    cleaned.participationType = normalizedPart !== null ? [normalizedPart] : null;
  } else {
    cleaned.participationType = null;
  }

  // Handle title
  if (typeof data.title === "string" && data.title.trim()) {
    cleaned.title = data.title.trim();
  } else if (
    typeof data.competitionName === "string" &&
    data.competitionName.trim()
  ) {
    cleaned.title = data.competitionName.trim();
  } else if (typeof data.name === "string" && data.name.trim()) {
    cleaned.title = data.name.trim();
  } else {
    cleaned.title = null;
  }

  // Handle dates - ensure they're in YYYY-MM-DD format
  // Handle array → take first element, handle string → normalize directly
  if (Array.isArray(data.startDate) && data.startDate.length > 0) {
    cleaned.startDate = normalizeDate(data.startDate[0]);
  } else if (typeof data.startDate === "string" && data.startDate.trim()) {
    cleaned.startDate = normalizeDate(data.startDate);
  } else {
    cleaned.startDate = null;
  }
  if (Array.isArray(data.endDate) && data.endDate.length > 0) {
    cleaned.endDate = normalizeDate(data.endDate[0]);
  } else if (typeof data.endDate === "string" && data.endDate.trim()) {
    cleaned.endDate = normalizeDate(data.endDate);
  } else {
    cleaned.endDate = null;
  }

  // Handle URL
  // Check both 'url' and 'registrationUrl' (legacy compatibility)
  const urlValue = data.url || data.registrationUrl;

  if (typeof urlValue === "string" && urlValue.trim()) {
    cleaned.url = urlValue.trim();
  } else if (Array.isArray(urlValue) && urlValue.length > 0) {
    // AI sometimes returns array - take first URL (registration URL preferred)
    const firstUrl = urlValue[0];
    if (typeof firstUrl === "string" && firstUrl.trim()) {
      cleaned.url = firstUrl.trim();
    } else {
      cleaned.url = null;
    }
  } else {
    cleaned.url = null;
  }

  // Handle location
  if (typeof data.location === "string" && data.location.trim()) {
    cleaned.location = data.location.trim();
  } else {
    cleaned.location = null;
  }

  return cleaned;
}

// Helper: Parse "Rp 50.000" or "50000" to number
function parseRupiah(value: string | number): number | null {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "string") return null;

  const cleaned = value.replace(/[^\d]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// Helper: Normalize category to valid enum value
function normalizeCategory(cat: string): string | null {
  if (!cat || typeof cat !== "string") return null;

  const normalized = cat.trim();
  if (CompetitionCategory.includes(normalized as any)) return normalized;

  // Fuzzy matching for common variations
  const lower = normalized.toLowerCase();
  if (
    lower.includes("akademik") ||
    lower.includes("sains") ||
    lower.includes("olympiade") ||
    lower.includes("kti") ||
    lower.includes("esai") ||
    lower.includes("riset")
  ) {
    return "Akademik & Sains";
  }
  if (
    lower.includes("teknologi") ||
    lower.includes("it") ||
    lower.includes("coding") ||
    lower.includes("programming") ||
    lower.includes("robotik") ||
    lower.includes("ui") ||
    lower.includes("ux")
  ) {
    return "Teknologi & IT";
  }
  if (
    lower.includes("seni") ||
    lower.includes("kreatif") ||
    lower.includes("desain") ||
    lower.includes("fotografi") ||
    lower.includes("musik") ||
    lower.includes("tari")
  ) {
    return "Seni & Kreatif";
  }
  if (
    lower.includes("bisnis") ||
    lower.includes("startup") ||
    lower.includes("business") ||
    lower.includes("pitching")
  ) {
    return "Bisnis & Startup";
  }
  if (
    lower.includes("olahraga") ||
    lower.includes("esport") ||
    lower.includes("game") ||
    lower.includes("mobile legend")
  ) {
    return "Olahraga & E-sports";
  }
  if (
    lower.includes("sastra") ||
    lower.includes("bahasa") ||
    lower.includes("cerpen") ||
    lower.includes("puisi")
  ) {
    return "Sastra & Bahasa";
  }
  if (lower.includes("sosial") || lower.includes("lingkungan")) {
    return "Sosial & Lingkungan";
  }
  if (
    lower.includes("agama") ||
    lower.includes("islam") ||
    lower.includes("mtq")
  ) {
    return "Keagamaan";
  }

  return "Lainnya"; // Default fallback
}

// Helper: Normalize level to valid enum value
function normalizeLevel(level: string): string | null {
  if (!level || typeof level !== "string") return null;

  const normalized = level.trim().toUpperCase();
  if (VALID_LEVELS.includes(normalized as any)) return normalized;

  const lower = level.toLowerCase();
  if (lower.includes("sd") || lower.includes("sekolah dasar")) return "SD";
  if (lower.includes("smp") || lower.includes("m ts")) return "SMP";
  if (lower.includes("sma") || lower.includes("smk") || lower.includes("ma"))
    return "SMA";
  if (
    lower.includes("mahasiswa") ||
    lower.includes("kuliah") ||
    lower.includes("universitas")
  )
    return "Mahasiswa";
  if (lower.includes("umum") || lower.includes("public")) return "Umum";

  return null;
}

// Helper: Normalize format to valid enum value
function normalizeFormat(format: string): string | null {
  if (!format || typeof format !== "string") return null;

  const normalized = format.trim();
  if (VALID_FORMATS.includes(normalized as any)) return normalized;

  const lower = normalized.toLowerCase();
  if (
    lower.includes("online") ||
    lower.includes("daring") ||
    lower.includes("zoom") ||
    lower.includes("gmeet")
  )
    return "Online";
  if (
    lower.includes("offline") ||
    lower.includes("luring") ||
    lower.includes("tatap muka")
  )
    return "Offline";
  if (lower.includes("hybrid") || lower.includes("gabungan")) return "Hybrid";

  return null;
}

// Helper: Normalize participation type to valid enum value
function normalizeParticipationType(type: string): string | null {
  if (!type || typeof type !== "string") return null;

  const normalized = type.trim();
  if (VALID_PARTICIPATION.includes(normalized as any)) return normalized;

  const lower = normalized.toLowerCase();
  if (
    lower.includes("individu") ||
    lower.includes("individual") ||
    lower.includes("personal")
  )
    return "Individual";
  if (
    lower.includes("tim") ||
    lower.includes("team") ||
    lower.includes("kelompok") ||
    lower.includes("group")
  )
    return "Team";

  return null;
}

// Helper: Normalize date to YYYY-MM-DD format
function normalizeDate(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;

  // Try to match various date formats
  const cleaned = dateStr.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = cleaned.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // If already valid, return as-is
  return cleaned;
}

function merge(base: any, update: any) {
  const result = { ...base };

  for (const key in update) {
    const value = update[key];

    // Skip null, undefined, or empty values
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      continue;

    // Check if base already has a value (protect text extraction result)
    const baseValue = base[key];
    const hasExistingValue =
      baseValue !== null &&
      baseValue !== undefined &&
      baseValue !== "" &&
      !(Array.isArray(baseValue) && baseValue.length === 0) &&
      !(
        typeof baseValue === "object" &&
        !Array.isArray(baseValue) &&
        Object.keys(baseValue).length === 0
      );

    // Don't overwrite existing value from text extraction
    if (hasExistingValue) continue;

    // Merge the value
    if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Deep merge for objects
      result[key] = { ...(base[key] || {}), ...value };
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Track which source provided each field
type FieldSource = {
  [field: string]: "zai" | "mistral" | "gemini" | null;
};

// Track model usage for statistics
type ModelUsage = {
  zai: number;
  mistral: number;
  gemini: number;
};

// Per-record extraction details
type RecordExtractionDetail = {
  recordId: number;
  fieldSource: FieldSource;
};

async function extractSingle(post: any, parentLog?: EnhancedLogger, modelUsage?: ModelUsage) {
  const log = parentLog ?? createLogger({ workflowStep: "4-extract-single" });
  const postLog = log.child({ workflowStep: `4-extract-post-${post.id}` });

  const { description, poster, id } = post;

  postLog.debug("Starting extraction for post", {
    postId: id,
    hasDescription: !!description,
    hasPoster: !!poster,
  });

  let data: any = {
    title: null,
    organizer: null,
    level: null,
    startDate: null,
    endDate: null,
    format: null,
    participationType: null,
    pricing: null,
    contact: null,
    url: null,
    location: null,
    categories: null,
  };

  const fieldSource: FieldSource = {};

  // Helper: track which fields were added
  function trackSource(sourceData: any, sourceName: "zai" | "mistral" | "gemini") {
    for (const key in sourceData) {
      if (sourceData[key] !== null && sourceData[key] !== undefined) {
        if (!fieldSource[key]) {
          fieldSource[key] = sourceName;
        }
      }
    }
  }

  // Helper: track newly added fields (for fallback models)
  function trackNewFields(
    baseData: any,
    newData: any,
    sourceName: "zai" | "mistral" | "gemini"
  ) {
    for (const key in newData) {
      if (newData[key] !== null && newData[key] !== undefined) {
        if (baseData[key] === null || baseData[key] === undefined) {
          fieldSource[key] = sourceName;
        }
      }
    }
  }

  // Step 1: Extract from description (caption) using Zai text-to-text
  postLog.debug("Attempting Zai text extraction from caption");
  if (description && description.trim()) {
    try {
      const textResult = await postLog.time("zai-text-extraction", async () => {
        const { zaiTextToText } = await import("./lib/model-function.js");
        return await zaiTextToText(description);
      });
      const normalized = normalize(textResult);
      data = merge(data, normalized);
      trackSource(normalized, "zai");
      if (modelUsage) modelUsage.zai++;
      postLog.debug("Zai text extraction completed", {
        fieldsAdded: Object.keys(normalized).length,
      });
    } catch (error: any) {
      logError(postLog, error as Error, {
        operation: "zai-text-extraction",
        category: ErrorCategory.AI_MODEL,
        recoverable: true,
        metadata: { postId: id },
      });
    }
  } else {
    postLog.debug("Zai text extraction skipped (no caption)");
  }

  // Step 2: Extract from poster image with Mistral OCR (fill missing fields)
  postLog.debug("Attempting Mistral OCR extraction from poster");
  let mistralSuccess = false;

  try {
    const mistralData = await postLog.time("mistral-ocr-extraction", async () => {
      return await mistralOCR(poster);
    });
    const mistralParsed = normalize(mistralData);
    const mistralValidation = CompetitionSchema.safeParse(mistralParsed);

    if (mistralValidation.success) {
      const beforeMerge = { ...data };
      data = merge(data, mistralParsed);
      trackNewFields(data, mistralParsed, "mistral");

      if (modelUsage) modelUsage.mistral++;
      mistralSuccess = true;
      postLog.debug("Mistral OCR completed successfully", {
        fieldsAdded: Object.keys(mistralParsed).length,
      });
    } else {
      postLog.warn("Mistral OCR validation failed, will try Gemini", {
        errors: mistralValidation.error.issues.map((i: any) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
  } catch (error: any) {
    logError(postLog, error as Error, {
      operation: "mistral-ocr-extraction",
      category: ErrorCategory.AI_MODEL,
      recoverable: true,
      metadata: { postId: id },
    });
  }

  // Step 3: Fallback to Gemini if Mistral failed
  if (!mistralSuccess) {
    postLog.debug("Falling back to Gemini extraction");
    try {
      const geminiResult = await postLog.time("gemini-extraction", async () => {
        return await geminiImageToText(poster);
      });
      const geminiParsed = normalize(geminiResult);
      const beforeMerge = { ...data };
      data = merge(data, geminiParsed);
      trackNewFields(beforeMerge, geminiParsed, "gemini");

      if (modelUsage) modelUsage.gemini++;
      postLog.debug("Gemini extraction completed", {
        fieldsAdded: Object.keys(geminiParsed).length,
      });
    } catch (error: any) {
      logError(postLog, error as Error, {
        operation: "gemini-extraction",
        category: ErrorCategory.AI_MODEL,
        recoverable: true,
        metadata: { postId: id },
      });
    }
  }

  // Log field source summary
  postLog.debug("Field extraction summary", { fieldSources: fieldSource });

  // Validate and return
  const result = CompetitionSchema.safeParse(data);

  if (!result.success) {
    postLog.warn("Schema validation partial failure", {
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });

    const partialData: any = {};
    const validFields = [
      "title",
      "organizer",
      "level",
      "startDate",
      "endDate",
      "format",
      "participationType",
      "pricing",
      "contact",
      "url",
      "location",
      "categories",
    ];

    for (const field of validFields) {
      if (data[field] !== null && data[field] !== undefined) {
        try {
          const singleFieldTest = (CompetitionSchema as any).pick({
            [field]: true,
          }).safeParse({ [field]: data[field] });
          if (singleFieldTest.success) {
            partialData[field] = data[field];
          } else {
            postLog.debug("Skipping invalid field", { field });
          }
        } catch (e) {
          postLog.debug("Skipping invalid field", { field });
        }
      }
    }

    postLog.debug("Partial validation result", {
      validFieldsCount: Object.keys(partialData).length,
      totalFields: validFields.length,
    });

    return {
      ...post,
      aiAnalysis: partialData,
      extractionSuccess: true,
      extractionError: result.error?.issues,
      fieldSource,
    };
  }

  postLog.debug("Schema validation passed");

  return {
    ...post,
    aiAnalysis: result.data,
    extractionSuccess: true,
    extractionError: null,
    fieldSource,
  };
}

export async function extractData(
  newCount: number,
  existingIds: number[],
  env: any,
  parentLog?: EnhancedLogger,
) {
  const log = parentLog ?? createLogger({ workflowStep: "4-data-extraction" });

  if (!env.DATABASE_URL) {
    log.fatal("DATABASE_URL is not set", undefined, {
      required: true,
      provided: false,
    });
    throw new Error("DATABASE_URL is not set");
  }

  const totalCount = newCount + existingIds.length;
  if (totalCount === 0) {
    log.info("No posts to extract from");
    return {
      success: true,
      count: 0,
      modelUsage: { zai: 0, mistral: 0, gemini: 0 },
      totalDuration: 0,
      records: [] as RecordExtractionDetail[],
    };
  }

  log.info("Starting AI data extraction", {
    newCount,
    existingIdsCount: existingIds.length,
    totalCount,
  });

  const sql = postgres(env.DATABASE_URL, {
    ssl: "require",
    max: 1,
  });

  try {
    const posts: any[] = [];
    const modelUsage: ModelUsage = { zai: 0, mistral: 0, gemini: 0 };

    log.startTimer("ai-extraction-total");

    // Fetch newly inserted draft records (most recent)
    if (newCount > 0) {
      const newPosts = await log.time("db-fetch-new", async () => {
        return await sql`
          SELECT id, title, description, poster
          FROM competitions
          WHERE status = 'draft'
          ORDER BY "createdAt" DESC
          LIMIT ${newCount}
        `;
      });
      posts.push(...newPosts);
      log.info("Fetched new draft records", { count: newPosts.length });
    }

    // Fetch existing records that need extraction
    if (existingIds.length > 0) {
      const existingPosts = await log.time("db-fetch-existing", async () => {
        return await sql`
          SELECT id, title, description, poster
          FROM competitions
          WHERE id IN ${sql(existingIds)}
        `;
      });
      posts.push(...existingPosts);
      log.info("Fetched existing records", { count: existingPosts.length });
    }

    if (posts.length === 0) {
      log.warn("No draft records found in database");
      return {
        success: true,
        count: 0,
        modelUsage: { zai: 0, mistral: 0, gemini: 0 },
        totalDuration: 0,
        records: [] as RecordExtractionDetail[],
      };
    }

    log.info("Starting AI extraction for posts", {
      totalPosts: posts.length,
      models: ["zai", "mistral", "gemini"],
    });

    // Extract AI data for each post and IMMEDIATELY update to DB (stream processing)
    let successCount = 0;
    let errorCount = 0;
    const records: RecordExtractionDetail[] = [];

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const postLog = log.child({
        workflowStep: `4-extract-post-${post.id}`,
      });

      postLog.debug("Extracting data from post", {
        postId: post.id,
        title: post.title?.substring(0, 50),
        index: i + 1,
        total: posts.length,
      });

      try {
        const extracted = await postLog.time(
          `extract-single-post-${post.id}`,
          () => extractSingle(post, log, modelUsage)
        );

        // Collect per-record extraction details
        records.push({
          recordId: extracted.id,
          fieldSource: extracted.fieldSource || {},
        });

        if (extracted.extractionSuccess && extracted.aiAnalysis) {
          await postLog.time(`db-update-${post.id}`, async () => {
            await updateSingleRecord(sql, extracted.id, extracted.aiAnalysis);
          });
          postLog.debug("Updated database record", { postId: extracted.id });
          successCount++;
        } else {
          postLog.warn("Extraction produced no valid data", {
            postId: extracted.id,
          });
          errorCount++;
        }
      } catch (error: any) {
        logError(postLog, error as Error, {
          operation: "extract-and-update-post",
          category: ErrorCategory.DATABASE,
          recoverable: true,
          metadata: { postId: post.id, title: post.title },
        });
        errorCount++;
      }
    }

    const totalTime = log.endTimer("ai-extraction-total");

    log.info("Extraction completed", {
      successCount,
      errorCount,
      totalDuration: Math.round(totalTime),
      avgDuration: Math.round(totalTime / posts.length),
      modelUsage,
    });

    return {
      success: true,
      count: successCount,
      modelUsage,
      totalDuration: totalTime,
      records,
    };
  } catch (error) {
    log.fatal("Fatal error in extraction", error as Error);
    throw error;
  } finally {
    // Gracefully close connection - ignore errors during cleanup
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function updateSingleRecord(sql: ReturnType<typeof postgres>, id: number, ai: any) {
  const { buildUpdateObject } = await import("./lib/db-utils.js");
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
