import "server-only";

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

export type JsonBodyResult =
  | { ok: true; value: JsonObject }
  | {
      ok: false;
      status: 400 | 413 | 415;
      error: "invalid body" | "body too large" | "unsupported media type";
    };

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function sameOriginError(request: Request): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return Response.json({ error: "cross-origin request blocked" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      return Response.json(
        { error: "cross-origin request blocked" },
        { status: 403 },
      );
    }
  } catch {
    return Response.json(
      { error: "cross-origin request blocked" },
      { status: 403 },
    );
  }

  return null;
}

export function hasOnlyKeys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 415, error: "unsupported media type" };
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return { ok: false, status: 400, error: "invalid body" };
    }
    if (length > maxBytes) {
      return { ok: false, status: 413, error: "body too large" };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: "invalid body" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: "body too large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();

    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, status: 400, error: "invalid body" };
    }
    return { ok: true, value: parsed as JsonObject };
  } catch {
    await reader.cancel().catch(() => {});
    return { ok: false, status: 400, error: "invalid body" };
  } finally {
    reader.releaseLock();
  }
}

export function jsonBodyError(result: Extract<JsonBodyResult, { ok: false }>) {
  return Response.json(
    { error: result.error },
    { status: result.status, headers: { "Cache-Control": "no-store" } },
  );
}
