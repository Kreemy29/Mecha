import fs from "fs";
import path from "path";
import crypto from "crypto";

const MCP_URL = process.env.HIGGSFIELD_MCP_URL || "https://mcp.higgsfield.ai";
const AUTHORIZE_EP = `${MCP_URL}/oauth2/authorize`;
const TOKEN_EP = `${MCP_URL}/oauth2/token`;
const REGISTER_EP = `${MCP_URL}/oauth2/register`;
const SCOPE = "openid email offline_access";

const DATA_DIR = path.resolve("./data");
const TOKEN_PATH = path.join(DATA_DIR, "higgsfield-token.json");
const CLIENT_PATH = path.join(DATA_DIR, "higgsfield-oauth-client.json");
const PENDING_PATH = path.join(DATA_DIR, "higgsfield-oauth-pending.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Dynamic client registration (cached per redirect_uri) ──
async function getClientId(redirectUri: string): Promise<string> {
  ensureDir();
  if (fs.existsSync(CLIENT_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CLIENT_PATH, "utf-8"));
      if (cached.redirectUri === redirectUri && cached.clientId) {
        return cached.clientId;
      }
    } catch {
      // re-register
    }
  }

  const res = await fetch(REGISTER_EP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Mecha AI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`Client registration failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  fs.writeFileSync(
    CLIENT_PATH,
    JSON.stringify({ clientId: data.client_id, redirectUri }, null, 2)
  );
  return data.client_id;
}

// ── Step 1: build the authorize URL and stash the PKCE verifier ──
export async function buildAuthorizeUrl(origin: string): Promise<string> {
  const redirectUri = `${origin}/api/higgsfield/callback`;
  const clientId = await getClientId(redirectUri);

  const codeVerifier = b64url(crypto.randomBytes(64));
  const codeChallenge = b64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  const state = b64url(crypto.randomBytes(16));

  ensureDir();
  fs.writeFileSync(
    PENDING_PATH,
    JSON.stringify({ state, codeVerifier, clientId, redirectUri }, null, 2)
  );

  const url = new URL(AUTHORIZE_EP);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", MCP_URL);
  return url.toString();
}

// ── Step 2: exchange the returned code for a token ──
export async function exchangeCodeForToken(
  code: string,
  state: string
): Promise<void> {
  if (!fs.existsSync(PENDING_PATH)) {
    throw new Error("No pending authorization — restart the connect flow");
  }
  const pending = JSON.parse(fs.readFileSync(PENDING_PATH, "utf-8"));
  if (pending.state !== state) {
    throw new Error("State mismatch — possible CSRF, restart the connect flow");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.codeVerifier,
    resource: MCP_URL,
  });

  const res = await fetch(TOKEN_EP, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }

  const tok = await res.json();
  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify(
      {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || undefined,
        expiresAt: tok.expires_in
          ? Date.now() + tok.expires_in * 1000
          : Date.now() + 24 * 60 * 60 * 1000,
        clientId: pending.clientId,
        scope: tok.scope,
        tokenType: tok.token_type,
      },
      null,
      2
    )
  );

  // clean up the pending state
  try {
    fs.unlinkSync(PENDING_PATH);
  } catch {
    // ignore
  }
}
