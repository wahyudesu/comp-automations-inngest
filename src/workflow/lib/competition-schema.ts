import { z } from "zod";

export const CompetitionCategory = [
  "Akademik & Sains",
  "Teknologi & IT",
  "Seni & Kreatif",
  "Bisnis & Startup",
  "Olahraga & E-sports",
  "Sastra & Bahasa",
  "Sosial & Lingkungan",
  "Keagamaan",
  "Gaya Hidup & Hobi",
  "Lainnya",
] as const;

export type CompetitionCategory = (typeof CompetitionCategory)[number];

export const CompetitionSchema = z.object({
  title: z.string().nullish().describe("nama or title of competition. Return null if not found"),
  organizer: z.union([z.string(), z.array(z.string())]).nullish().describe("Competition organizer (single or multiple). Return null if not found"),
  // description: z.string().optional(), // description taken directly from instagram captions
  categories: z
    .union([z.enum(CompetitionCategory), z.array(z.enum(CompetitionCategory))])
    .nullish()
    .describe(
      `Competition category for AI/hint mapping:
		Akademik & Sains: Olimpiade, Karya Tulis Ilmiah (KTI), Esai, Debat, Pidato, Riset
		Teknologi & IT: Coding/Programming, Robotik, UI/UX Design, Cyber Security, Data Science, Game Dev
		Seni & Kreatif: Fotografi, Videografi, Desain Grafis, Ilustrasi, Seni Lukis, Musik, Tari, Teater
		Bisnis & Startup: Business Plan, Pitching, Marketing Plan, Stock Trading, Social Entrepreneurship
		Olahraga & E-sports: Atletik, Bela Diri, Permainan Tim, Mobile Legends, PUBG, Valorant
		Sastra & Bahasa: Cerpen, Puisi, Menulis Artikel, Jurnalistik, Storytelling
		Sosial & Lingkungan: Inovasi Sosial, Kampanye Lingkungan, SDGs, Volunteerism
		Keagamaan: MTQ, Nasyid, Cerdas Cermat Agama, Da'i Muda
		Gaya Hidup & Hobi: Memasak (Culinary), Fashion/Beauty Pageant, Modeling, Cosplay
		Lainnya: Lomba Tradisional, Kuis, Game Show, Lomba Hobi Unik`,
    ),
  level: z
    .union([z.enum(["SD", "SMP", "SMA", "Mahasiswa", "Umum"]), z.array(z.enum(["SD", "SMP", "SMA", "Mahasiswa", "Umum"]))])
    .nullish()
    .describe("Participant level (SD, SMP, SMA, Mahasiswa, Umum). Return null if not found"),

  startDate: z
    .union([z.string(), z.array(z.string())])
    .nullish()
    .describe("Registration start date, format YYYY-MM-DD. Return null if not found"),
  endDate: z
    .union([z.string(), z.array(z.string())])
    .nullish()
    .describe("Registration end date, format YYYY-MM-DD. Return null if not found"),

  format: z
    .enum(["Online", "Offline", "Hybrid"])
    .nullish()
    .describe("Competition format: Online/Offline/Hybrid. Return null if not found"),

  participationType: z
    .union([z.enum(["Individual", "Team"]), z.array(z.enum(["Individual", "Team"]))])
    .nullish()
    .describe("Participation type: Individual or Team or both. Return null if not found"),

  pricing: z
    .union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))])
    .nullish()
    .describe("Registration fee in rupiah, 0 means free, Return null if not found"),
  contact: z
    .array(z.record(z.string()))
    .nullish()
    .describe("Contact list: array of { name: phone }. Return null if not found"),

  url: z.string().nullish().describe("Registration URL link. Return null if not found"),
  location: z.string().nullish().describe("country (e.g., Indonesia, Malaysia, Brunei, etc.)"),
});


/**
 * JSON Schema for Mistral structured output
 * Uses anyOf for fields that can be string or array
 */
export const MISTRAL_JSON = {
  type: "object",
  properties: {
    title: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "nama or title of competition. Return null if not found."
    },
    organizer: {
      anyOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
        { type: "null" }
      ],
      description: "Competition organizer (single or multiple). Return null if not found."
    },
    categories: {
      anyOf: [
        { type: "string", enum: [...CompetitionCategory] },
        { type: "array", items: { type: "string", enum: [...CompetitionCategory] } },
        { type: "null" }
      ],
      description: `Competition category: ${CompetitionCategory.join(", ")}. Return null if not found.`
    },
    level: {
      anyOf: [
        { type: "string", enum: ["SD", "SMP", "SMA", "Mahasiswa", "Umum"] },
        { type: "array", items: { type: "string", enum: ["SD", "SMP", "SMA", "Mahasiswa", "Umum"] } },
        { type: "null" }
      ],
      description: "Participant level (SD, SMP, SMA, Mahasiswa, Umum). Return null if not found."
    },
    startDate: {
      anyOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
        { type: "null" }
      ],
      description: "Registration start date, format YYYY-MM-DD. Return null if not found."
    },
    endDate: {
      anyOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
        { type: "null" }
      ],
      description: "Registration end date, format YYYY-MM-DD. Return null if not found."
    },
    format: {
      anyOf: [
        { type: "string", enum: ["Online", "Offline", "Hybrid"] },
        { type: "null" }
      ],
      description: "Competition format (Online, Offline, Hybrid). Return null if not found."
    },
    participationType: {
      anyOf: [
        { type: "string", enum: ["Individual", "Team"] },
        { type: "array", items: { type: "string", enum: ["Individual", "Team"] } },
        { type: "null" }
      ],
      description: "Participation type (Individual, Team). Return null if not found."
    },
    pricing: {
      anyOf: [
        { type: "number" },
        { type: "string" },
        { type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }] } },
        { type: "null" }
      ],
      description: "Registration fee in rupiah. Return null if not found."
    },
    contact: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        { type: "null" }
      ],
      description: "Contact list: array of { name: phone }. Example: [{ \"Budi\": \"+628123456789\" }, { \"Siti\": \"+628987654321\" }]. Return null if not found."
    },
    url: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Registration URL link. Return null if not found."
    },
    location: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "country (e.g., Indonesia, Malaysia, Brunei, etc.). Return null if not found."
    },
  },
  required: [],
  additionalProperties: false,
} as const;
