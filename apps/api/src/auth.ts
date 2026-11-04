import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "./db.js";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "settlr_session";
export interface Identity { userId: string; actor: string }

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(24).toString("hex")}`;
}

export async function createSession(db: Db, userId: string, reply: FastifyReply): Promise<void> {
  const raw = generateToken("sess_");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const cookieSecure = process.env.COOKIE_SECURE === "true" || (process.env.PUBLIC_API_URL ?? "").startsWith("https://");
  // A secure cookie is served over HTTPS, which is also the case where the console and the API
  // may sit on different sites (app.example.com -> api.example.com). SameSite=None is the only
  // setting browsers accept there; plain-HTTP self-hosting keeps Lax.
  const sameSite = cookieSecure ? ("none" as const) : ("lax" as const);
  await db.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)", [userId, tokenHash, expiresAt]);
  reply.setCookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite,
    secure: cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export async function sessionUser(db: Db, req: FastifyRequest): Promise<Identity | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) {
    const { rows } = await db.query(
      "SELECT user_id FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
      [hashToken(raw)],
    );
    if (rows[0]) return { userId: rows[0].user_id, actor: `user:${rows[0].user_id}` };
  }
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer settlr_live_") || header?.startsWith("Bearer settlr_dev_")) {
    const key = header.slice(7);
    const { rows } = await db.query(
      "SELECT id, user_id, scopes FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
      [hashToken(key)],
    );
    if (rows[0]) {
      await db.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [rows[0].id]);
      return { userId: rows[0].user_id, actor: `mcp:${rows[0].id}` };
    }
  }
  return null;
}

export async function destroySession(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) await db.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [hashToken(raw)]);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function verifyPassword(hash: string, password: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}
