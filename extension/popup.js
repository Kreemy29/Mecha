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
  $("dot").className = `dot${state.clockedIn ? " on" : ""}`;
  if (!setup) return;
  $("who").textContent = `Signed in as ${state.name}`;
  $("state").textContent = state.clockedIn
    ? `On the clock since ${new Date(state.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Clocked out. Nothing is being tracked.";
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
