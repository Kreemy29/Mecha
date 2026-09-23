// Mecha Work Tracker: background service worker.
//
// While the user is clocked in, it keeps one "current segment" (the tab in
// focus, or idle, or away from Chrome). Whenever focus changes the segment is
// closed and queued, and once a minute the queue is sent to the app at
// /api/tracker/ext. Nothing is recorded while clocked out; the server drops
// anything that arrives outside a work session anyway.
//
// Service workers get killed when idle, so every piece of state lives in
// chrome.storage (config and queue in local, the open segment in session).

const IDLE_SECONDS = 120;
const TICK_MINUTES = 1;

chrome.idle.setDetectionInterval(IDLE_SECONDS);

// Tab/focus events and the minute tick can fire together; each reads and
// rewrites the open segment, so run them strictly one after another.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function getConfig() {
  const c = await chrome.storage.local.get(["appUrl", "key", "clockedIn", "name"]);
  return { appUrl: c.appUrl || "", key: c.key || "", clockedIn: !!c.clockedIn, name: c.name || "" };
}

async function api(action, extra = {}) {
  const { appUrl, key } = await getConfig();
  if (!appUrl || !key) throw new Error("Not set up");
  const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/tracker/ext`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  await chrome.storage.local.set({ clockedIn: !!data.clockedIn, name: data.name || "" });
  await updateBadge(!!data.clockedIn);
  return data;
}

async function updateBadge(on) {
  await chrome.action.setBadgeText({ text: on ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: on ? "#10b981" : "#6b7280" });
}

// What the user is doing right now, as a segment descriptor.
async function currentState() {
  const idle = await chrome.idle.queryState(IDLE_SECONDS);
  if (idle !== "active") return { kind: "idle" };
  const win = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  if (!win || !win.focused) return { kind: "away" };
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) return { kind: "away" };
  return { kind: "browse", url: tab.url || tab.pendingUrl || "", title: tab.title || "" };
}

const sameSegment = (a, b) => a && b && a.kind === b.kind && (a.url || "") === (b.url || "");

async function closeCurrent(now) {
  const { current } = await chrome.storage.session.get("current");
  if (!current) return;
  const { queue = [] } = await chrome.storage.local.get("queue");
  if (Date.parse(now) - Date.parse(current.start) >= 1000) {
    queue.push({ ...current, end: now });
  }
  await chrome.storage.local.set({ queue: queue.slice(-2000) });
  await chrome.storage.session.remove("current");
}

// Close the running segment if what the user is doing changed, then start
// the new one. A title change on the same URL just updates the title.
async function refresh() {
  const { clockedIn } = await getConfig();
  if (!clockedIn) {
    await chrome.storage.session.remove("current");
    return;
  }
  const next = await currentState();
  const { current } = await chrome.storage.session.get("current");
  const now = new Date().toISOString();
  if (sameSegment(current, next)) {
    if (next.title && next.title !== current.title) {
      await chrome.storage.session.set({ current: { ...current, title: next.title } });
    }
    return;
  }
  await closeCurrent(now);
  await chrome.storage.session.set({ current: { ...next, start: now } });
}

// Once a minute: cut the running segment so recent time is reported, send
// the queue, and pick up clock changes made in the web app.
async function tick() {
  const cfg = await getConfig();
  if (!cfg.appUrl || !cfg.key) return;
  try {
    if (cfg.clockedIn) {
      const now = new Date().toISOString();
      const { current } = await chrome.storage.session.get("current");
      await closeCurrent(now);
      if (current) {
        await chrome.storage.session.set({
          current: { kind: current.kind, url: current.url, title: current.title, start: now },
        });
      }
    }
    const { queue = [] } = await chrome.storage.local.get("queue");
    if (queue.length) {
      await api("activity", { segments: queue.slice(0, 500) });
      const { queue: after = [] } = await chrome.storage.local.get("queue");
      await chrome.storage.local.set({ queue: after.slice(Math.min(500, queue.length)) });
    } else {
      await api("status");
    }
    const { clockedIn } = await getConfig();
    if (!clockedIn) {
      await chrome.storage.session.remove("current");
      await chrome.storage.local.set({ queue: [] });
    } else {
      await refresh();
    }
  } catch (err) {
    // Offline or the app is down: keep the queue and try again next tick.
    console.warn("[tracker]", err.message);
  }
}

const onChange = () => serial(refresh);

chrome.alarms.create("tick", { periodInMinutes: TICK_MINUTES });
chrome.alarms.onAlarm.addListener((a) => a.name === "tick" && serial(tick));
chrome.runtime.onStartup.addListener(() => serial(tick));
chrome.runtime.onInstalled.addListener(() => serial(tick));

chrome.tabs.onActivated.addListener(onChange);
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url || change.title || change.status === "complete")) onChange();
});
chrome.windows.onFocusChanged.addListener(onChange);
chrome.idle.onStateChanged.addListener(onChange);

// Popup → background.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  serial(async () => {
    try {
      if (msg.type === "connect") {
        await chrome.storage.local.set({ appUrl: msg.appUrl.trim(), key: msg.key.trim() });
        const data = await api("status");
        await refresh();
        reply({ ok: true, ...data });
      } else if (msg.type === "status") {
        const cfg = await getConfig();
        if (!cfg.appUrl || !cfg.key) return reply({ ok: true, setup: false });
        const data = await api("status");
        reply({ ok: true, setup: true, ...data });
      } else if (msg.type === "clock") {
        if (msg.action === "clock_out") await closeCurrent(new Date().toISOString());
        // Flush before clocking out so the last minutes aren't dropped.
        const { queue = [] } = await chrome.storage.local.get("queue");
        if (queue.length) {
          await api("activity", { segments: queue.slice(0, 500) });
          await chrome.storage.local.set({ queue: [] });
        }
        const data = await api(msg.action);
        await refresh();
        reply({ ok: true, setup: true, ...data });
      } else if (msg.type === "disconnect") {
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await updateBadge(false);
        reply({ ok: true, setup: false });
      }
    } catch (err) {
      reply({ ok: false, error: err.message });
    }
  });
  return true; // async reply
});
