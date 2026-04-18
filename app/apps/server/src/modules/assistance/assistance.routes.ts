import { Elysia, t } from "elysia";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { documentsService } from "@/modules/documents/documents.service";
import { ApiError } from "@/utils/api-error";

import { fastQuery } from "./autosage.service";
import { classifyDistraction } from "./distraction.service";
import { extractTextFromRegion } from "./ocr.service";

const summariseBody = t.Union([
  t.Object({
    docId: t.String({ format: "uuid" }),
    scope: t.Literal("full"),
  }),
  t.Object({
    docId: t.String({ format: "uuid" }),
    scope: t.Literal("partial"),
    pageNumbers: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
  }),
]);

const explainRereadBody = t.Object({
  docId: t.String({ format: "uuid" }),
  pageNumber: t.Number({ minimum: 1 }),
  regionBase64: t.String({ minLength: 1 }),
});

const checkDistractionBody = t.Object({
  docId: t.String({ format: "uuid" }),
  fullPageBase64: t.String({ minLength: 1 }),
  regionImages: t.Array(t.String({ minLength: 1 }), { minItems: 2, maxItems: 4 }),
  pageNumbers: t.Array(t.Number({ minimum: 1 }), { minItems: 1 }),
});

const summariseResponse = t.Object({
  summary: t.String(),
});

const explainResponse = t.Object({
  explanation: t.String(),
});

const distractionResponse = t.Object({
  genuine: t.Boolean(),
  reason: t.String(),
  pageNumbers: t.Array(t.Number()),
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
      response: summariseResponse,
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
      response: explainResponse,
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
      response: distractionResponse,
      detail: {
        summary: "Classify whether repeated gaze regions are genuine visual references or distraction",
      },
    },
  );