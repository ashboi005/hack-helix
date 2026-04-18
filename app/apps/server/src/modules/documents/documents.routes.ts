import { Elysia, t } from "elysia";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { documentsService } from "./documents.service";

const documentIdParams = t.Object({
  id: t.String({ format: "uuid" }),
});

const initiateUploadBody = t.Object({
  fileName: t.String({ minLength: 1 }),
  fileSizeBytes: t.Number({ minimum: 1 }),
});

const documentSummarySchema = t.Object({
  id: t.String({ format: "uuid" }),
  fileName: t.String(),
  createdAt: t.Date(),
});

const initiateUploadResponseSchema = t.Object({
  presignedUrl: t.String(),
  documentId: t.String({ format: "uuid" }),
});

export const documentRoutes = new Elysia({ prefix: "/documents", tags: ["Documents"] })
  .use(authContextPlugin)
  .post(
    "/initiate-upload",
    ({ body, currentUser }) => documentsService.initiateUpload(currentUser.id, currentUser.kbId, body),
    {
      auth: true,
      body: initiateUploadBody,
      response: initiateUploadResponseSchema,
      detail: {
        summary: "Create a document record and request an AutoSage upload URL",
      },
    },
  )
  .get(
    "/",
    ({ currentUser }) => documentsService.listDocuments(currentUser.id),
    {
      auth: true,
      response: t.Array(documentSummarySchema),
      detail: {
        summary: "List document metadata for the authenticated user",
      },
    },
  )
  .get(
    "/:id",
    ({ params, currentUser }) => documentsService.getDocumentSummary(params.id, currentUser.id),
    {
      auth: true,
      params: documentIdParams,
      response: documentSummarySchema,
      detail: {
        summary: "Get a single document metadata record",
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, currentUser, set }) => {
      await documentsService.deleteDocument(params.id, currentUser.id);
      set.status = 204;
      return undefined;
    },
    {
      auth: true,
      params: documentIdParams,
      response: {
        204: t.Null(),
      },
      detail: {
        summary: "Delete a document metadata record",
      },
    },
  );