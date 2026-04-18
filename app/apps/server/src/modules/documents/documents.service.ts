import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { getPresignForDocument } from "@/modules/assistance/autosage.service";
import { ApiError } from "@/utils/api-error";

const documentSummarySelection = {
  id: documents.id,
  fileName: documents.fileName,
  createdAt: documents.createdAt,
};

type InitiateUploadInput = {
  fileName: string;
  fileSizeBytes: number;
};

function requireKnowledgeBase(kbId: string | null): string {
  if (!kbId) {
    throw new ApiError(409, "knowledge_base_not_ready", "KNOWLEDGE_BASE_NOT_READY");
  }

  return kbId;
}

async function getOwnedDocument(id: string, userId: string) {
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);

  if (!document) {
    throw new ApiError(404, "document_not_found", "DOCUMENT_NOT_FOUND");
  }

  return document;
}

async function initiateUpload(userId: string, kbId: string | null, input: InitiateUploadInput) {
  const knowledgeBaseId = requireKnowledgeBase(kbId);
  const { presignedUrl } = await getPresignForDocument(knowledgeBaseId, input.fileName, input.fileSizeBytes);

  const [document] = await db
    .insert(documents)
    .values({
      userId,
      fileName: input.fileName,
    })
    .returning({
      id: documents.id,
    });

  if (!document) {
    throw new ApiError(500, "document_creation_failed", "DOCUMENT_CREATION_FAILED");
  }

  return {
    presignedUrl,
    documentId: document.id,
  };
}

async function listDocuments(userId: string) {
  return db
    .select(documentSummarySelection)
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt));
}

async function getDocumentSummary(id: string, userId: string) {
  const document = await getOwnedDocument(id, userId);

  return {
    id: document.id,
    fileName: document.fileName,
    createdAt: document.createdAt,
  };
}

async function deleteDocument(id: string, userId: string): Promise<void> {
  await getOwnedDocument(id, userId);

  await db.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, userId)));
}

async function updateDocumentChatId(id: string, userId: string, autosageChatId: string): Promise<void> {
  await db
    .update(documents)
    .set({ autosageChatId })
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
}

export const documentsService = {
  deleteDocument,
  getDocumentSummary,
  getOwnedDocument,
  initiateUpload,
  listDocuments,
  updateDocumentChatId,
};