import { env } from "@/utils/env";
import { ApiError } from "@/utils/api-error";

type AutosageFastQueryResult = {
  answer: string;
  newChatId?: string;
};

type AutosagePresignResult = {
  presignedUrl: string;
  autosageDocumentId?: string;
};

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

function getFirstString(payload: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = getNestedValue(payload, path);

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

async function autosageRequest(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, env.AUTOSAGE_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AUTOSAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawBody = await response.text();

  let payload: unknown = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = rawBody;
    }
  }

  if (!response.ok) {
    throw new ApiError(502, "autosage_request_failed", "AUTOSAGE_REQUEST_FAILED", {
      path,
      status: response.status,
      payload,
    });
  }

  return payload;
}

export async function createKnowledgeBase(userId: string): Promise<string> {
  const payload = await autosageRequest("/api/v1/knowledge-bases/", {
    tenant_id: env.AUTOSAGE_TENANT_ID,
    name: `kb-${userId}`,
    description: `Knowledge base for user ${userId}`,
    persona: "",
    customPrompt: "",
  });

  const kbId = getFirstString(payload, [
    ["id"],
    ["data", "id"],
    ["knowledge_base_id"],
    ["data", "knowledge_base_id"],
    ["kb_id"],
    ["data", "kb_id"],
  ]);

  if (!kbId) {
    throw new ApiError(502, "autosage_invalid_response", "AUTOSAGE_INVALID_RESPONSE", {
      endpoint: "knowledge-bases",
      payload,
    });
  }

  return kbId;
}

export async function getPresignForDocument(
  kbId: string,
  fileName: string,
  sizeBytes: number,
): Promise<AutosagePresignResult> {
  const payload = await autosageRequest("/api/v1/documents/presign", {
    kb_id: kbId,
    tenant_id: env.AUTOSAGE_TENANT_ID,
    filename: fileName,
    mime_type: "application/pdf",
    size_bytes: sizeBytes,
  });

  const presignedUrl = getFirstString(payload, [
    ["presigned_url"],
    ["presignedUrl"],
    ["data", "presigned_url"],
    ["data", "presignedUrl"],
  ]);

  if (!presignedUrl) {
    throw new ApiError(502, "autosage_invalid_response", "AUTOSAGE_INVALID_RESPONSE", {
      endpoint: "documents/presign",
      payload,
    });
  }

  return {
    presignedUrl,
    autosageDocumentId: getFirstString(payload, [
      ["doc_id"],
      ["docId"],
      ["data", "doc_id"],
      ["data", "docId"],
    ]),
  };
}

export async function fastQuery(
  kbId: string,
  chatId: string | null,
  content: string,
): Promise<AutosageFastQueryResult> {
  const payload = await autosageRequest("/api/v1/chats/fast-query", {
    knowledge_base_id: kbId,
    content,
    model: "openai/gpt-5.4",
    chat_id: chatId ?? "",
    chunk_count: 5,
    websearch_enable: false,
  });

  const answer = getFirstString(payload, [
    ["answer"],
    ["data", "answer"],
    ["response"],
    ["data", "response"],
    ["message"],
    ["data", "message"],
    ["result", "answer"],
    ["result", "response"],
  ]);

  if (!answer) {
    throw new ApiError(502, "autosage_invalid_response", "AUTOSAGE_INVALID_RESPONSE", {
      endpoint: "chats/fast-query",
      payload,
    });
  }

  const nextChatId = getFirstString(payload, [
    ["chat_id"],
    ["data", "chat_id"],
    ["chatId"],
    ["data", "chatId"],
  ]);

  return {
    answer,
    newChatId: !chatId && nextChatId ? nextChatId : undefined,
  };
}