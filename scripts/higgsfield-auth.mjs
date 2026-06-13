// Higgsfield MCP — Authorization Code + PKCE flow runner
// Registers a client, runs a localhost callback, exchanges the code for a token,
// and writes it to data/higgsfield-token.json (the format the app's client expects).

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AUTH_SERVER = "https://mcp.higgsfield.ai";
const RESOURCE = "https://mcp.higgsfield.ai";
const AUTHORIZE_EP = `${AUTH_SERVER}/oauth2/authorize`;
const TOKEN_EP = `${AUTH_SERVER}/oauth2/token`;
const REGISTER_EP = `${AUTH_SERVER}/oauth2/register`;
const SCOPE = "openid email offline_access";

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TOKEN_PATH = path.resolve("./data/higgsfield-token.json");

// ── PKCE helpers ──
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const codeVerifier = b64url(crypto.randomBytes(64));
const codeChallenge = b64url(crypto.createHash("sha256").update(codeVerifier).digest());
const state = b64url(crypto.randomBytes(16));

async function registerClient() {
  const res = await fetch(REGISTER_EP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Mecha AI",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`register failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function exchangeCode(clientId, code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: codeVerifier,
    resource: RESOURCE,
  });
  const res = await fetch(TOKEN_EP, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function saveTokens(tok) {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const expiresAt = tok.expires_in
    ? Date.now() + tok.expires_in * 1000
    : Date.now() + 7 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify(
      {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || undefined,
        expiresAt,
        clientId: CURRENT_CLIENT_ID,
        scope: tok.scope,
        tokenType: tok.token_type,
      },
      null,
      2
    )
  );
}

let CURRENT_CLIENT_ID = null;

async function main() {
  let client;
  if (process.env.HF_CLIENT_ID) {
    client = { client_id: process.env.HF_CLIENT_ID };
    console.log(`[auth] Reusing client_id=${client.client_id}`);
  } else {
    console.log("[auth] Registering client...");
    client = await registerClient();
    console.log(`[auth] client_id=${client.client_id}`);
  }
  CURRENT_CLIENT_ID = client.client_id;

  const authUrl = new URL(AUTHORIZE_EP);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", RESOURCE);

  console.log("\n==== AUTHORIZE URL ====");
  console.log(authUrl.toString());
  console.log("==== END URL ====\n");
  console.log("[auth] Waiting for you to approve in the browser...");

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith("/callback")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h2>Authorization failed</h2><p>${error}: ${url.searchParams.get("error_description") || ""}</p>`);
      console.error(`[auth] ERROR: ${error}`);
      server.close();
      process.exit(1);
    }
    if (returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h2>State mismatch</h2>");
      console.error("[auth] ERROR: state mismatch");
      server.close();
      process.exit(1);
    }

    try {
      console.log("[auth] Got code, exchanging for token...");
      const tok = await exchangeCode(client.client_id, code);
      saveTokens(tok);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body style='font-family:system-ui;background:#0f0f17;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh'><div style='text-align:center'><h1 style='color:#a78bfa'>✓ Connected to Higgsfield</h1><p>Token saved. You can close this tab and return to Mecha AI.</p></div></body></html>"
      );
      console.log(`\n[auth] SUCCESS — token written to ${TOKEN_PATH}`);
      console.log(`[auth] has refresh_token: ${!!tok.refresh_token}`);
      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h2>Token exchange failed</h2><pre>${err.message}</pre>`);
      console.error(`[auth] ${err.message}`);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log(`[auth] Callback listener on ${REDIRECT_URI}`);
  });

  // Safety timeout: 10 minutes
  setTimeout(() => {
    console.error("[auth] Timed out waiting for authorization (10 min).");
    server.close();
    process.exit(1);
  }, 10 * 60 * 1000);
}

main().catch((err) => {
  console.error("[auth] Fatal:", err.message);
  process.exit(1);
});
