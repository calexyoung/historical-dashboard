/**
 * User notes, read for a local build (PLAN section 5 and M21; ADR 0033 decision 14, ADR 0035).
 *
 * A User note is one user's own remark on a Claim, a Series or a Topic: `notes/{user}/{id}.md`,
 * as `atlas add note` writes it (atlas/content/notes.py). It may hold a judgment, which is why
 * it is the user's and not Macro Atlas's. It is in no Release of either Profile, so the site
 * reads the files themselves, when a request arrives, and only when both of these hold:
 *
 * - the build is for the local Surface, and
 * - the Release being served is local-profile.
 *
 * `notesFor` decides that before it touches the filesystem: on any other Surface or Profile it
 * reads nothing and answers with no note. The directory is named by `ATLAS_NOTES_DIR`; with no
 * directory there are no notes. A note is shown on its subject's page, marked as its author's,
 * and is never written into a twin, a download or the API.
 *
 * Node only.
 */
import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Surface } from "@macro-atlas/core";

export type UserNote = { id: string; user: string; about: { kind: "claim" | "series" | "topic"; id: string }; created: string; text: string };

const USER = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const KINDS = ["claim", "series", "topic"] as const;
const MAX_BYTES = 100_000;
const MAX_NOTES = 2_000;

const unquote = (value: string): string | null => {
  const text = value.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(text) ? text : null;
};

/**
 * The note a file holds, or null when it is not one. The front matter is the fixed set of lines
 * `atlas add note` writes; anything else is not read as a note (`atlas check` says why).
 */
export function parseNote(body: string, user: string, name: string): UserNote | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(body);
  if (!match) return null;
  const fields = new Map<string, string>();
  let inAbout = false;
  for (const line of match[1]!.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const nested = /^ {2}([a-z]+):\s*(.*)$/.exec(line);
    const top = /^([a-z]+):\s*(.*)$/.exec(line);
    if (nested && inAbout) fields.set(`about.${nested[1]}`, nested[2]!);
    else if (top) {
      inAbout = top[1] === "about" && top[2] === "";
      if (!inAbout) fields.set(top[1]!, top[2]!);
    } else return null;
  }
  const wanted = ["id", "user", "about.kind", "about.id", "created", "status"];
  if (fields.size !== wanted.length || !wanted.every((f) => fields.has(f))) return null;
  const get = (field: string): string | null => unquote(fields.get(field)!);
  const id = get("id");
  const author = get("user");
  const kind = get("about.kind");
  const target = get("about.id");
  const created = get("created");
  const text = match[2]!.trim();
  if (!id || !ID.test(id) || name !== `${id}.md`) return null;
  if (!author || !USER.test(author) || author !== user) return null;
  if (!kind || !(KINDS as readonly string[]).includes(kind) || !target || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(target)) return null;
  if (!created || !DAY.test(created) || get("status") !== "draft" || text === "") return null;
  return { id, user: author, about: { kind: kind as UserNote["about"]["kind"], id: target }, created, text };
}

/** Whether User notes may be read at all: a local build serving a local-profile Release. */
export const notesAllowed = (surface: Surface, profile: string): boolean => surface === "local" && profile === "local";

/**
 * Every note in `directory` about one subject, oldest first. Nothing is read, and the answer is
 * empty, unless `notesAllowed`. A file that is not a note, is not a plain file inside the
 * directory (a link is not followed out of it), or is too large is left out.
 */
export async function notesFor(options: { directory: string | undefined; surface: Surface; profile: string }, kind: UserNote["about"]["kind"], id: string): Promise<UserNote[]> {
  if (!notesAllowed(options.surface, options.profile) || !options.directory) return [];
  const notes: UserNote[] = [];
  try {
    const root = await realpath(options.directory);
    for (const user of (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && USER.test(e.name)).map((e) => e.name).sort()) {
      for (const file of (await readdir(join(root, user), { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort()) {
        if (notes.length >= MAX_NOTES) return notes;
        const path = join(root, user, file);
        try {
          if (!(await realpath(path)).startsWith(root + sep)) continue;
          // Opened without following a link, and judged by what was opened, not by its name.
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          let body: string;
          try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > MAX_BYTES) continue;
            body = await handle.readFile("utf8");
          } finally {
            await handle.close();
          }
          const note = parseNote(body, user, file);
          if (note && note.about.kind === kind && note.about.id === id) notes.push(note);
        } catch {
          // unreadable: not shown
        }
      }
    }
  } catch {
    return [];
  }
  return notes.sort((a, b) => (a.created === b.created ? a.id.localeCompare(b.id) : a.created < b.created ? -1 : 1));
}
