import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, 12);
}

export async function verifyTokenHash(
  token: string,
  tokenHash: string,
): Promise<boolean> {
  return bcrypt.compare(token, tokenHash);
}
