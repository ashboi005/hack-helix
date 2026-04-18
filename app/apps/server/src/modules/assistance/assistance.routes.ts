import { Elysia } from "elysia";
import { z } from "zod";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { documentsService } from "@/modules/documents/documents.service";
import { ApiError } from "@/utils/api-error";

import { fastQuery } from "./autosage.service";
import { classifyDistraction } from "./distraction.service";
import { extractTextFromRegion } from "./ocr.service";

const documentId = z.string().uuid();

const summariseBody = z
  .object({
    docId: documentId,
    scope: z.enum(["full", "partial"]),
    pageNumbers: z.array(z.number().int().positive()).min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === "partial" && (!value.pageNumbers || value.pageNumbers.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "pageNumbers is required when scope is partial",
        path: ["pageNumbers"],
      });
    }
  });

const explainRereadBody = z.object({
  docId: documentId,
  pageNumber: z.number().int().positive(),
  regionBase64: z.string().min(1),
});

const checkDistractionBody = z.object({
  docId: documentId,
  fullPageBase64: z.string().min(1),
  regionImages: z.array(z.string().min(1)).min(2).max(4),
  pageNumbers: z.array(z.number().int().positive()).min(1),
});

function requireKnowledgeBase(kbId: string | null): string {
  if (!kbId) {
    throw new ApiError(409, "knowledge_base_not_ready", "KNOWLEDGE_BASE_NOT_READY");
  }

  return kbId;
}

export const assistanceRoutes = new Elysia({ prefix: "/assistance", tags: ["Assistance"] })
  .use(authContextPlugin)
  .post(
    "/summarise",
    async ({ body, currentUser }) => {
      const document = await documentsService.getOwnedDocument(body.docId, currentUser.id);
      const kbId = requireKnowledgeBase(currentUser.kbId);

      const prompt =
        body.scope === "full"
          ? `You are summarizing a PDF titled '${document.fileName}'. Provide a clear, structured summary of the entire document, focusing on key ideas and important concepts.`
          : `You are summarizing a PDF titled '${document.fileName}'. The user is currently around pages ${body.pageNumbers?.join(", ")}. Provide a clear, structured summary of these pages only.`;

      const { answer, newChatId } = await fastQuery(kbId, document.autosageChatId, prompt);

      if (newChatId) {
        await documentsService.updateDocumentChatId(document.id, currentUser.id, newChatId);
      }

      return {
        summary: answer,
      };
    },
    {
      auth: true,
      body: summariseBody,
      detail: {
        summary: "Summarise a whole document or a subset of pages",
      },
    },
  )
  .post(
    "/explain-reread",
    async ({ body, currentUser }) => {
      const document = await documentsService.getOwnedDocument(body.docId, currentUser.id);
      const kbId = requireKnowledgeBase(currentUser.kbId);
      const ocrText = await extractTextFromRegion(body.regionBase64);

      const prompt = `The user is struggling with the following text from page ${body.pageNumber} of their document '${document.fileName}': ${JSON.stringify(ocrText)}. Explain this text clearly and simply, as if explaining to someone new to the subject.`;

      const { answer, newChatId } = await fastQuery(kbId, document.autosageChatId, prompt);

      if (newChatId) {
        await documentsService.updateDocumentChatId(document.id, currentUser.id, newChatId);
      }

      return {
        explanation: answer,
      };
    },
    {
      auth: true,
      body: explainRereadBody,
      detail: {
        summary: "Explain text from a re-read document region",
      },
    },
  )
  .post(
    "/check-distraction",
    async ({ body, currentUser }) => {
      await documentsService.getOwnedDocument(body.docId, currentUser.id);

      const result = await classifyDistraction(body.fullPageBase64, body.regionImages);

      return {
        ...result,
        pageNumbers: body.pageNumbers,
      };
    },
    {
      auth: true,
      body: checkDistractionBody,
      detail: {
        summary: "Classify whether repeated gaze regions are genuine visual references or distraction",
      },
    },
  );