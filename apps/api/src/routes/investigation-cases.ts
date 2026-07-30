/** Saved investigation-case current state, notes, and evidence-link HTTP routes. */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  AddInvestigationCaseNoteBodySchema,
  CreateInvestigationCaseBodySchema,
  InvestigationCaseDetailSchema,
  InvestigationCaseEvidenceInputSchema,
  InvestigationCaseNoteSchema,
  InvestigationCasePageSchema,
  InvestigationCaseReviewSchema,
  UpdateInvestigationCaseBodySchema,
} from "@reliability-lab/contracts";
import {
  caseReviewPacketFilename,
  renderInvestigationCaseReviewPacket,
} from "@reliability-lab/core";
import type { AppOptions } from "../app-options.js";
import { arrayValue } from "../http/query-values.js";
import { ErrorSchema, TenantOnlyHeadersSchema } from "../schemas/common.js";
import {
  InvestigationCaseEvidenceParamsSchema,
  InvestigationCaseEvidenceRemovedSchema,
  InvestigationCaseEvidenceResultSchema,
  InvestigationCaseListQuerySchema,
  InvestigationCaseParamsSchema,
} from "../schemas/investigation-cases.js";

type InvestigationCaseRouteOptions = Pick<
  AppOptions,
  "investigationCases" | "investigationCaseReviews"
>;

export const investigationCaseRoutes: FastifyPluginAsync<InvestigationCaseRouteOptions> = async (
  app,
  options,
) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.post(
    "/v1/investigation-cases",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        body: CreateInvestigationCaseBodySchema,
        response: { 201: InvestigationCaseDetailSchema, 400: ErrorSchema },
      },
    },
    async (request, reply) => {
      const detail = await options.investigationCases.create(
        request.headers["x-tenant-id"],
        request.body,
      );
      request.log.info(
        { caseId: detail.case.caseId, operation: "case.created" },
        "investigation case created",
      );
      return reply.code(201).send(detail);
    },
  );

  api.get(
    "/v1/investigation-cases",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        querystring: InvestigationCaseListQuerySchema,
        response: { 200: InvestigationCasePageSchema, 400: ErrorSchema },
      },
    },
    async (request) =>
      options.investigationCases.list(request.headers["x-tenant-id"], {
        limit: request.query.limit ?? 25,
        ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        ...(request.query.status ? { statuses: arrayValue(request.query.status) } : {}),
        ...(request.query.importance ? { importance: request.query.importance } : {}),
        ...(request.query.q ? { query: request.query.q } : {}),
        ...(request.query.executionId ? { executionId: request.query.executionId } : {}),
      }),
  );

  api.get(
    "/v1/investigation-cases/:caseId",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseParamsSchema,
        response: { 200: InvestigationCaseDetailSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      options.investigationCases.get(request.headers["x-tenant-id"], request.params.caseId),
  );

  api.get(
    "/v1/investigation-cases/:caseId/review",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseParamsSchema,
        response: { 200: InvestigationCaseReviewSchema, 404: ErrorSchema },
      },
    },
    async (request) => {
      const review = await options.investigationCaseReviews.get(
        request.headers["x-tenant-id"],
        request.params.caseId,
      );
      request.log.info(
        {
          caseId: request.params.caseId,
          operation: "case.review_read",
          evidenceCount: review.evidence.length,
        },
        "investigation case review read",
      );
      return review;
    },
  );

  api.get(
    "/v1/investigation-cases/:caseId/review-packet",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseParamsSchema,
        response: { 200: Type.String(), 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const review = await options.investigationCaseReviews.get(
        request.headers["x-tenant-id"],
        request.params.caseId,
      );
      request.log.info(
        {
          caseId: request.params.caseId,
          operation: "case.review_packet_read",
          evidenceCount: review.evidence.length,
        },
        "investigation case review packet read",
      );
      return reply
        .header("content-type", "text/markdown; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="${caseReviewPacketFilename(request.params.caseId)}"`,
        )
        .send(renderInvestigationCaseReviewPacket(review));
    },
  );

  api.patch(
    "/v1/investigation-cases/:caseId",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseParamsSchema,
        body: UpdateInvestigationCaseBodySchema,
        response: {
          200: InvestigationCaseDetailSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => {
      const detail = await options.investigationCases.update(
        request.headers["x-tenant-id"],
        request.params.caseId,
        request.body,
      );
      request.log.info(
        { caseId: request.params.caseId, operation: "case.updated" },
        "investigation case updated",
      );
      return detail;
    },
  );

  api.post(
    "/v1/investigation-cases/:caseId/notes",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseParamsSchema,
        body: AddInvestigationCaseNoteBodySchema,
        response: {
          201: InvestigationCaseNoteSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const note = await options.investigationCases.addNote(
        request.headers["x-tenant-id"],
        request.params.caseId,
        request.body,
      );
      request.log.info(
        { caseId: request.params.caseId, operation: "case.note_added" },
        "investigation case note added",
      );
      return reply.code(201).send(note);
    },
  );

  api.post(
    "/v1/investigation-cases/:caseId/evidence",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseParamsSchema,
        body: InvestigationCaseEvidenceInputSchema,
        response: {
          200: InvestigationCaseEvidenceResultSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => {
      const result = await options.investigationCases.addEvidence(
        request.headers["x-tenant-id"],
        request.params.caseId,
        request.body,
      );
      request.log.info(
        {
          caseId: request.params.caseId,
          operation: "case.evidence_added",
          evidenceType: request.body.type,
          added: result.added,
        },
        "investigation case evidence linked",
      );
      return result;
    },
  );

  api.delete(
    "/v1/investigation-cases/:caseId/evidence/:evidenceId",
    {
      schema: {
        tags: ["investigation-cases"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: InvestigationCaseEvidenceParamsSchema,
        response: { 200: InvestigationCaseEvidenceRemovedSchema, 404: ErrorSchema },
      },
    },
    async (request) => {
      await options.investigationCases.removeEvidence(
        request.headers["x-tenant-id"],
        request.params.caseId,
        request.params.evidenceId,
      );
      request.log.info(
        { caseId: request.params.caseId, operation: "case.evidence_removed" },
        "investigation case evidence unlinked",
      );
      return { removed: true as const };
    },
  );
};
