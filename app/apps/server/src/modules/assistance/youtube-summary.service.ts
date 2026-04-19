import { groq } from "@ai-sdk/groq";
import { generateText } from "ai";

import { ApiError } from "@/utils/api-error";

const TRANSCRIPT_API_URL = "https://youtube-transcript-api-tau-one.vercel.app/transcript";
const SUMMARY_MODEL = "llama-3.3-70b-versatile";

function getNestedValue(payload: unknown, path: string[]): unknown {
  let current: unknown = payload;

  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    current = Reflect.get(current, segment);
  }

  return current;
}

function collectTextFromArray(items: unknown[]): string {
  const parts: string[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      const value = item.trim();
      if (value) {
        parts.push(value);
      }
      continue;
    }

    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidatePaths = [
      ["text"],
      ["snippet"],
      ["line"],
      ["content"],
      ["caption"],
      ["transcript"],
      ["utterance"],
    ];

    for (const path of candidatePaths) {
      const value = getNestedValue(item, path);
      if (typeof value === "string" && value.trim()) {
        parts.push(value.trim());
        break;
      }
    }
  }

  return parts.join(" ").trim();
}

function extractTranscriptText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.trim();
  }

  const arrayCandidatePaths = [
    ["transcript"],
    ["data", "transcript"],
    ["captions"],
    ["data", "captions"],
    ["segments"],
    ["data", "segments"],
    ["items"],
    ["data", "items"],
    ["results"],
    ["data", "results"],
  ];

  for (const path of arrayCandidatePaths) {
    const value = getNestedValue(payload, path);
    if (Array.isArray(value)) {
      const text = collectTextFromArray(value);
      if (text) {
        return text;
      }
    }
  }

  const stringCandidatePaths = [
    ["transcript"],
    ["data", "transcript"],
    ["text"],
    ["data", "text"],
    ["content"],
    ["data", "content"],
  ];

  for (const path of stringCandidatePaths) {
    const value = getNestedValue(payload, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

export async function summariseYoutubeTranscript(videoUrl: string): Promise<{ summary: string; transcriptLength: number }> {
  const transcriptResponse = await fetch(TRANSCRIPT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      video_url: videoUrl,
    }),
  });

  const rawTranscriptBody = await transcriptResponse.text();

  let transcriptPayload: unknown = null;
  if (rawTranscriptBody) {
    try {
      transcriptPayload = JSON.parse(rawTranscriptBody);
    } catch {
      transcriptPayload = rawTranscriptBody;
    }
  }

  if (!transcriptResponse.ok) {
    throw new ApiError(502, "transcript_request_failed", "TRANSCRIPT_REQUEST_FAILED", {
      status: transcriptResponse.status,
      payload: transcriptPayload,
    });
  }

  const transcriptText = extractTranscriptText(transcriptPayload);

  if (!transcriptText) {
    throw new ApiError(502, "transcript_invalid_response", "TRANSCRIPT_INVALID_RESPONSE", {
      payload: transcriptPayload,
    });
  }

  try {
    const { text } = await generateText({
      model: groq(SUMMARY_MODEL),
      prompt: [
        "Summarize the following YouTube transcript.",
        "Return a concise structured summary with:",
        "1) Main topic",
        "2) Key points (bullet style)",
        "3) Actionable takeaways",
        "4) One-paragraph TL;DR",
        "Keep it clear and factual.",
        "",
        "Transcript:",
        transcriptText,
      ].join("\n"),
    });

    return {
      summary: text.trim(),
      transcriptLength: transcriptText.length,
    };
  } catch {
    throw new ApiError(502, "transcript_summary_failed", "TRANSCRIPT_SUMMARY_FAILED");
  }
}
