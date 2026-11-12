/**
 * Bulk files through the ReleaseReader (PLAN section 7 and M25; ADR 0039): what a Release's
 * `downloads/` is to the site. The reader checks every file against the datapackage when the
 * Release is opened, keeps the description and not the bytes, and hands out one named file.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseReader } from "./reader";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "./testing";

const A = "20260201T000000Z-aaaaaaa";
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

describe("a Release's bulk files, as the reader opens them", () => {
  it("lists each file the datapackage names, with its size, hash, rows and licence", async () => {
    const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const { downloads } = opened.release;
    expect(downloads).not.toBeNull();
    const names = downloads!.resources.map((r) => r.path);
    expect(names).toEqual(expect.arrayContaining(["observations.parquet", "observations.csv.gz", "observations.ndjson.gz", "vintages.parquet", "observations.citation_required.csv.gz"]));
    const csv = downloads!.resources.find((r) => r.path === "observations.csv.gz")!;
    const bytes = readFileSync(join(FIXTURE_ROOT, "releases", FIXTURE_ID, "downloads", "observations.csv.gz"));
    expect(csv.bytes).toBe(bytes.length);
    expect(csv.hash).toBe(`sha256:${sha256(bytes)}`);
    expect(csv.rows).toBe(145);
    expect(csv.series).toContain("fx_price_index");
    expect(csv.series).not.toContain("fx_exchange_index"); // Withheld
    expect(downloads!.release_id).toBe(FIXTURE_ID);
  });

  it("has none for a Release without them", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    promote(root, A);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.release.downloads).toBeNull();
  });

  it("refuses a Release whose bulk file is not the bytes the datapackage hashed", async () => {
    const root = tempRoot();
    const dir = addRelease(root, { id: A, bulk: true });
    appendFileSync(join(dir, "downloads", "observations.parquet"), "x");
    promote(root, A);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    expect(opened).toMatchObject({ ok: false, kind: "invalid" });
    if (!opened.ok) expect(opened.reason).toContain("downloads/observations.parquet");
  });

  it("refuses bulk files in a local-profile Release, and a file the datapackage does not name", async () => {
    const root = tempRoot();
    addRelease(root, { id: A, bulk: true, profile: "local" });
    promote(root, A);
    expect(await createReleaseReader({ root, surface: "local" }).current()).toMatchObject({ ok: false, kind: "invalid" });

    const other = tempRoot();
    const dir = addRelease(other, { id: A, bulk: true });
    writeFileSync(join(dir, "downloads", "observations.unknown.csv.gz"), "x");
    promote(other, A);
    expect(await createReleaseReader({ root: other, surface: "local" }).current()).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("hands out one named file as it is on disk, and nothing by any other name", async () => {
    const reader = createReleaseReader({ root: FIXTURE_ROOT, surface: "local" });
    const file = await reader.download!(FIXTURE_ID, "observations.ndjson.gz");
    expect(file).not.toBeNull();
    const bytes = readFileSync(join(FIXTURE_ROOT, "releases", FIXTURE_ID, "downloads", "observations.ndjson.gz"));
    expect(file!.bytes).toBe(bytes.length);
    expect((await drain(file!.stream())).equals(bytes)).toBe(true);

    for (const name of ["datapackage.json.bak", "../manifest.json", "..%2Fmanifest.json", "observations.xlsx", "", "observations.csv.gz/"]) {
      expect(await reader.download!(FIXTURE_ID, name)).toBeNull();
    }
    expect(await reader.download!("20200101T000000Z-0000000", "observations.csv.gz")).toBeNull();
  });

  it("hands out the datapackage itself", async () => {
    const reader = createReleaseReader({ root: FIXTURE_ROOT, surface: "local" });
    const file = await reader.download!(FIXTURE_ID, "datapackage.json");
    const text = (await drain(file!.stream())).toString("utf8");
    expect(JSON.parse(text).release_id).toBe(FIXTURE_ID);
  });

  it("gives nothing once the file on disk is no longer the one that was checked", async () => {
    const root = tempRoot();
    const dir = addRelease(root, { id: A, bulk: true });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    expect((await reader.current()).ok).toBe(true);
    appendFileSync(join(dir, "downloads", "observations.csv.gz"), "more");
    expect(await reader.download!(A, "observations.csv.gz")).toBeNull();
  });

  it("gives nothing from a Release that has left the root", async () => {
    const root = tempRoot();
    addRelease(root, { id: A, bulk: true });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    expect((await reader.current()).ok).toBe(true);
    mkdirSync(join(root, "retired"));
    renameSync(join(root, "releases", A), join(root, "retired", A));
    expect(await reader.download!(A, "observations.csv.gz")).toBeNull();
  });

  it("is refused with its Release on a public Surface when the Release may not be served there", async () => {
    const root = tempRoot();
    addRelease(root, { id: A, bulk: true, signed: false });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "production" });
    expect(await reader.current()).toMatchObject({ ok: false, kind: "refused" });
    expect(await reader.download!(A, "observations.csv.gz")).toBeNull();
  });
});

describe("a bulk file is sent a chunk at a time, as the reader of the response asks", () => {
  const big = Buffer.alloc(300 * 1024, 7).map((_, i) => i % 251);
  async function withBigFile(): Promise<{ root: string; reader: ReturnType<typeof createReleaseReader> }> {
    const root = tempRoot();
    const dir = addRelease(root, { id: A, bulk: true });
    writeFileSync(join(dir, "downloads", "observations.parquet"), big);
    const path = join(dir, "downloads", "datapackage.json");
    const pack = JSON.parse(readFileSync(path, "utf8")) as { resources: { path: string; bytes: number; hash: string }[] };
    const resource = pack.resources.find((r) => r.path === "observations.parquet")!;
    resource.bytes = big.length;
    resource.hash = `sha256:${sha256(big)}`;
    writeFileSync(path, JSON.stringify(pack));
    promote(root, A);
    return { root, reader: createReleaseReader({ root, surface: "local" }) };
  }

  it("gives the whole file, in chunks no larger than 64 KiB, and nothing is read before it is asked for", async () => {
    const { reader } = await withBigFile();
    const file = (await reader.download!(A, "observations.parquet"))!;
    const stream = file.stream().getReader();
    const first = await stream.read();
    expect(first.value!.length).toBe(64 * 1024);
    const parts = [first.value!];
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      expect(value.length).toBeLessThanOrEqual(64 * 1024);
      parts.push(value);
    }
    expect(parts.length).toBe(5);
    expect(Buffer.concat(parts).equals(big)).toBe(true);
  });

  it("goes on to the end of a file whose Release is pruned while it is being sent, and stops when the reader goes away", async () => {
    const { root, reader } = await withBigFile();
    const file = (await reader.download!(A, "observations.parquet"))!;
    const stream = file.stream().getReader();
    const first = await stream.read();
    mkdirSync(join(root, "trash"));
    renameSync(join(root, "releases", A), join(root, "trash", A));
    const parts = [first.value!];
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      parts.push(value);
    }
    expect(Buffer.concat(parts).equals(big)).toBe(true);
    // Once pruned, no new download of it begins.
    expect(await reader.download!(A, "observations.parquet")).toBeNull();

    const other = await withBigFile();
    const again = (await other.reader.download!(A, "observations.parquet"))!.stream().getReader();
    await again.read();
    await again.cancel();
    expect((await again.read()).done).toBe(true);
  });
});
