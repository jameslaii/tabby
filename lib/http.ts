/**
 * Request-body helpers for the route handlers.
 *
 * `await request.json()` throws on a malformed or absent body, and an
 * unhandled throw inside a route handler is a 500 — the status that means
 * "we broke", not "you sent us nonsense". These turn that case back into
 * something the caller can act on.
 */

/** Parse a JSON object body, or null if it isn't one. Never throws. */
export async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The largest receipt photo we'll accept, as base64 characters.
 *
 * This has to sit *below* the host's own request-body cap, which on Vercel is
 * 4.5 MB and is enforced at the edge before the function runs — it answers an
 * oversized upload with a 413 and an empty body, so there is nothing for the
 * client to read and `response.json()` throws on the empty string. (In Safari
 * that surfaces as "The string did not match the expected pattern", which is
 * what a phone-sized photo used to produce here.) At 3 MB the app's own check
 * runs first and can say something useful; the client also downscales before
 * uploading, so a real receipt lands around 300 KB and never reaches either
 * limit.
 */
export const MAX_IMAGE_BASE64_CHARS = 3 * 1024 * 1024;

/**
 * The longest "who had what" text forwarded to the model. Real instructions
 * are a sentence or two; anything kilobytes long is a paste accident or an
 * attempt to spend tokens, and truncation is the right answer to both.
 */
export const MAX_INSTRUCTIONS_CHARS = 2000;

// ---- Rate limiting ------------------------------------------------------
//
// The AI routes spend real money per request and sit on a public URL with no
// auth in front of them, so they need *some* ceiling. A fixed-window counter
// in module scope is deliberately modest: on serverless it is per-instance,
// so it bounds what one warm instance will spend for one caller rather than
// enforcing a global quota. That is the right tool here — it stops the naive
// abuse (a loop hammering the endpoint) without dragging in a shared store
// the app doesn't otherwise have.

interface Window {
  startedAt: number;
  count: number;
}

const windows = new Map<string, Window>();

/**
 * Count one hit against `key` and say whether it stays under `limit` per
 * `windowMs`. Pure bookkeeping — exported with an injectable clock so tests
 * don't sleep.
 */
export function takeToken(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const current = windows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    // Sweep dead windows occasionally so the map can't grow without bound
    // under a spread of spoofed IPs.
    if (windows.size > 10_000) {
      for (const [k, w] of windows) {
        if (now - w.startedAt >= windowMs) windows.delete(k);
      }
    }
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/**
 * The caller's IP for rate-limit bucketing. On Vercel `x-forwarded-for`'s
 * first entry is set by the platform; locally there's no header and every
 * caller shares one generous bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

/** True when this request is within `limit` calls per minute for `route`. */
export function withinRateLimit(
  request: Request,
  route: string,
  limit: number,
): boolean {
  return takeToken(`${route}:${clientIp(request)}`, limit, 60_000);
}
