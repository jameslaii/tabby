import { describe, expect, it } from "vitest";
import { clientIp, readJson, takeToken } from "../lib/http";

describe("takeToken", () => {
  it("allows up to the limit within one window", () => {
    const t0 = 1_000_000;
    expect(takeToken("a", 3, 60_000, t0)).toBe(true);
    expect(takeToken("a", 3, 60_000, t0 + 1)).toBe(true);
    expect(takeToken("a", 3, 60_000, t0 + 2)).toBe(true);
    expect(takeToken("a", 3, 60_000, t0 + 3)).toBe(false);
  });

  it("resets once the window has elapsed", () => {
    const t0 = 2_000_000;
    expect(takeToken("b", 1, 60_000, t0)).toBe(true);
    expect(takeToken("b", 1, 60_000, t0 + 1)).toBe(false);
    expect(takeToken("b", 1, 60_000, t0 + 60_000)).toBe(true);
  });

  it("buckets keys independently", () => {
    const t0 = 3_000_000;
    expect(takeToken("c", 1, 60_000, t0)).toBe(true);
    expect(takeToken("d", 1, 60_000, t0)).toBe(true);
    expect(takeToken("c", 1, 60_000, t0 + 1)).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.9");
  });

  it("falls back to a shared local bucket without the header", () => {
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});

describe("readJson", () => {
  const post = (body: string, contentType = "application/json") =>
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });

  it("returns an object body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("returns null for malformed JSON, arrays and scalars", async () => {
    expect(await readJson(post("{oops"))).toBeNull();
    expect(await readJson(post("[1,2]"))).toBeNull();
    expect(await readJson(post("42"))).toBeNull();
  });
});
