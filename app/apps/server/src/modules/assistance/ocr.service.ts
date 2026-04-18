import { groq } from "@ai-sdk/groq";
import { generateText } from "ai";

import { ApiError } from "@/utils/api-error";

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export async function extractTextFromRegion(regionBase64: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: groq(VISION_MODEL),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all visible text from this image exactly as it appears. Return only the raw text, no commentary.",
            },
            {
              type: "image",
              image: `data:image/png;base64,${regionBase64}`,
            },
          ],
        },
      ],
    });

    const extracted = text.trim();

    if (!extracted) {
      throw new ApiError(502, "ocr_extraction_failed", "OCR_EXTRACTION_FAILED");
    }

    return extracted;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(502, "ocr_extraction_failed", "OCR_EXTRACTION_FAILED");
  }
}