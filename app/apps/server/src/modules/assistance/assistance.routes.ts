import { Elysia } from "elysia";
import { z } from "zod";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { authService } from "@/modules/auth/auth.service";
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

const summariseLineBody = z.object({
  docId: documentId,
  pageNumber: z.number().int().positive(),
  regionBase64: z.string().min(1),
});

const regionImageObject = z.object({
  imageBase64: z.string().min(1),
  pageNumber: z.number().int().positive(),
});

const checkDistractionBody = z.object({
  docId: documentId,
  fullPageBase64: z.string().min(1),
  fullPagePageNumber: z.number().int().positive(),
  regionImages: z.array(z.union([z.string().min(1), regionImageObject])).min(2).max(5),
  pageNumbers: z.array(z.number().int().positive()).min(1).optional(),
  recentCoordinates: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        ts: z.number().int().positive(),
        source: z.enum(["eye", "cursor"]).optional(),
        pageNumber: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(2000)
    .optional(),
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
      const hydratedUser = await authService.ensureKnowledgeBaseForUser(currentUser.id, { strict: true });
      const document = await documentsService.getOwnedDocument(body.docId, currentUser.id);
      const kbId = requireKnowledgeBase(hydratedUser.kbId);

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
      const hydratedUser = await authService.ensureKnowledgeBaseForUser(currentUser.id, { strict: true });
      const document = await documentsService.getOwnedDocument(body.docId, currentUser.id);
      const kbId = requireKnowledgeBase(hydratedUser.kbId);
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
    "/summarise-line",
    async ({ body, currentUser }) => {
      const hydratedUser = await authService.ensureKnowledgeBaseForUser(currentUser.id, { strict: true });
      const document = await documentsService.getOwnedDocument(body.docId, currentUser.id);
      const kbId = requireKnowledgeBase(hydratedUser.kbId);
      const ocrText = await extractTextFromRegion(body.regionBase64);

      const prompt = `The user looked distracted while reading page ${body.pageNumber} of '${document.fileName}'. The OCR text from the specific line region is: ${JSON.stringify(ocrText)}. Summarize only this line/region in 1-2 concise sentences. Do not summarize the whole page.`;

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
      body: summariseLineBody,
      detail: {
        summary: "Summarise a specific reread/distraction line region",
      },
    },
  )
  .post(
    "/check-distraction",
    async ({ body, currentUser }) => {
      await documentsService.getOwnedDocument(body.docId, currentUser.id);

      const normalizedRegions = body.regionImages.map((region) =>
        typeof region === "string"
          ? {
              imageBase64: region,
              pageNumber: body.fullPagePageNumber,
            }
          : region,
      );

      const mergedPageNumbers = Array.from(
        new Set([
          body.fullPagePageNumber,
          ...normalizedRegions.map((region) => region.pageNumber),
          ...(body.pageNumbers ?? []),
        ]),
      ).sort((a, b) => a - b);

      const result = await classifyDistraction(
        body.fullPageBase64,
        normalizedRegions.map((region) => region.imageBase64),
        body.recentCoordinates,
      );

      return {
        ...result,
        pageNumbers: mergedPageNumbers,
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
