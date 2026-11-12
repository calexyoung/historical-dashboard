/**
 * A pinned link (PLAN 4.5 and M18's acceptance criterion): "a pinned link to a retained release
 * shows the same data after a newer release is promoted and returns 410 once pruned".
 *
 * Through the two modules a request passes: the gate, which fixes the request to a Release, and
 * the view, which draws from the Release it is handed. The root is a temporary one holding
 * variants of the synthetic fixture release; pruning is done as the writer does it, by renaming
 * the Release into trash/ (atlas/publish/root.py, `prune`).
 */
import { mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_HEADER, gate, RELEASE_HEADER } from "../gate";
import { createReleaseReader, type ReleaseReader } from "../release/reader";
import { addRelease, promote, tempRoot } from "../release/testing";
import { parseExplorerParams } from "./state";
import { explorerView } from "./view";

const A = "20260201T000000Z-aaaaaaa";
const B = "20260202T000000Z-bbbbbbb";
const QUERY = "s=fx_price_index&mode=lin&from=2025-01&to=2025-11";

/** What a request for this address is answered with: a status, and the values drawn when it is 200. */
async function ask(reader: ReleaseReader, search: string): Promise<{ status: number; release?: string; current?: string | null; values?: (number | null)[]; body?: string }> {
  const decision = await gate({ reader, surface: "local", dev: false, nonce: "n", basePath: "/macro-atlas" }, { host: "localhost:3000", pathname: "/explore", search: `?${search}` });
  if (decision.action === "respond") return { status: decision.status, body: decision.body };
  const id = decision.requestHeaders[RELEASE_HEADER]!;
  const opened = await reader.open(id); // what releaseForRequest does with the header
  if (!opened.ok) throw new Error(opened.reason);
  const view = explorerView(opened.release, "local", parseExplorerParams(new URLSearchParams(search)));
  return { status: 200, release: id, current: decision.requestHeaders[CURRENT_HEADER], values: view.runs[0]!.rows.map((r) => r.value) };
}

function rootWithTwo(): string {
  const root = tempRoot();
  addRelease(root, { id: A });
  // The newer Release revised every value of the Series.
  addRelease(root, { id: B, edit: { fx_price_index: (file) => file.observations.forEach((o: { value: number | null }) => (o.value = o.value === null ? null : o.value + 7)) } });
  promote(root, A);
  return root;
}

describe("a pinned link", () => {
  it("shows the same data after a newer release is promoted, and answers 410 once the release is pruned", async () => {
    const root = rootWithTwo();
    const reader = createReleaseReader({ root, surface: "local" });
    const before = await ask(reader, `${QUERY}&pin=${A}`);
    expect(before).toMatchObject({ status: 200, release: A, current: A });
    expect(before.values!.filter((v) => v !== null).length).toBeGreaterThan(5);

    promote(root, B);
    const unpinned = await ask(reader, QUERY);
    expect(unpinned).toMatchObject({ status: 200, release: B });
    expect(unpinned.values).not.toEqual(before.values);
    const after = await ask(reader, `${QUERY}&pin=${A}`);
    expect(after).toMatchObject({ status: 200, release: A, current: B });
    expect(after.values).toEqual(before.values);

    // Retention takes it: renamed into trash/, where it stays a day. This process still has it in memory.
    mkdirSync(join(root, "trash"), { recursive: true });
    renameSync(join(root, "releases", A), join(root, "trash", A));
    const gone = await ask(reader, `${QUERY}&pin=${A}`);
    expect(gone.status).toBe(410);
    expect(gone.body).toContain(`href="/macro-atlas/explore?${QUERY.replace(/&/g, "&#38;")}"`);
    expect(gone.body).not.toMatch(/10[0-9]\.[0-9]/); // no value of either Release
    // And the same view on the current Release still opens.
    expect(await ask(reader, QUERY)).toMatchObject({ status: 200, release: B });
  });

  it("a release id that never was is gone too: there is no figure to show for it", async () => {
    const reader = createReleaseReader({ root: rootWithTwo(), surface: "local" });
    expect((await ask(reader, `${QUERY}&pin=20200101T000000Z-fffffff`)).status).toBe(410);
  });

  it("a fresh process answers 410 for a pruned release as well: nothing is opened from the trash", async () => {
    const root = rootWithTwo();
    mkdirSync(join(root, "trash"), { recursive: true });
    promote(root, B);
    renameSync(join(root, "releases", A), join(root, "trash", A));
    expect((await ask(createReleaseReader({ root, surface: "local" }), `${QUERY}&pin=${A}`)).status).toBe(410);
  });

  it("a link in place of a release directory is not a release of this root: 503, and nothing from where it points", async () => {
    const root = rootWithTwo();
    const elsewhere = tempRoot();
    addRelease(elsewhere, { id: B });
    rmSync(join(root, "releases", B), { recursive: true });
    symlinkSync(join(elsewhere, "releases", B), join(root, "releases", B));
    expect((await ask(createReleaseReader({ root, surface: "local" }), `${QUERY}&pin=${B}`)).status).toBe(503);
  });

  it("a production build refuses a pinned release it would refuse as CURRENT (PLAN 6.1: current, pinned or rolled back)", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    addRelease(root, { id: B, profile: "local" });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "production" });
    const decision = await gate({ reader, surface: "production", dev: false, nonce: "n", basePath: "/macro-atlas" }, { host: "mydashboards.co", pathname: "/explore", search: `?pin=${B}` });
    expect(decision).toMatchObject({ action: "respond", status: 503 });
  });

  it("is not kept past a withdrawal: a release moved out of the root is gone", async () => {
    const root = rootWithTwo();
    const reader = createReleaseReader({ root, surface: "local" });
    expect((await ask(reader, `${QUERY}&pin=${A}`)).status).toBe(200);
    promote(root, B);
    rmSync(join(root, "releases", A), { recursive: true }); // `atlas withdraw` moves it to the store's retired/
    expect((await ask(reader, `${QUERY}&pin=${A}`)).status).toBe(410);
  });
});
