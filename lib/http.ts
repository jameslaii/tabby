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
 * A modern phone camera produces 3–8 MB of JPEG, and base64 inflates that by a
 * third; 12 MB of encoded text is a generous ceiling for a legible receipt and
 * well under the point where the request stops being worth attempting. Without
 * a check the upload fails deep in the platform's body handling, where nothing
 * can tell the user what went wrong or that resizing would fix it.
 */
export const MAX_IMAGE_BASE64_CHARS = 12 * 1024 * 1024;
