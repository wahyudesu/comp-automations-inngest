import fetch from "node-fetch";

const API_KEY = "JIzjS6jtWX3NCjsbAgNsJ4XF5MeHTE07";

// Predefined categories enum
const CATEGORIES_ENUM = [
  "Akademik",
  "Olahraga",
  "Seni dan Kreativitas",
  "Teknologi",
  "Bisnis dan Kewirausahaan",
  "Keilmuan",
  "Lainnya",
];

const body = {
  model: "mistral-ocr-latest",
  document: {
    type: "image_url",
    image_url:
      "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEiQcVygehhorodFgYDYlWKlSd8srRJRo1zqcDMV4DH_to2rEoj8NztX9yD_IS6Yalc4Um9wz5SjzzU8T2KWxlhuonXDhsTTZiE1hNtmmuIsAZBljSqvf7L8SpDqvAW6svnPHcecuP0YLAeecMxXvsg79YYd3iU25ZvI5V7LbeYOIQpieBc-6SLvQAkE6Ymw/s1280/IMG-20251215-WA0055.jpg",
  },
  document_annotation_format: {
    type: "json_schema",
    json_schema: {
      schema: {
        properties: {
          title: {
            title: "Title",
            description: "Judul kompetisi",
            type: "string",
          },
          organizer: {
            title: "Organizer",
            description: "Penyelenggara kompetisi",
            type: "string",
          },
          categories: {
            title: "Categories",
            description: `Kategori lomba. Pilih salah satu dari: ${CATEGORIES_ENUM.join(", ")}`,
            type: "string",
            enum: CATEGORIES_ENUM,
          },
          level: {
            title: "Level",
            description: "Tingkat peserta",
            type: "string",
          },
          startDate: {
            title: "StartDate",
            description: "DD-MM-YYYY",
            type: "string",
          },
          endDate: {
            title: "EndDate",
            description: "DD-MM-YYYY",
            type: "string",
          },
          format: {
            title: "Format",
            description: "Online/Offline/Hybrid",
            type: "string",
            enum: ["Online", "Offline", "Hybrid"],
          },
          participationType: {
            title: "ParticipationType",
            description: "Individual/Team",
            type: "string",
            enum: ["Individual", "Team"],
          },
          pricing: {
            title: "Pricing",
            description: "Biaya pendaftaran dalam Rupiah (array of numbers). Kosong atau null jika gratis.",
            type: "array",
            items: {
              type: "number",
            },
          },
          contact: {
            title: "Contact",
            description: "Kontak penyelenggara dengan format {nama: nomor}",
            type: "object",
            additionalProperties: { type: "string" },
          },
          url: {
            title: "RegistrationUrl",
            description: "Link URL for registration competition",
            type: "string",
          },
        },
        required: [],
        title: "CompetitionAnnotation",
        type: "object",
        additionalProperties: false,
      },
      name: "competition_annotation",
      strict: true,
    },
  },
  include_image_base64: true,
};

async function run() {
  try {
    const res = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`API Error: ${res.status} ${res.statusText}`);
      console.error(errorText);
      process.exit(1);
    }

    const json = await res.json();

    // document_annotation is a JSON string, need to parse it first
    let annotation;
    if (typeof json.document_annotation === "string") {
      annotation = JSON.parse(json.document_annotation);
    } else {
      annotation = json.document_annotation;
    }

    // Output raw JSON to stdout
    console.log(JSON.stringify(annotation));
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

run();
