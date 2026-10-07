import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isValidSessionToken(value: unknown): value is string {
  return typeof value === "string" && SESSION_TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionTokenMatches(
  storedHash: string,
  token: unknown,
): token is string {
  if (!isValidSessionToken(token) || storedHash.length !== 64) return false;

  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashSessionToken(token), "hex");
  return timingSafeEqual(expected, actual);
}
