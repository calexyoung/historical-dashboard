/**
 * `atlas-core claim --release DIR --request FILE`: the rows a Claim lock freezes (PLAN 4.5;
 * ADR 0003, ADR 0034). Python hands over the part of a Claim the engine reads
 * (`{"format": 1, "release_id": ..., "spec": {said_on, said_at?, checked_on, readings}}`); this
 * computes each Reading's *then* and *now when checked* rows on the Release in DIR and prints
 * them as one JSON document. It reads the Release and the request and writes no file.
 *
 * Exit status: 0 an answer was printed (`ok: true`, or `ok: false` with the reason a Claim
 * cannot be locked on this Release); 2 the command could not be followed.
 */
import { lstatSync } from "node:fs";
import { lockEvidence, type ClaimSpec } from "../claim";
import { readJson, releaseSource } from "./source";

const USAGE = "usage: atlas-core claim --release DIR --request FILE";

export function main(argv: readonly string[]): number {
  const args = [...argv];
  const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    const [, value] = args.splice(at, 2);
    return value;
  };
  const command = args.shift();
  const release = option("--release");
  const requestPath = option("--request");
  if (command !== "claim" || !release || !requestPath || args.length > 0) {
    console.error(USAGE);
    return 2;
  }
  try {
    if (!lstatSync(release).isDirectory()) throw new Error(`${release} is not a release directory`);
    const request = readJson(requestPath) as { format?: unknown; release_id?: unknown; spec?: ClaimSpec };
    if (request.format !== 1 || typeof request.release_id !== "string" || typeof request.spec !== "object" || request.spec === null) {
      throw new Error("the request does not hold a release id and a Claim's readings");
    }
    process.stdout.write(`${JSON.stringify(lockEvidence(request.spec, releaseSource(release, request.release_id)))}\n`);
    return 0;
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
}
