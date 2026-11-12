/**
 * Rate limits (PLAN section 7, M24; ADR 0038; docs/method/api.md): a token bucket for each
 * address and one for everybody, kept in this process's memory.
 *
 * `createRateLimiter(limits).take(address)` either spends one token from both buckets or says
 * which one is empty and how many seconds until it holds a token again. A request one bucket
 * refuses is not charged to the other, so an address that is being refused cannot use up what
 * everybody shares. `addressOf(header)` says whose request it is.
 *
 * Hidden here: the refill arithmetic, the bound on how many addresses are remembered (and the one
 * bucket the rest share when it is reached), and how an
 * address is read from what a reverse proxy wrote. Pure apart from the clock it is given.
 */
export type Bucket = { /** The most tokens it holds: how many requests may come at once. */ burst: number; /** Tokens added each second. */ perSecond: number };
export type Limits = { address: Bucket; global: Bucket; /** Addresses remembered at once. */ maxAddresses: number };

/** The limits in force (docs/method/api.md states them; a test holds the two together). */
export const LIMITS: Limits = { address: { burst: 120, perSecond: 2 }, global: { burst: 600, perSecond: 20 }, maxAddresses: 10_000 };

export type Taken = { ok: true } | { ok: false; scope: "address" | "global"; /** Whole seconds, at least one. */ retryAfter: number };
export type RateLimiter = { take(address: string): Taken; /** Addresses remembered now. */ size(): number };

type State = { tokens: number; at: number };
const OVERFLOW = "overflow";

export function createRateLimiter(options: Partial<Limits> & { /** Milliseconds, from any fixed start. */ clock?: () => number } = {}): RateLimiter {
  const limits: Limits = { address: options.address ?? LIMITS.address, global: options.global ?? LIMITS.global, maxAddresses: options.maxAddresses ?? LIMITS.maxAddresses };
  const clock = options.clock ?? (() => performance.now());
  const everybody: State = { tokens: limits.global.burst, at: clock() };
  const addresses = new Map<string, State>();
  // Not in the map, so it is never counted or forgotten.
  const overflow: State = { tokens: limits.address.burst, at: clock() };

  const refill = (state: State, bucket: Bucket, now: number): void => {
    const elapsed = Math.max(0, now - state.at) / 1000;
    state.tokens = Math.min(bucket.burst, state.tokens + elapsed * bucket.perSecond);
    state.at = now;
  };
  const wait = (state: State, bucket: Bucket): number => Math.max(1, Math.ceil((1 - state.tokens) / bucket.perSecond - 1e-9));

  return {
    size: () => addresses.size,
    take(address) {
      const now = clock();
      refill(everybody, limits.global, now);
      let key = address;
      let own = addresses.get(key);
      if (!own && addresses.size >= limits.maxAddresses) {
        // A bucket that has refilled says nothing a new one would not: forget those.
        for (const [held, state] of addresses) {
          refill(state, limits.address, now);
          if (state.tokens >= limits.address.burst) addresses.delete(held);
        }
        // Still no room: forgetting a bucket in use would hand its address a new burst, so
        // every address that cannot be remembered shares one bucket until there is room.
        if (addresses.size >= limits.maxAddresses) {
          key = OVERFLOW;
          own = overflow;
        }
      }
      if (own) refill(own, limits.address, now);
      else {
        // An address that may have been spending the shared bucket starts with what that has
        // left, so finding room is not a new burst. Unused, the shared bucket is full.
        refill(overflow, limits.address, now);
        own = { tokens: overflow.tokens, at: now };
        addresses.set(key, own);
      }
      const waits = [own.tokens < 1 ? wait(own, limits.address) : 0, everybody.tokens < 1 ? wait(everybody, limits.global) : 0] as const;
      if (waits[0] > 0 || waits[1] > 0) return { ok: false, scope: waits[1] >= waits[0] && waits[1] > 0 ? "global" : "address", retryAfter: Math.max(...waits) };
      own.tokens -= 1;
      everybody.tokens -= 1;
      return { ok: true };
    },
  };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const ipv4 = (text: string): string | null => {
  const m = IPV4.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts.join(".") : null;
};

/** The first four groups of an IPv6 address, or null when the text is not one. */
function ipv6Prefix(text: string): string | null {
  if (!/^[0-9a-f:]{2,39}$/.test(text) || (text.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = text.split("::") as [string, string | undefined];
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  // `::` stands for at least one group; without it there are exactly eight.
  if (tail === undefined ? left.length !== 8 : left.length + right.length > 7) return null;
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/**
 * Whose request it is, for the buckets: the last address in `X-Forwarded-For`, which is the one
 * the nearest proxy wrote (anything before it is what a client claimed). An IPv6 address is
 * counted with its /64, since one subscriber holds all of it. With no header, or one that holds
 * no address, every such request shares the bucket "direct": the app is then being reached
 * without a proxy in front, on this machine.
 */
export function addressOf(forwardedFor: string | null | undefined): string {
  if (typeof forwardedFor !== "string" || forwardedFor.length > 400) return "direct";
  let last = (forwardedFor.split(",").at(-1) ?? "").trim().toLowerCase();
  const bracketed = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/.exec(last);
  if (bracketed) last = bracketed[1]!;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(last);
  if (mapped) last = mapped[1]!;
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(last);
  if (withPort) last = withPort[1]!;
  return ipv4(last) ?? ipv6Prefix(last) ?? "direct";
}
