import { groq } from "@ai-sdk/groq";
import { generateObject } from "ai";
import { z } from "zod";

import { ApiError } from "@/utils/api-error";

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const distractionResultSchema = z.object({
  genuine: z.boolean(),
  reason: z.string().min(1),
});

export async function classifyDistraction(
  fullPageBase64: string,
  regionImages: string[],
): Promise<z.infer<typeof distractionResultSchema>> {
  try {
    const content = [
      {
        type: "text" as const,
        text:
          "The first image is the full page. The following images are the page regions where the user's gaze repeatedly landed. If any repeated region shows diagrams, charts, tables, figures, images, or code blocks, return genuine=true because it is a valid visual reference pattern. If all repeated regions are continuous prose text with no meaningful visual structure, return genuine=false because the pattern is likely distraction. Respond with a one-sentence reason.",
      },
      {
        type: "image" as const,
        image: `data:image/png;base64,${fullPageBase64}`,
      },
      ...regionImages.flatMap((image, index) => [
        {
          type: "text" as const,
          text: `Repeated gaze region ${index + 1}.`,
        },
        {
          type: "image" as const,
          image: `data:image/png;base64,${image}`,
        },
      ]),
    ];

    const { object } = await generateObject({
      model: groq(VISION_MODEL),
      messages: [
        {
          role: "user",
          content,
        },
      ],
      schema: distractionResultSchema,
      providerOptions: {
        groq: {
          strictJsonSchema: true,
        },
      },
    });

    return object;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(502, "distraction_check_failed", "DISTRACTION_CHECK_FAILED");
  }
}