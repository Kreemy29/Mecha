"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plug,
  Unplug,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Key,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";

interface HfAccount {
  id: string;
  label: string;
}

interface HfStatus {
  connected: boolean;
  hasToken: boolean;
  accounts: HfAccount[];
  activeAccountId: string | null;
}

interface McpTool {
  name: string;
  description?: string;
}

export default function SettingsPage() {
  const [hfStatus, setHfStatus] = useState<HfStatus | null>(null);
  const [hfTools, setHfTools] = useState<McpTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/higgsfield/status");
      setHfStatus(await res.json());
    } catch {
      setHfStatus({ connected: false, hasToken: false, accounts: [], activeAccountId: null });
    }
  }, []);

  const switchAccount = async (id: string) => {
    try {
      const res = await fetch("/api/higgsfield/accounts/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Switched active Higgsfield account");
      fetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to switch account");
    }
  };

  const removeAccount = async (id: string) => {
    try {
      await fetch(`/api/higgsfield/accounts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      toast.success("Account removed");
      fetchStatus();
    } catch {
      toast.error("Failed to remove account");
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Handle the OAuth redirect result (?hf_connected / ?hf_error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("hf_connected")) {
      toast.success("Connected to Higgsfield");
      fetchStatus();
      window.history.replaceState({}, "", "/settings");
    } else if (params.get("hf_error")) {
      toast.error(`Higgsfield connect failed: ${params.get("hf_error")}`);
      window.history.replaceState({}, "", "/settings");
    }
  }, [fetchStatus]);

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      const res = await fetch("/api/higgsfield/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: tokenInput.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success("Higgsfield token saved");
        setTokenInput("");
        fetchStatus();
      } else {
        toast.error(data.error || "Failed to save token");
      }
    } catch {
      toast.error("Failed to save token");
    } finally {
      setSavingToken(false);
    }
  };

  const handleDiscoverTools = async () => {
    setLoadingTools(true);
    try {
      const res = await fetch("/api/higgsfield/tools");
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setHfTools(data.tools || []);
        toast.success(`Discovered ${data.tools?.length || 0} tools`);
        fetchStatus();
      }
    } catch {
      toast.error("Failed to connect to Higgsfield MCP");
    } finally {
      setLoadingTools(false);
    }
  };

  const handleSyncCharacters = async () => {
    try {
      const res = await fetch("/api/higgsfield/characters", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(data.message);
      }
    } catch {
      toast.error("Failed to sync characters");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Service connections, API keys, and system configuration
        </p>
      </div>

      {/* Higgsfield MCP Connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Zap className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <CardTitle className="text-base">Higgsfield MCP</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Image & video generation via Soul characters
                </p>
              </div>
            </div>
            {hfStatus && (
              <Badge
                className={`text-xs border gap-1.5 ${
                  hfStatus.hasToken
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }`}
              >
                {hfStatus.hasToken ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Token configured
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3" />
                    Not connected
                  </>
                )}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Primary: one-click OAuth connect */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Connect a Higgsfield account in one click. You&apos;ll be taken to
              Higgsfield&apos;s sign-in page to authorize, then redirected back here.
              The access token is captured and refreshed automatically. Signing in
              with a different Higgsfield login connects it as a separate account
              alongside any others.
            </p>
            <a href="/api/higgsfield/connect" className="inline-block">
              <Button
                className={`rounded-xl gap-2 text-white ${
                  hfStatus?.hasToken
                    ? "bg-white/10 hover:bg-white/15"
                    : "bg-[oklch(0.75_0.15_270)] hover:bg-[oklch(0.7_0.15_270)]"
                }`}
              >
                <Plug className="h-4 w-4" />
                {hfStatus?.hasToken
                  ? "Connect another Higgsfield account"
                  : "Connect Higgsfield MCP"}
              </Button>
            </a>
          </div>

          {/* Connected accounts */}
          {hfStatus && hfStatus.accounts.length > 0 && (
            <div className="space-y-2 border-t border-white/5 pt-3">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Connected accounts
              </label>
              <div className="space-y-1.5">
                {hfStatus.accounts.map((acct) => {
                  const isActive = acct.id === hfStatus.activeAccountId;
                  return (
                    <div
                      key={acct.id}
                      className="flex items-center gap-2 p-2 rounded-xl glass text-sm"
                    >
                      <button
                        type="button"
                        onClick={() => !isActive && switchAccount(acct.id)}
                        disabled={isActive}
                        className={`flex items-center gap-2 flex-1 text-left ${
                          isActive ? "" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title={isActive ? "Active account" : "Switch to this account"}
                      >
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 ${
                            isActive ? "text-emerald-400" : "text-muted-foreground/30"
                          }`}
                        />
                        {acct.label}
                        {isActive && (
                          <Badge className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                            active
                          </Badge>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAccount(acct.id)}
                        className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                        title="Remove this account"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Advanced: manual token paste */}
          <div className="border-t border-white/5 pt-3">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showManual ? "▾" : "▸"} Advanced — paste a token manually
            </button>
            {showManual && (
              <div className="space-y-2 mt-3">
                <p className="text-xs text-muted-foreground">
                  Already have a token (e.g. from Claude Desktop / Cursor)? Paste it
                  here instead of using the connect flow.
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="Paste your Higgsfield access token..."
                      className="glass border-white/10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    onClick={handleSaveToken}
                    disabled={!tokenInput.trim() || savingToken}
                    variant="outline"
                    className="rounded-xl border-white/10 gap-2"
                  >
                    {savingToken ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Key className="h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={handleDiscoverTools}
              disabled={loadingTools || !hfStatus?.hasToken}
              size="sm"
              variant="outline"
              className="rounded-xl border-white/10 gap-2"
            >
              {loadingTools ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              Discover Tools
            </Button>
            <Button
              onClick={handleSyncCharacters}
              disabled={!hfStatus?.hasToken}
              size="sm"
              variant="outline"
              className="rounded-xl border-white/10 gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Sync Characters
            </Button>
          </div>

          {/* Discovered tools */}
          {hfTools.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Discovered Tools ({hfTools.length})
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {hfTools.map((tool) => (
                  <div
                    key={tool.name}
                    className="p-3 rounded-xl glass text-xs space-y-1"
                  >
                    <div className="font-mono font-medium text-foreground">
                      {tool.name}
                    </div>
                    {tool.description && (
                      <p className="text-muted-foreground line-clamp-2">
                        {tool.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Keys Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: "XAI_API_KEY (Grok)", env: "XAI_API_KEY" },
              { name: "FAL_KEY (fal.ai)", env: "FAL_KEY" },
              { name: "RAPIDAPI_KEY", env: "RAPIDAPI_KEY" },
              { name: "RUNNINGHUB_API_KEY", env: "RUNNINGHUB_API_KEY" },
              { name: "SLACK_WEBHOOK_URL", env: "SLACK_WEBHOOK_URL" },
              { name: "SLACK_BOT_TOKEN", env: "SLACK_BOT_TOKEN" },
            ].map((item) => (
              <div
                key={item.env}
                className="flex items-center justify-between p-3 rounded-xl glass"
              >
                <span className="text-sm">{item.name}</span>
                <Badge
                  variant="outline"
                  className="text-xs border-white/10 bg-white/5"
                >
                  Set in .env.local
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            API keys are configured in <code className="text-[10px] bg-white/5 px-1 py-0.5 rounded">.env.local</code>. Restart the dev server after changes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
