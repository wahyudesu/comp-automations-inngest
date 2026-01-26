import { z } from "zod";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Mistral } from "@mistralai/mistralai";
import { responseFormatFromZodObject } from "@mistralai/mistralai/extra/structChat.js";
import { CompetitionSchema, MISTRAL_JSON } from "./competition-schema.js";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { Agent } from "@mastra/core/agent";
import { EXTRACTION_PROMPT } from "./prompts.js";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const mistralClient = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
// const mistralVercel = createMistral({ apiKey: process.env.MISTRAL_API_KEY});
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

const openrouterModel = openrouter("bytedance-seed/seedream-4.5"); // multimodal
const geminiModel = google("gemini-2.5-flash"); //multimodalapiKey
// const zaiModel = openai('glm-4.7'); // replaced with Mastra Agent
const groqModel = groq("openai/gpt-oss-120b"); //multimodal

// Mastra Agent with GLM-4.5v (vision model)
const zaiAgent = new Agent({
  name: "zai-agent",
  instructions:
    "You are a helpful assistant that extracts competition information from images and text.",
  model: "zai-coding-plan/glm-4.5v",
});

export async function geminiImageToText(imageUrl: string) {
  const result = await generateText({
    model: geminiModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
          { type: "image", image: imageUrl },
        ],
      },
    ],
    output: Output.object({
      schema: CompetitionSchema,
    }),
  });
  return result.output as any;
}

export async function openrouterTextToText(text: string) {
  const result = await generateText({
    model: openrouterModel,
    prompt: `${EXTRACTION_PROMPT}\n\nText to extract from:\n${text}`,
    output: Output.object({
      schema: CompetitionSchema,
    }),
  });
  return result.output as any;
}

export async function zaiTextToText(text: string) {
  const response = await zaiAgent.generate(
    [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nText to extract from:\n${text}`,
      },
    ],
    {
      structuredOutput: {
        schema: CompetitionSchema,
        jsonPromptInjection: true,
      },
    },
  );
  // Extract object before disposing
  const result = response.object;
  // Dispose RPC resources to prevent resource leak warning
  // response.dispose?.();
  return result;
}

export async function zaiImageToText(imageUrl: string) {
  const response = await zaiAgent.generate(
    [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: imageUrl,
            mimeType: "image/jpeg",
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
    {
      structuredOutput: {
        schema: CompetitionSchema,
        jsonPromptInjection: true,
      },
    },
  );
  // Extract object before disposing
  const result = response.object;
  // Dispose RPC resources to prevent resource leak warning
  // response.dispose?.();
  return result;
}

export async function groqImageToText(imageUrl: string) {
  const result = await generateText({
    model: groqModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
          { type: "image", image: imageUrl },
        ],
      },
    ],
    output: Output.object({
      schema: CompetitionSchema,
    }),
  });
  return result.output as any;
}

export async function mistralOCR(imageUrl: string) {
  const body = {
    model: "mistral-ocr-latest",
    document: {
      type: "image_url",
      image_url: imageUrl,
    },
    include_image_base64: true,
    document_annotation_format: {
      type: "json_schema",
      json_schema: {
        name: "competition_annotation",
        strict: false,
        schema: MISTRAL_JSON,
      },
    },
  };

  const res = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Mistral OCR API Error: ${res.status} ${res.statusText} - ${errorText}`);
  }

  const json: any = await res.json();

  // Parse document_annotation if it's a string
  let annotation = (json as any).document_annotation;
  if (typeof annotation === "string") {
    try {
      annotation = JSON.parse(annotation);
    } catch (e) {
      throw new Error(`Failed to parse document_annotation JSON: ${(e as Error).message}`);
    }
  }

  return annotation;
}
