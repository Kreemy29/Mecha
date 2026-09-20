import fs from "fs";
import path from "path";
import crypto from "crypto";

// Multiple separate Yapper API keys, each its own "account" (mirrors
// higgsfield-accounts.ts). Yapper has no OAuth/identity token to derive a
// stable id from — a static API key is the credential itself — so the id is
// derived by hashing the key, which makes re-pasting the same key update the
// existing entry in place instead of creating a duplicate.

const DATA_DIR = path.resolve("./data");
const ACCOUNTS_PATH = path.join(DATA_DIR, "yapper-accounts.json");

export interface YapperAccount {
  id: string; // sha1(apiKey).slice(0, 16)
  label: string;
  apiKey: string;
}

interface AccountsFile {
  accounts: YapperAccount[];
  activeId: string | null;
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFile(): AccountsFile {
  if (fs.existsSync(ACCOUNTS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf-8"));
    } catch {
      // fall through to empty
    }
  }
  return { accounts: [], activeId: null };
}

function saveFile(data: AccountsFile): void {
  ensureDir();
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(data, null, 2));
}

export function accountIdForKey(apiKey: string): string {
  return crypto.createHash("sha1").update(apiKey).digest("hex").slice(0, 16);
}

export function listAccounts(): YapperAccount[] {
  return loadFile().accounts;
}

export function getActiveAccountId(): string | null {
  const file = loadFile();
  return file.activeId ?? file.accounts[0]?.id ?? null;
}

export function getAccount(id: string): YapperAccount | null {
  return loadFile().accounts.find((a) => a.id === id) || null;
}

export function setActiveAccount(id: string): void {
  const file = loadFile();
  if (!file.accounts.some((a) => a.id === id)) {
    throw new Error(`Unknown Yapper account: ${id}`);
  }
  file.activeId = id;
  saveFile(file);
}

export function removeAccount(id: string): void {
  const file = loadFile();
  file.accounts = file.accounts.filter((a) => a.id !== id);
  if (file.activeId === id) {
    file.activeId = file.accounts[0]?.id || null;
  }
  saveFile(file);
}

// Insert a freshly pasted API key, or update the label of an existing one —
// pasting the same key twice updates in place rather than duplicating.
export function upsertAccount(account: YapperAccount, makeActive: boolean): void {
  const file = loadFile();
  const idx = file.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) file.accounts[idx] = account;
  else file.accounts.push(account);
  if (makeActive || file.activeId === null) file.activeId = account.id;
  saveFile(file);
}
