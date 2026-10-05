import { api, array, record, responseData } from "./client";
import type { components } from "./generated/schema";
export type Document = components["schemas"]["DocumentResponse"];
export type Extraction = components["schemas"]["ExtractionResponse"];
export type Candidate = components["schemas"]["Candidate"];
export type Scope = components["schemas"]["ExtractionScope"];
export type Decision = components["schemas"]["Decision"];
export type Proposal = components["schemas"]["ProposalResponse"];
export type Disclosure = components["schemas"]["DisclosureResponse"];
export type ProposalInput = components["schemas"]["ProposalRequest"];
export type BatchProposal = components['schemas']['BatchProposalResponse'];
export const batchPropose = (did:string, body:components['schemas']['BatchProposalRequest']) => responseData(api.POST('/api/documents/{did}/batches', {params:{path:{did}},body}));
export const batchInfo = (did:string,bid:string,signal?:AbortSignal) => responseData(api.GET('/api/documents/{did}/batches/{bid}', {params:{path:{did,bid}},signal}));
export const batchApprove = (did:string,bid:string,body:components['schemas']['ApprovalRequest']) => responseData(api.POST('/api/documents/{did}/batches/{bid}/approval',{params:{path:{did,bid}},body}));
export const documents = (signal?: AbortSignal) =>
  responseData(api.GET("/api/documents", { signal }));
export const documentInfo = (did: string, signal?: AbortSignal) =>
  responseData(
    api.GET("/api/documents/{did}", { params: { path: { did } }, signal }),
  );
export const pageInfo = (did: string, page: number, signal?: AbortSignal) =>
  responseData(
    api.GET("/api/documents/{did}/pages/{page}", {
      params: { path: { did, page } },
      signal,
    }),
  );
export const extractionHistory = (did: string, signal?: AbortSignal) =>
  responseData(
    api.GET("/api/documents/{did}/extractions", {
      params: { path: { did } },
      signal,
    }),
  );
export const extractionInfo = (
  did: string,
  eid: string,
  signal?: AbortSignal,
) =>
  responseData(
    api.GET("/api/documents/{did}/extractions/{eid}", {
      params: { path: { did, eid } },
      signal,
    }),
  );
export const disclose = (did: string, body: Scope) =>
  responseData(
    api.POST("/api/documents/{did}/disclosures", {
      params: { path: { did } },
      body,
    }),
  );
export const extract = (
  did: string,
  body: components["schemas"]["ExtractionRequest"],
) =>
  responseData(
    api.POST("/api/documents/{did}/extractions", {
      params: { path: { did } },
      body,
    }),
  );
export const review = (
  did: string,
  eid: string,
  body: components["schemas"]["ReviewRequest"],
) =>
  responseData(
    api.POST("/api/documents/{did}/extractions/{eid}/reviews", {
      params: { path: { did, eid } },
      body,
    }),
  );
export const propose = (did: string, body: ProposalInput) =>
  responseData(
    api.POST("/api/documents/{did}/proposals", {
      params: { path: { did } },
      body,
    }),
  );
export const proposalInfo = (did: string, pid: string, signal?: AbortSignal) =>
  responseData(
    api.GET("/api/documents/{did}/proposals/{pid}", {
      params: { path: { did, pid } },
      signal,
    }),
  );
export const approve = (
  did: string,
  pid: string,
  body: components["schemas"]["ApprovalRequest"],
) =>
  responseData(
    api.POST("/api/documents/{did}/proposals/{pid}/approval", {
      params: { path: { did, pid } },
      body,
    }),
  );
export async function uploadDocument(file: File) {
  if (
    !file.name.toLowerCase().endsWith(".pdf") ||
    file.size === 0 ||
    file.size > 64 * 1024 * 1024
  )
    throw Error("请选择非空 PDF，大小不超过 64 MiB。");
  return responseData(
    api.POST("/api/documents", {
      body: { file: file as unknown as string },
      bodySerializer: () => {
        const body = new FormData();
        body.append("file", file);
        return body;
      },
    }),
  );
}
export const cableModels = async (signal?: AbortSignal) =>
  array(
    await responseData(api.GET("/api/domain-cable-models", { signal })),
  ).map((value) => record(value));
