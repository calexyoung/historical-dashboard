/**
 * The Explorer's address (PLAN section 3: "its address fully describes what is shown").
 *
 *   /explore?s=spx,unrate&mode=z&from=2019-06&to=2022-06&layers=rec,ev.policy,gov.pres&at=2020-04-01&event={id}
 *           &cmp=2020-01&basis=lvl&lag=3&sx=spx&sy=unrate&roll=24&ext=1
 *
 * `parseExplorerParams` reads an address leniently: what it cannot read it leaves unsaid and
 * notes, so a damaged link still opens. It keeps "not said" (null: the page's default applies)
 * apart from "none" (an empty list), because a form with every box cleared must not come back
 * with the defaults ticked. `explorerQuery` writes a view back in one fixed order.
 * `v1HashToQuery` turns one of v1's hash links (`#sel=…&mode=…`) into this address, quirks
 * included; it is the only place that knows v1's parameter names.
 *
 * Pure, with no knowledge of any Release: which Series, layers and Events exist is the view's
 * business (view.ts). Safe to load in a browser.
 */

/**
 * The Transforms the Explorer offers: v1's six modes, then the rest of the engine's allowlist
 * (M18), in that order so that v1's six stay where a reader of v1 looks for them.
 */
export const MODES = ["lin", "log", "rebase", "z", "pc1", "drawdown", "chg", "ch1", "pch", "pca"] as const;
/** The frequencies every finer Series can be brought to (`freq=`). */
export const COMMON_FREQUENCIES = ["weekly", "monthly", "quarterly", "annual"] as const;
export type CommonFrequency = (typeof COMMON_FREQUENCIES)[number];
export type ExplorerMode = (typeof MODES)[number];

export type ExplorerState = {
  /** Series keys in the order asked. Null: the address does not say. Empty: it says none. */
  series: string[] | null;
  mode: ExplorerMode | null;
  /** Months, YYYY-MM: the window runs from the first day of `from` to the last day of `to`. */
  from: string | null;
  to: string | null;
  /** Layer tokens: `rec`, `ev.{category}`, `gov.{set}`, `pol`. Null: not said. Empty: none. */
  layers: string[] | null;
  /** The pinned date, YYYY-MM-DD. */
  at: string | null;
  /** The chosen Event's Annotation id. */
  event: string | null;
  /** v1's way of choosing an Event: its place in v1's list. The view turns it into `event`. */
  hi: number | null;
  /** The series picker is open (the address a reader without JavaScript follows to open it). */
  pick: boolean;
  /** The table of values is asked for. It is hundreds of rows a Series, so it is sent only then. */
  table: boolean;
  /** Compare ranges: the month a second range of the same length starts. */
  cmp: string | null;
  /** Mark each drawn Series' highest and lowest value. */
  ext: boolean;
  /** Relationships are taken on levels, not on changes (the default). */
  levels: boolean;
  /** The lag of the chosen pair, in Periods of their common frequency, −24 to 24: positive, X leads Y. */
  lag: number;
  /** The chosen pair. Null: not said (the first two Series). */
  sx: string | null;
  sy: string | null;
  /** The rolling correlation's span in months: 24, or 36 when not said. */
  roll: 24 | 36;
  /** The Cutoff of an as-of view: a date (YYYY-MM-DD) or an instant (YYYY-MM-DDTHH:MM:SSZ). Null: today's values. */
  asOf: string | null;
  /** Every Series finer than this is combined to it, by its own declared rule. Null: each at its own frequency. */
  freq: CommonFrequency | null;
  /** The Release this view is pinned to (`pin=`). The gate fixes the request to it before the page runs. */
  pin: string | null;
  /** The address has a `pin` that is not a release id. The gate refuses such a request; the view never shows other data in its place. */
  pinUnread: boolean;
  /** What the address said that could not be read, in words. Never the unread text itself. */
  notes: string[];
};

/** A view as an address carries it: everything but the notes on what could not be read. */
export type ExplorerAddress = Omit<ExplorerState, "notes" | "pinUnread">;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const LAYER = /^(rec|pol|(ev|gov)(\.[a-z0-9_]{1,40})?)$/;
const PIN = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})(T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ)?$/;
const EVENT_ID = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

export const MAX_LAG = 24;

function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000")) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

type Params = { get(name: string): string | null; getAll(name: string): string[]; has(name: string): boolean };

/** Next hands a page its search parameters as a plain record; a browser has URLSearchParams. */
export function asParams(input: URLSearchParams | Record<string, string | string[] | undefined>): Params {
  if (input instanceof URLSearchParams) return input;
  const all = (name: string): string[] => {
    const value = Object.prototype.hasOwnProperty.call(input, name) ? input[name] : undefined;
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };
  return { get: (name) => all(name)[0] ?? null, getAll: all, has: (name) => all(name).length > 0 };
}

/** Every value of a repeated or comma-separated field, in order, once each. */
const listOf = (params: Params, name: string): string[] => [...new Set(params.getAll(name).flatMap((v) => v.split(",")).map((v) => v.trim()).filter((v) => v !== ""))];

export function parseExplorerParams(input: URLSearchParams | Record<string, string | string[] | undefined>): ExplorerState {
  const params = asParams(input);
  const notes: string[] = [];

  let series: string[] | null = null;
  if (params.has("s")) {
    const asked = listOf(params, "s");
    series = asked.filter((k) => KEY.test(k));
    if (series.length < asked.length) notes.push("Part of the list of series is not a series key and was left out.");
  }

  let mode: ExplorerMode | null = null;
  const askedMode = params.get("mode");
  if (askedMode !== null && askedMode !== "") {
    if ((MODES as readonly string[]).includes(askedMode)) mode = askedMode as ExplorerMode;
    else notes.push(`The mode in the address is not one of ${MODES.join(", ")}.`);
  }

  const month = (name: "from" | "to"): string | null => {
    const value = params.get(name);
    if (value === null || value === "") return null;
    if (MONTH.test(value) && !value.startsWith("0000")) return value;
    notes.push(`The ${name === "from" ? "start" : "end"} of the window is not a month written YYYY-MM.`);
    return null;
  };
  let from = month("from");
  let to = month("to");
  if (from !== null && to !== null && from > to) {
    notes.push("The window in the address ends before it starts, so the whole span is shown.");
    [from, to] = [null, null];
  }

  let layers: string[] | null = null;
  if (params.has("layers")) {
    const asked = listOf(params, "layers").filter((l) => l !== "none");
    layers = asked.filter((l) => LAYER.test(l));
    if (layers.length < asked.length) notes.push("Part of the list of layers could not be read and was left out.");
  }

  let at: string | null = null;
  const askedAt = params.get("at");
  if (askedAt !== null && askedAt !== "") {
    const day = MONTH.test(askedAt) ? `${askedAt}-01` : askedAt;
    if (isDate(day)) at = day;
    else notes.push("The pinned date is not a date written YYYY-MM-DD.");
  }

  let event: string | null = null;
  const askedEvent = params.get("event");
  if (askedEvent !== null && askedEvent !== "") {
    if (EVENT_ID.test(askedEvent)) event = askedEvent;
    else notes.push("The event named in the address could not be read.");
  }

  let hi: number | null = null;
  const askedHi = params.get("hi");
  if (event === null && askedHi !== null && /^\d{1,4}$/.test(askedHi)) hi = Number(askedHi);

  let cmp: string | null = null;
  const askedCmp = params.get("cmp");
  if (askedCmp !== null && askedCmp !== "") {
    if (MONTH.test(askedCmp) && !askedCmp.startsWith("0000")) cmp = askedCmp;
    else notes.push("The start of the range to compare with is not a month written YYYY-MM.");
  }

  let lag = 0;
  const askedLag = params.get("lag");
  if (askedLag !== null && askedLag !== "") {
    if (/^-?\d{1,2}$/.test(askedLag) && Math.abs(Number(askedLag)) <= MAX_LAG) lag = Number(askedLag) + 0;
    else notes.push(`The lag in the address is not a whole number from −${MAX_LAG} to ${MAX_LAG}.`);
  }
  const key = (name: "sx" | "sy"): string | null => {
    const value = params.get(name);
    return value !== null && KEY.test(value) ? value : null;
  };

  let asOf: string | null = null;
  const askedAsOf = params.get("as_of");
  if (askedAsOf !== null && askedAsOf !== "") {
    const day = INSTANT.exec(askedAsOf)?.[1];
    if (day !== undefined && isDate(day) && day >= "1900-01-01") asOf = askedAsOf;
    else notes.push("The as-of date is not a date from 1900 on written YYYY-MM-DD (or an instant written YYYY-MM-DDTHH:MM:SSZ), so today's values are shown.");
  }

  let freq: CommonFrequency | null = null;
  const askedFreq = params.get("freq");
  if (askedFreq !== null && askedFreq !== "") {
    if ((COMMON_FREQUENCIES as readonly string[]).includes(askedFreq)) freq = askedFreq as CommonFrequency;
    else notes.push(`The frequency in the address is not one of ${COMMON_FREQUENCIES.join(", ")}, so each series is at its own.`);
  }

  const askedPin = params.get("pin");
  const pin = askedPin !== null && PIN.test(askedPin) ? askedPin : null;

  return {
    series,
    mode,
    from,
    to,
    asOf,
    freq,
    pin,
    pinUnread: askedPin !== null && askedPin !== "" && pin === null,
    layers,
    at,
    event,
    hi,
    cmp,
    ext: params.get("ext") === "1",
    levels: params.get("basis") === "lvl",
    lag: lag === 0 ? 0 : lag,
    sx: key("sx"),
    sy: key("sy"),
    roll: params.get("roll") === "24" ? 24 : 36,
    pick: params.get("pick") === "1",
    table: params.get("table") === "1",
    notes,
  };
}

/**
 * The view as a query string, without the "?". Every value is made of characters that need no
 * escaping (keys, months, dates, tokens), so the address stays readable.
 */
export function explorerQuery(state: ExplorerAddress): string {
  const parts: string[] = [];
  if (state.series !== null) parts.push(`s=${state.series.join(",")}`);
  if (state.mode !== null) parts.push(`mode=${state.mode}`);
  if (state.from !== null) parts.push(`from=${state.from}`);
  if (state.to !== null) parts.push(`to=${state.to}`);
  if (state.freq) parts.push(`freq=${state.freq}`);
  if (state.asOf) parts.push(`as_of=${state.asOf}`);
  if (state.layers !== null) parts.push(`layers=${state.layers.length > 0 ? state.layers.join(",") : "none"}`);
  if (state.at !== null) parts.push(`at=${state.at}`);
  if (state.event !== null) parts.push(`event=${state.event}`);
  else if (state.hi !== null) parts.push(`hi=${state.hi}`);
  if (state.cmp !== null) parts.push(`cmp=${state.cmp}`);
  if (state.levels) parts.push("basis=lvl");
  if (state.lag !== 0) parts.push(`lag=${state.lag}`);
  if (state.sx !== null) parts.push(`sx=${state.sx}`);
  if (state.sy !== null) parts.push(`sy=${state.sy}`);
  if (state.roll === 24) parts.push("roll=24");
  if (state.ext) parts.push("ext=1");
  if (state.table) parts.push("table=1");
  if (state.pick) parts.push("pick=1");
  if (state.pin) parts.push(`pin=${state.pin}`);
  return parts.join("&");
}

// --- v1 ---------------------------------------------------------------------------------------

const V1_MODE: Record<string, ExplorerMode> = { raw: "lin", log: "log", rebase: "rebase", z: "z", yoy: "pc1", dd: "drawdown" };
/** v1's five Event categories, in the order of its chips, and its six band sets. */
export const V1_EVENT_CATEGORIES = ["political", "financial", "geopolitical", "health", "policy"] as const;
export const V1_BAND_SETS = ["pres", "house", "senate", "fed_chair", "treasury", "shutdowns"] as const;
/** v1's axis began here; a month before it was not on the axis. */
const V1_FIRST_MONTH = "2000-01";

const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/**
 * One of v1's links (`#sel=spx,unrate&mode=z&from=2000-01&to=2026-10&…`, written by v1's
 * `stateToParams`) as this Explorer's query string, read the way v1's `applyParams` read it.
 * Null when the hash is not a v1 link (v1 required `sel`).
 *
 * v1's quirks, kept because a v1 link must open the view it opened in v1 (checks/v1-links.json):
 * no mode, or an unknown one, is z-scores; a lag is held to ±24; a range of fewer than six months is the whole axis;
 * a month off v1's axis is the end of the axis on that side; a switch is on only when it is
 * "1"; with no `ev` every category is on; `shPres=1` is the oldest spelling of `bands=pres`.
 * Two things only a Release can settle are left to the view: v1 dropped Series it did not have
 * before counting to eight, and `hi` is a place in v1's list of Events.
 */
export function v1HashToQuery(hash: string): string | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (!p.has("sel")) return null;

  const series = [...new Set((p.get("sel") ?? "").split(",").filter((k) => KEY.test(k)))];
  const mode = V1_MODE[p.get("mode") ?? ""] ?? "z";

  const month = (name: string): string | null => {
    const value = p.get(name);
    return value !== null && MONTH.test(value) && value >= V1_FIRST_MONTH ? value : null;
  };
  let from = month("from");
  let to = month("to");
  if (from !== null && to !== null && monthIndex(to) - monthIndex(from) < 6) [from, to] = [null, null];

  const on = (name: string): boolean => !p.has(name) || p.get(name) === "1";
  const layers: string[] = [];
  if (on("shRec")) layers.push("rec");
  if (on("shEv")) {
    const asked = p.has("ev") ? (p.get("ev") ?? "").split(",") : null;
    for (const category of V1_EVENT_CATEGORIES) if (asked === null || asked.includes(category)) layers.push(`ev.${category}`);
  }
  const bands = p.get("bands");
  if (bands !== null && (V1_BAND_SETS as readonly string[]).includes(bands)) layers.push(`gov.${bands}`);
  else if (p.get("shPres") === "1") layers.push("gov.pres");

  const hi = /^\d{1,4}$/.test(p.get("hi") ?? "") ? Number(p.get("hi")) : null;

  const lag = Math.max(-MAX_LAG, Math.min(MAX_LAG, parseInt(p.get("lag") ?? "0", 10) || 0)); // v1 clamped
  const cmp = p.get("cmp");
  const key = (name: string): string | null => (KEY.test(p.get(name) ?? "") ? p.get(name) : null);

  return explorerQuery({
    series,
    mode,
    from,
    to,
    asOf: null,
    freq: null,
    pin: null,
    layers,
    at: null,
    event: null,
    hi,
    cmp: cmp !== null && MONTH.test(cmp) && cmp >= V1_FIRST_MONTH ? cmp : null,
    ext: p.get("ext") === "1",
    levels: p.get("basis") === "lvl",
    lag,
    sx: key("sx"),
    sy: key("sy"),
    roll: p.get("roll") === "24" ? 24 : 36,
    pick: false,
    table: false,
  });
}
