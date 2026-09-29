import crypto from "crypto";
import nodemailer from "nodemailer";
import { rawDb } from "../db";
import { ensureAuthTables, listUsers, type PublicUser } from "./auth";

// Workflow notifications: one message, delivered to each recipient over
// Telegram (if they've connected the bot) and email (if they have a work
// email on their account). Each channel is best-effort and logged, so one
// failing never blocks the other or the action that triggered it.
//
// Env:
//   TELEGRAM_BOT_TOKEN        from @BotFather
//   TELEGRAM_WEBHOOK_SECRET   optional; defaults to a hash of the token
//   GMAIL_USER                the @oneupmedia.io address to send from
//   GMAIL_APP_PASSWORD        a Google App Password for that account
//   APP_URL                   optional public address for links (else the
//                             request's own origin is used)

export interface Message {
  title: string;
  lines?: string[];
  link?: { label: string; url: string };
}

let ensured = false;
function ensureNotifyTables(): void {
  if (ensured) return;
  ensureAuthTables();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS notifications_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      user_id INTEGER,
      channel TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);
  ensured = true;
}

// ── Credentials ──
// An admin can paste these into the app (Settings → Accounts); they're kept
// in the settings table and win over the host's env vars. That way the bot
// works on a host whose dashboard you can't reach. Never sent back to a
// browser: see credentialStatus for the masked view.

export const CREDENTIAL_KEYS = {
  telegramBotToken: { db: "notify.telegram_bot_token", env: "TELEGRAM_BOT_TOKEN" },
  gmailUser: { db: "notify.gmail_user", env: "GMAIL_USER" },
  gmailAppPassword: { db: "notify.gmail_app_password", env: "GMAIL_APP_PASSWORD" },
} as const;
export type CredentialKey = keyof typeof CREDENTIAL_KEYS;

function savedValue(dbKey: string): string {
  const row = rawDb.prepare("SELECT value FROM settings WHERE key = ?").get(dbKey) as { value: string } | undefined;
  return row?.value?.trim() || "";
}

function credential(k: CredentialKey): { value: string; source: "app" | "server" | null } {
  const { db, env } = CREDENTIAL_KEYS[k];
  const saved = savedValue(db);
  if (saved) return { value: saved, source: "app" };
  const fromEnv = process.env[env]?.trim() || "";
  return { value: fromEnv, source: fromEnv ? "server" : null };
}

export function setCredential(k: CredentialKey, value: string | null): void {
  const { db } = CREDENTIAL_KEYS[k];
  const v = (value ?? "").trim();
  if (v) {
    rawDb
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(db, v);
  } else {
    rawDb.prepare("DELETE FROM settings WHERE key = ?").run(db);
  }
  // Anything derived from the old values is stale now.
  botUsername = null;
  transport = null;
}

// What an admin screen may show: where each value comes from, and a hint
// (Gmail address in full; secrets only as their last 4 characters).
export function credentialStatus() {
  const out: Record<string, { set: boolean; source: "app" | "server" | null; hint: string | null }> = {};
  for (const k of Object.keys(CREDENTIAL_KEYS) as CredentialKey[]) {
    const c = credential(k);
    out[k] = {
      set: !!c.value,
      source: c.source,
      hint: !c.value ? null : k === "gmailUser" ? c.value : `…${c.value.slice(-4)}`,
    };
  }
  return out;
}

const tgToken = () => credential("telegramBotToken").value;
export const telegramWebhookSecret = () =>
  process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
  crypto.createHash("sha256").update(`oneup-webhook:${tgToken()}`).digest("hex").slice(0, 48);

export function notifyConfig() {
  return {
    telegram: !!tgToken(),
    email: !!(credential("gmailUser").value && credential("gmailAppPassword").value),
  };
}

// ── Telegram ──

async function tg(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.telegram.org/bot${tgToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { ok: boolean; description?: string; result?: Record<string, unknown> };
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed (${res.status})`);
  return data.result ?? {};
}

let botUsername: string | null = null;
export async function telegramBotUsername(): Promise<string | null> {
  if (!tgToken()) return null;
  if (botUsername) return botUsername;
  const me = await tg("getMe", {});
  botUsername = typeof me.username === "string" ? me.username : null;
  return botUsername;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function telegramText(m: Message): string {
  const parts = [`<b>${esc(m.title)}</b>`];
  if (m.lines?.length) parts.push(m.lines.map(esc).join("\n"));
  if (m.link) parts.push(`<a href="${esc(m.link.url)}">${esc(m.link.label)}</a>`);
  return parts.join("\n\n");
}

export async function sendTelegram(chatId: string, m: Message): Promise<void> {
  await tg("sendMessage", {
    chat_id: chatId,
    text: telegramText(m),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// One-time code the person sends the bot (via a t.me deep link) to connect
// their chat to their OneUp account.
export async function telegramConnectLink(userId: number): Promise<string> {
  const bot = await telegramBotUsername();
  if (!bot) throw new Error("The Telegram bot isn't set up yet (TELEGRAM_BOT_TOKEN).");
  const code = crypto.randomBytes(12).toString("hex");
  rawDb.prepare("UPDATE users SET telegram_link_code = ? WHERE id = ?").run(code, userId);
  return `https://t.me/${bot}?start=${code}`;
}

interface TgUpdate {
  message?: {
    text?: string;
    chat?: { id: number; type?: string };
    from?: { username?: string; first_name?: string };
  };
}

// Handles what people send the bot: "/start <code>" connects, "/stop"
// disconnects, anything else gets a short explanation.
export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  ensureAuthTables();
  const msg = update.message;
  if (!msg?.chat || msg.chat.type && msg.chat.type !== "private") return;
  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();
  const reply = (t: string) => tg("sendMessage", { chat_id: chatId, text: t, parse_mode: "HTML" }).catch(() => {});

  const start = text.match(/^\/start(?:\s+([a-f0-9]{24}))?$/i);
  if (start?.[1]) {
    const row = rawDb
      .prepare("SELECT id, name FROM users WHERE telegram_link_code = ?")
      .get(start[1].toLowerCase()) as { id: number; name: string } | undefined;
    if (!row) {
      await reply("That link has expired. Open OneUp → your profile → <b>Connect Telegram</b> again.");
      return;
    }
    // One chat belongs to one account: connecting here disconnects it elsewhere.
    rawDb.prepare("UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?").run(chatId);
    rawDb
      .prepare(
        "UPDATE users SET telegram_chat_id = ?, telegram_link_code = NULL, telegram_username = COALESCE(?, telegram_username) WHERE id = ?"
      )
      .run(chatId, msg.from?.username ?? null, row.id);
    await reply(`Connected ✅\nHi ${esc(row.name)}, OneUp will message you here when there's work for you.\nSend /stop to disconnect.`);
    return;
  }
  if (/^\/stop$/i.test(text)) {
    rawDb.prepare("UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?").run(chatId);
    await reply("Disconnected. You won't get OneUp messages here any more.");
    return;
  }
  await reply("Hi! To get OneUp notifications here, open OneUp → your profile → <b>Connect Telegram</b>.");
}

// Points Telegram at this app's webhook. Run once (Settings) after deploying.
export async function setupTelegramWebhook(origin: string): Promise<string> {
  const url = `${origin.replace(/\/$/, "")}/api/telegram/webhook`;
  await tg("setWebhook", {
    url,
    secret_token: telegramWebhookSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  return url;
}

// ── Email (Gmail) ──

let transport: nodemailer.Transporter | null = null;
function mailer(): nodemailer.Transporter | null {
  const user = credential("gmailUser").value;
  const pass = credential("gmailAppPassword").value.replace(/\s+/g, "");
  if (!user || !pass) return null;
  if (!transport) transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  return transport;
}

function emailHtml(m: Message): string {
  const lines = (m.lines ?? []).map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("");
  const button = m.link
    ? `<p style="margin:20px 0 0"><a href="${esc(m.link.url)}" style="background:#f7931e;color:#01171e;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(m.link.label)}</a></p>`
    : "";
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#01171e">
    <p style="margin:0 0 16px;font-weight:800;font-size:18px">One<span style="color:#f7931e">Up</span> <span style="font-weight:500;font-size:13px;color:#566468">Studio</span></p>
    <h2 style="margin:0 0 12px;font-size:17px">${esc(m.title)}</h2>${lines}${button}
  </div>`;
}

export async function sendEmail(to: string, m: Message): Promise<void> {
  const t = mailer();
  if (!t) throw new Error("Email isn't set up (GMAIL_USER / GMAIL_APP_PASSWORD).");
  await t.sendMail({
    from: `OneUp Studio <${credential("gmailUser").value}>`,
    to,
    subject: m.title,
    text: [m.title, ...(m.lines ?? []), m.link ? `${m.link.label}: ${m.link.url}` : ""].filter(Boolean).join("\n\n"),
    html: emailHtml(m),
  });
}

// ── Fan-out ──

interface Contact {
  id: number;
  email: string | null;
  telegram_chat_id: string | null;
}

function contacts(userIds: number[]): Contact[] {
  if (userIds.length === 0) return [];
  return rawDb
    .prepare(`SELECT id, email, telegram_chat_id FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`)
    .all(...userIds) as Contact[];
}

function log(event: string, userId: number, channel: string, ok: boolean, error?: string) {
  rawDb
    .prepare("INSERT INTO notifications_log (event, user_id, channel, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(event, userId, channel, ok ? 1 : 0, error?.slice(0, 500) ?? null, new Date().toISOString());
}

export interface NotifyResult {
  recipients: number;
  telegram: number;
  email: number;
  failed: number;
  unreachable: string[];
}

// Send `m` to these people. Never throws: a notification failing must not
// undo the action that triggered it.
export async function notifyUsers(event: string, users: PublicUser[], m: Message): Promise<NotifyResult> {
  ensureNotifyTables();
  const unique = [...new Map(users.map((u) => [u.id, u])).values()];
  const out: NotifyResult = { recipients: unique.length, telegram: 0, email: 0, failed: 0, unreachable: [] };
  const byId = new Map(contacts(unique.map((u) => u.id)).map((c) => [c.id, c]));
  const cfg = notifyConfig();

  await Promise.all(
    unique.map(async (u) => {
      const c = byId.get(u.id);
      let reached = false;
      if (cfg.telegram && c?.telegram_chat_id) {
        try {
          await sendTelegram(c.telegram_chat_id, m);
          out.telegram++;
          reached = true;
          log(event, u.id, "telegram", true);
        } catch (err) {
          out.failed++;
          log(event, u.id, "telegram", false, err instanceof Error ? err.message : String(err));
        }
      }
      if (cfg.email && c?.email) {
        try {
          await sendEmail(c.email, m);
          out.email++;
          reached = true;
          log(event, u.id, "email", true);
        } catch (err) {
          out.failed++;
          log(event, u.id, "email", false, err instanceof Error ? err.message : String(err));
        }
      }
      if (!reached) out.unreachable.push(u.name);
    })
  );
  return out;
}

export function usersWhere(pred: (u: PublicUser) => boolean): PublicUser[] {
  return listUsers().filter(pred);
}
