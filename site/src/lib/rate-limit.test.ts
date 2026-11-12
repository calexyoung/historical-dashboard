/**
 * Rate limits (PLAN section 7, M24; docs/method/api.md): a token bucket for each address and one
 * for everybody. Tested through `createRateLimiter()` with a clock the test moves, and
 * `addressOf()` with the headers a reverse proxy writes.
 */
import { describe, expect, it } from "vitest";
import { addressOf, createRateLimiter, LIMITS } from "./rate-limit";

const clockAt = (start = 0) => {
  const clock = { now: start, read: () => clock.now };
  return clock;
};
const small = { address: { burst: 3, perSecond: 1 }, global: { burst: 5, perSecond: 1 }, maxAddresses: 4 };

describe("a token bucket for each address", () => {
  it("allows a burst, then refuses and says how long to wait", () => {
    const clock = clockAt();
    const limiter = createRateLimiter({ ...small, clock: clock.read });
    expect([1, 2, 3].map(() => limiter.take("a").ok)).toEqual([true, true, true]);
    expect(limiter.take("a")).toEqual({ ok: false, scope: "address", retryAfter: 1 });
  });

  it("refills with time, and never beyond the burst", () => {
    const clock = clockAt();
    const limiter = createRateLimiter({ ...small, global: { burst: 100, perSecond: 100 }, clock: clock.read });
    for (let i = 0; i < 3; i++) limiter.take("a");
    clock.now += 2_000; // two tokens back
    expect([limiter.take("a").ok, limiter.take("a").ok, limiter.take("a").ok]).toEqual([true, true, false]);
    clock.now += 3_600_000; // an hour: still only the burst
    expect([1, 2, 3, 4].map(() => limiter.take("a").ok)).toEqual([true, true, true, false]);
  });

  it("one address running out leaves another alone", () => {
    const limiter = createRateLimiter({ ...small, clock: clockAt().read });
    for (let i = 0; i < 4; i++) limiter.take("a");
    expect(limiter.take("a").ok).toBe(false);
    expect(limiter.take("b").ok).toBe(true);
  });

  it("says a wait in whole seconds, rounded up, and at least one", () => {
    const clock = clockAt();
    const limiter = createRateLimiter({ address: { burst: 1, perSecond: 0.1 }, global: { burst: 100, perSecond: 100 }, maxAddresses: 4, clock: clock.read });
    limiter.take("a");
    expect(limiter.take("a")).toMatchObject({ ok: false, retryAfter: 10 });
    clock.now += 9_500;
    expect(limiter.take("a")).toMatchObject({ ok: false, retryAfter: 1 });
  });
});

describe("one bucket for everybody", () => {
  it("refuses every address once it is empty, and says so", () => {
    const limiter = createRateLimiter({ ...small, clock: clockAt().read });
    const taken = ["a", "a", "a", "b", "b"].map((address) => limiter.take(address).ok);
    expect(taken).toEqual([true, true, true, true, true]);
    expect(limiter.take("c")).toEqual({ ok: false, scope: "global", retryAfter: 1 });
  });

  it("when both are empty, the wait is the longer of the two", () => {
    const limiter = createRateLimiter({ address: { burst: 1, perSecond: 0.5 }, global: { burst: 1, perSecond: 0.1 }, maxAddresses: 4, clock: clockAt().read });
    limiter.take("a");
    expect(limiter.take("a")).toEqual({ ok: false, scope: "global", retryAfter: 10 });
  });

  it("a request one bucket refuses is not charged to the other", () => {
    const clock = clockAt();
    const limiter = createRateLimiter({ ...small, clock: clock.read });
    for (let i = 0; i < 3; i++) limiter.take("a");
    // Refused by its own bucket twenty times: the bucket for everybody still holds two.
    for (let i = 0; i < 20; i++) expect(limiter.take("a")).toMatchObject({ scope: "address" });
    expect([limiter.take("b").ok, limiter.take("b").ok]).toEqual([true, true]);
    // Refused for everybody: "c" has spent nothing of its own, so it has its whole burst later.
    expect(limiter.take("c")).toMatchObject({ scope: "global" });
    clock.now += 5_000;
    expect([1, 2, 3].map(() => limiter.take("c").ok)).toEqual([true, true, true]);
  });
});

describe("how many addresses are remembered", () => {
  const few = { address: { burst: 2, perSecond: 1 }, global: { burst: 1000, perSecond: 1000 }, maxAddresses: 3 };

  it("is bounded: a bucket that has refilled is forgotten, since a new one would say the same", () => {
    const clock = clockAt();
    const limiter = createRateLimiter({ ...few, clock: clock.read });
    for (const address of ["a", "b", "c"]) limiter.take(address);
    expect(limiter.size()).toBe(3);
    clock.now += 10_000; // all three have refilled
    limiter.take("d");
    expect(limiter.size()).toBe(1);
  });

  it("when none has refilled, nobody's count is reset: every further address shares one bucket", () => {
    const clock = clockAt();
    const limiter = createRateLimiter({ ...few, clock: clock.read });
    for (const address of ["a", "b", "c"]) for (let i = 0; i < 2; i++) limiter.take(address);
    // Three addresses are remembered and all are empty. Two new ones share a burst of two.
    expect([limiter.take("d").ok, limiter.take("e").ok]).toEqual([true, true]);
    expect(limiter.take("f")).toMatchObject({ ok: false, scope: "address" });
    expect(limiter.size()).toBe(3);
    // The remembered ones were not forgotten to make room: "a" is still empty.
    expect(limiter.take("a").ok).toBe(false);
    // Once they have refilled there is room again, and "f" has a bucket of its own.
    clock.now += 10_000;
    expect([limiter.take("f").ok, limiter.take("f").ok, limiter.take("f").ok]).toEqual([true, true, false]);
  });
});

describe("the limits in force", () => {
  it("are the ones docs/method/api.md states", () => {
    expect(LIMITS).toEqual({ address: { burst: 120, perSecond: 2 }, global: { burst: 600, perSecond: 20 }, maxAddresses: 10_000 });
  });
});

describe("whose request it is", () => {
  it("is the last address in X-Forwarded-For: the one the nearest proxy wrote", () => {
    expect(addressOf("203.0.113.7")).toBe("203.0.113.7");
    expect(addressOf("198.51.100.1, 203.0.113.7")).toBe("203.0.113.7");
    expect(addressOf("  198.51.100.1 ,203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("puts an IPv6 address in the bucket of its /64", () => {
    expect(addressOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(addressOf("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(addressOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressOf("::1")).toBe("0:0:0:0::/64");
    expect(addressOf("[2001:db8:1:2::1]:443")).toBe("2001:db8:1:2::/64");
  });

  it("reads an IPv4 address written as IPv6, and one with a port", () => {
    expect(addressOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(addressOf("203.0.113.7:51234")).toBe("203.0.113.7");
  });

  it("is one shared bucket when there is no header or it holds no address", () => {
    for (const header of [null, undefined, "", "unknown", "not an address", "999.1.1.1", "1.2.3", "a".repeat(500), "203.0.113.7, <script>"]) {
      expect(addressOf(header)).toBe("direct");
    }
  });
});
