const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function showError(text) {
  $("error").hidden = !text;
  $("error").textContent = text || "";
}

function render(state) {
  if (!state.ok) showError(state.error);
  else showError("");
  const setup = state.setup !== false && state.ok !== false ? !!state.name : false;
  $("setup").hidden = setup;
  $("main").hidden = !setup;
  $("dot").className = `dot${state.onBreak ? " brk" : state.clockedIn ? " on" : ""}`;
  if (!setup) return;
  $("who").textContent = `Signed in as ${state.name}`;
  $("state").textContent = state.consent === false
    ? "Paused: give permission in OneUp first (Work tracker page)."
    : state.onBreak
    ? "On a break. Nothing is being tracked."
    : state.clockedIn
      ? `On the clock since ${new Date(state.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Clocked out. Nothing is being tracked.";
  $("breakBtn").hidden = !state.clockedIn;
  $("breakBtn").textContent = state.onBreak ? "End break" : "Take a break";
  $("breakBtn").dataset.action = state.onBreak ? "break_end" : "break_start";
  $("clock").textContent = state.clockedIn ? "Clock out" : "Clock in";
  $("clock").className = state.clockedIn ? "out" : "";
  $("clock").dataset.action = state.clockedIn ? "clock_out" : "clock_in";
}

$("connect").addEventListener("click", async () => {
  $("connect").disabled = true;
  const res = await send({ type: "connect", appUrl: $("appUrl").value, key: $("key").value });
  $("connect").disabled = false;
  render(res.ok ? { ...res, setup: true } : { ok: false, error: res.error, setup: false });
});

$("clock").addEventListener("click", async () => {
  $("clock").disabled = true;
  render(await send({ type: "clock", action: $("clock").dataset.action }));
  $("clock").disabled = false;
});

$("breakBtn").addEventListener("click", async () => {
  $("breakBtn").disabled = true;
  render(await send({ type: "clock", action: $("breakBtn").dataset.action }));
  $("breakBtn").disabled = false;
});

$("disconnect").addEventListener("click", async (e) => {
  e.preventDefault();
  render(await send({ type: "disconnect" }));
});

send({ type: "status" }).then(async (res) => {
  if (!res.ok || res.setup === false) {
    const { appUrl } = await chrome.storage.local.get("appUrl");
    if (appUrl) $("appUrl").value = appUrl;
  }
  render(res);
});
