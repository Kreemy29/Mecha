import crypto from "crypto";
import { cookies } from "next/headers";
import { db, rawDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

// Accounts, passwords and sessions for OneUp.
//
// No third-party auth dependency: scrypt and randomBytes ship with Node, and
// this is a small team behind one login. Passwords are never stored — only a
// scrypt hash with a per-user salt. Session tokens are stored HASHED too, so a
// leaked database still can't be used to impersonate anyone.

export const ROLES = [
  "owner",
  "ai_artist",
  "meta_ads",
  "marketing_manager",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  ai_artist: "AI Artist",
  meta_ads: "Meta Ads",
  marketing_manager: "Marketing Manager",
};

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

export const SESSION_COOKIE = "oneup_session";
const SESSION_DAYS = 30;

let ensured = false;
export function ensureAuthTables(): void {
  if (ensured) return;
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
  `);
  ensured = true;
}

// ── Passwords ──

function scrypt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function hashPassword(password: string): {
  hash: string;
  salt: string;
} {
  const salt = crypto.randomBytes(16).toString("hex");
  return { hash: scrypt(password, salt), salt };
}

export function verifyPassword(
  password: string,
  hash: string,
  salt: string
): boolean {
  const candidate = scrypt(password, salt);
  // Constant-time compare so a wrong password can't be narrowed down by timing.
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Users ──

export interface PublicUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  isAdmin: boolean;
}

function toPublic(row: typeof schema.users.$inferSelect): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role as Role,
    isAdmin: !!row.isAdmin,
  };
}

export function userCount(): number {
  ensureAuthTables();
  return db.select().from(schema.users).all().length;
}

export function listUsers(): PublicUser[] {
  ensureAuthTables();
  return db.select().from(schema.users).all().map(toPublic);
}

export function createUser(input: {
  username: string;
  name: string;
  role: Role;
  password: string;
  isAdmin?: boolean;
}): PublicUser {
  ensureAuthTables();
  const username = input.username.trim().toLowerCase();
  if (!username) throw new Error("Username is required");
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const existing = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();
  if (existing) throw new Error(`Username "${username}" is taken`);

  const { hash, salt } = hashPassword(input.password);
  const row = db
    .insert(schema.users)
    .values({
      username,
      name: input.name.trim() || username,
      role: input.role,
      passwordHash: hash,
      passwordSalt: salt,
      isAdmin: !!input.isAdmin,
    })
    .returning()
    .get();
  return toPublic(row);
}

export function setPassword(userId: number, password: string): void {
  ensureAuthTables();
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const { hash, salt } = hashPassword(password);
  db.update(schema.users)
    .set({ passwordHash: hash, passwordSalt: salt })
    .where(eq(schema.users.id, userId))
    .run();
  // Every existing session is invalidated: a password change should log the
  // old sessions out, not leave them alive.
  db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
}

export function updateUser(
  userId: number,
  patch: { name?: string; role?: Role; isAdmin?: boolean }
): PublicUser | null {
  ensureAuthTables();
  const row = db
    .update(schema.users)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.isAdmin !== undefined ? { isAdmin: patch.isAdmin } : {}),
    })
    .where(eq(schema.users.id, userId))
    .returning()
    .get();
  return row ? toPublic(row) : null;
}

export function deleteUser(userId: number): void {
  ensureAuthTables();
  db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
  db.delete(schema.users).where(eq(schema.users.id, userId)).run();
}

export function authenticate(
  username: string,
  password: string
): PublicUser | null {
  ensureAuthTables();
  const row = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username.trim().toLowerCase()))
    .get();
  if (!row) return null;
  if (!verifyPassword(password, row.passwordHash, row.passwordSalt)) return null;
  return toPublic(row);
}

// ── Sessions ──

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export function createSession(userId: number): string {
  ensureAuthTables();
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.insert(schema.sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: expires.toISOString(),
    })
    .run();
  return token;
}

export function destroySession(token: string): void {
  ensureAuthTables();
  db.delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .run();
}

export function userForToken(token: string): PublicUser | null {
  ensureAuthTables();
  const session = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .get();
  if (!session) return null;
  if (Date.parse(session.expiresAt) < Date.now()) {
    db.delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, session.tokenHash))
      .run();
    return null;
  }
  const row = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .get();
  return row ? toPublic(row) : null;
}

// Whoever is making the current request, or null. This is the ONLY source of
// identity the server trusts — a client-supplied name can claim to be anyone.
export async function currentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? userForToken(token) : null;
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86400;

// The authorization boundary, kept next to the data as Next's auth guide
// recommends — proxy.ts only does an optimistic cookie check, so anything that
// reads or writes real data validates here instead.
//
// Returns the user, or a ready-to-return 401/403 response.
export async function requireUser(options?: { admin?: boolean }): Promise<
  | { user: PublicUser; deny: null }
  | { user: null; deny: Response }
> {
  const user = await currentUser();
  if (!user) {
    return {
      user: null,
      deny: Response.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  if (options?.admin && !user.isAdmin) {
    return {
      user: null,
      deny: Response.json({ error: "Admins only" }, { status: 403 }),
    };
  }
  return { user, deny: null };
}
