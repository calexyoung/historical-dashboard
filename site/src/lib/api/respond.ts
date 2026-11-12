/**
 * How an answer of the read API leaves the app (PLAN section 7; ADR 0038): the route handlers'
 * one adapter. It copies the status and the body out and decides nothing else.
 *
 * Caching is the twins' rule (ADR 0031, point 11): only an answer the gate allowed on the
 * production Surface may be kept, for five minutes, with a validator made from its own bytes.
 * The answer has always been made, and so the gate has always been asked, before a validator
 * is compared: a 304 is never given for what would now be a 403.
 */
import { createHash } from "node:crypto";
import { BASE_PATH } from "../config";
import type { ApiResponse } from "./index";

export function respond(request: Request, answer: ApiResponse): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (answer.status === 308 && answer.location) return new Response(answer.body, { status: 308, headers: { ...headers, location: `${BASE_PATH}${answer.location}` } });
  if (answer.status === 200 && answer.cacheable) {
    const etag = `"${createHash("sha256").update(answer.body).digest("hex").slice(0, 32)}"`;
    headers["cache-control"] = "public, max-age=300";
    headers.etag = etag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  }
  return new Response(answer.body, { status: answer.status, headers });
}
