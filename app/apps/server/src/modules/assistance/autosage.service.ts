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

async function autosageRequest(path: string, body: unknown, includeAuth = true): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (includeAuth) {
    headers.Authorization = `Bearer ${env.AUTOSAGE_API_KEY}`;
  }

  const response = await fetch(new URL(path, env.AUTOSAGE_BASE_URL), {
    method: "POST",
    headers,
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
    console.error("[autosage] request failed", {
      path,
      status: response.status,
      requestBody: body,
      responsePayload: payload,
    });

    throw new ApiError(502, "autosage_request_failed", "AUTOSAGE_REQUEST_FAILED", {
      path,
      status: response.status,
      payload,
    });
  }

  return payload;
}

function buildKnowledgeBaseName(userId: string, userName?: string | null): string {
  const normalizedName = (userName ?? "").trim().replace(/\s+/g, " ");
  const fallback = `user-${userId.slice(0, 8)}`;
  const base = normalizedName.length > 0 ? normalizedName : fallback;
  const withSuffix = `${base} (${userId.slice(0, 8)})`;
  return withSuffix.length > 255 ? withSuffix.slice(0, 255) : withSuffix;
}

export async function createKnowledgeBase(userId: string, userName?: string | null): Promise<string> {
  const kbName = buildKnowledgeBaseName(userId, userName);

  const payload = await autosageRequest("/api/v1/knowledge-bases/", {
    tenant_id: env.AUTOSAGE_TENANT_ID.trim(),
    name: kbName,
    description: `Knowledge base for ${kbName}`,
    persona: "",
    customPrompt: "",
  });

  const kbId = getFirstString(payload, [
    ["id"],
    ["data", "id"],
    ["knowledgeBase", "id"],
    ["data", "knowledgeBase", "id"],
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
    tenant_id: env.AUTOSAGE_TENANT_ID.trim(),
    filename: fileName,
    mime_type: "application/pdf",
    size_bytes: sizeBytes,
  });

  const presignedUrl = getFirstString(payload, [
    ["presigned_url"],
    ["presignedUrl"],
    ["upload_url"],
    ["uploadUrl"],
    ["data", "presigned_url"],
    ["data", "presignedUrl"],
    ["data", "upload_url"],
    ["data", "uploadUrl"],
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
      ["document_id"],
      ["documentId"],
      ["data", "doc_id"],
      ["data", "docId"],
      ["data", "document_id"],
      ["data", "documentId"],
    ]),
  };
}

export async function fastQuery(
  kbId: string,
  chatId: string | null,
  content: string,
): Promise<AutosageFastQueryResult> {
  const normalizedChatId = chatId?.trim() ?? "";

  const requestBody: {
    knowledge_base_id: string;
    content: string;
    model: string;
    chunk_count: number;
    websearch_enable: boolean;
    chat_id?: string;
  } = {
    knowledge_base_id: kbId,
    content,
    model: "openai/gpt-5.4",
    chunk_count: 1,
    websearch_enable: true,
  };

  if (normalizedChatId.length > 0) {
    requestBody.chat_id = normalizedChatId;
  }

  const payload = await autosageRequest("/api/v1/chats/fast-query", requestBody);

  const answer = getFirstString(payload, [
    ["final_answer"],
    ["data", "final_answer"],
    ["finalAnswer"],
    ["data", "finalAnswer"],
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
    console.error("[autosage] fast-query invalid response payload", {
      endpoint: "chats/fast-query",
      payload,
    });

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
    newChatId: normalizedChatId.length === 0 && nextChatId ? nextChatId : undefined,
  };
}
