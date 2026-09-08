import fs from "fs";
import path from "path";

// Multiple separate Higgsfield logins, each with its own OAuth tokens. One is
// "active" — that's the account every existing call site (job submission,
// character sync, etc.) uses when it doesn't ask for a specific account by
// id, so nothing outside Methods/Settings needs to know accounts exist at all.

const DATA_DIR = path.resolve("./data");
const ACCOUNTS_PATH = path.join(DATA_DIR, "higgsfield-accounts.json");
const LEGACY_TOKEN_PATH = path.join(DATA_DIR, "higgsfield-token.json");

export interface HiggsfieldAccount {
  id: string; // Clerk "sub" from the id_token when known, else a random id
  label: string; // email from the id_token when known, else a placeholder
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
}

interface AccountsFile {
  accounts: HiggsfieldAccount[];
  activeId: string | null;
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// One-time upgrade from the single-account file this app used before
// multi-account support existed.
function migrateLegacy(): AccountsFile | null {
  if (!fs.existsSync(LEGACY_TOKEN_PATH)) return null;
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_TOKEN_PATH, "utf-8"));
    if (!legacy.accessToken) return null;
    const account: HiggsfieldAccount = {
      id: "legacy",
      label: "Higgsfield account",
      accessToken: legacy.accessToken,
      refreshToken: legacy.refreshToken,
      expiresAt: legacy.expiresAt,
      clientId: legacy.clientId,
    };
    return { accounts: [account], activeId: account.id };
  } catch {
    return null;
  }
}

function loadFile(): AccountsFile {
  if (fs.existsSync(ACCOUNTS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf-8"));
    } catch {
      // fall through to legacy/empty
    }
  }
  const migrated = migrateLegacy();
  if (migrated) {
    saveFile(migrated);
    return migrated;
  }
  return { accounts: [], activeId: null };
}

function saveFile(data: AccountsFile): void {
  ensureDir();
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(data, null, 2));
}

export function listAccounts(): HiggsfieldAccount[] {
  return loadFile().accounts;
}

export function getActiveAccountId(): string | null {
  const file = loadFile();
  return file.activeId ?? file.accounts[0]?.id ?? null;
}

export function getAccount(id: string): HiggsfieldAccount | null {
  return loadFile().accounts.find((a) => a.id === id) || null;
}

export function setActiveAccount(id: string): void {
  const file = loadFile();
  if (!file.accounts.some((a) => a.id === id)) {
    throw new Error(`Unknown Higgsfield account: ${id}`);
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

// Insert a freshly authorized account, or refresh an existing one with the
// same id — re-connecting the same Higgsfield login updates its tokens in
// place instead of creating a duplicate entry.
export function upsertAccount(account: HiggsfieldAccount, makeActive: boolean): void {
  const file = loadFile();
  const idx = file.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) file.accounts[idx] = account;
  else file.accounts.push(account);
  if (makeActive || file.activeId === null) file.activeId = account.id;
  saveFile(file);
}

// Called after a token refresh — updates just the token fields, leaving
// label/id alone.
export function updateAccountTokens(
  id: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }
): void {
  const file = loadFile();
  const account = file.accounts.find((a) => a.id === id);
  if (!account) return;
  Object.assign(account, tokens);
  saveFile(file);
}
