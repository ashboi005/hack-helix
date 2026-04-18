import { Elysia } from "elysia";
import { z } from "zod";

import { authContextPlugin } from "@/modules/auth/auth.service";
import { documentsService } from "./documents.service";

const documentIdParams = z.object({
  id: z.string().uuid(),
});

const initiateUploadBody = z.object({
  fileName: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
});

export const documentRoutes = new Elysia({ prefix: "/documents", tags: ["Documents"] })
  .use(authContextPlugin)
  .post(
    "/initiate-upload",
    ({ body, currentUser }) => documentsService.initiateUpload(currentUser.id, currentUser.kbId, body),
    {
      auth: true,
      body: initiateUploadBody,
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
      detail: {
        summary: "Delete a document metadata record",
      },
    },
  );