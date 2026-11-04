/* Patient queue board shown on the TV.
 *
 * startQueueBoard(board, container, db) draws one card per room (room name, doctor,
 * "Now serving", "Next", and the waiting list) and refreshes it every few seconds.
 * When staff press "Call next" the card flashes and a chime plays (if switched on).
 * If the connection drops, the last known queue stays on screen with a small
 * "Reconnecting..." note. Returns { stop() } so the player can stop it when the slide ends.
 */

const QUEUE_POLL_MS = 4000;
const QUEUE_SHOW_WAITING = 5;   // names listed under "Next" per room

let queueAudio = null;
function queueChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!queueAudio) queueAudio = new Ctx();
    if (queueAudio.state === "suspended") queueAudio.resume().catch(() => {});
    const t0 = queueAudio.currentTime;
    // Two soft notes: ding-dong.
    [[880, 0], [660, 0.32]].forEach(([freq, at]) => {
      const osc = queueAudio.createOscillator();
      const gain = queueAudio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7);
      osc.connect(gain); gain.connect(queueAudio.destination);
      osc.start(t0 + at); osc.stop(t0 + at + 0.75);
    });
  } catch (e) { /* sound is optional */ }
}
// Browsers only allow sound after a click/tap on the page; unlock it on the first one.
["pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !queueAudio) queueAudio = new Ctx();
    if (queueAudio && queueAudio.state === "suspended") queueAudio.resume().catch(() => {});
  } catch (e) { /* ignore */ }
}, { once: true }));

function queueEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function queueCols(n, portrait) {
  if (portrait) return n <= 4 ? 1 : 2;
  if (n <= 1) return 1;
  if (n <= 2) return 2;
  if (n <= 6) return n <= 4 ? 2 : 3;
  return 4;
}

// Draws the board for the given rooms. `calledNow` holds ids of rooms to flash.
function renderQueueRooms(board, rooms, calledNow, portrait) {
  const n = Math.max(1, rooms.length);
  const cols = queueCols(n, portrait);
  const rows = Math.ceil(n / cols);
  const cards = rooms.map(r => {
    const waiting = Array.isArray(r.waiting) ? r.waiting : [];
    const next = waiting[0];
    const more = waiting.slice(1, QUEUE_SHOW_WAITING);
    const extra = Math.max(0, waiting.length - QUEUE_SHOW_WAITING);
    const cur = r.current || "";
    return `
      <div class="q-card${calledNow.has(r.id) ? " q-flash" : ""}${cur ? "" : " q-idle"}" data-room="${queueEsc(r.id)}">
        <div class="q-room">
          <div class="q-room-name">${queueEsc(r.name)}</div>
          ${r.doctor ? `<div class="q-doctor">${queueEsc(r.doctor)}</div>` : ""}
        </div>
        <div class="q-now">
          <div class="q-label">Now serving <span>· Sedang dilayan · 正在就诊</span></div>
          <div class="q-current" style="--len:${Math.max(6, cur.length)}">${cur ? queueEsc(cur) : "—"}</div>
        </div>
        <div class="q-next">
          <div class="q-label">Next <span>· Seterusnya · 下一位</span></div>
          <div class="q-nextname" style="--len:${Math.max(8, (next || "").length)}">${next ? queueEsc(next) : "—"}</div>
          ${(more.length || extra) ? `<div class="q-more">${more.length ? "Then: " + more.map(queueEsc).join(" · ") : ""}${extra ? ` <b>+${extra} more</b>` : ""}</div>` : ""}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="q-head">
      <div class="q-title">${queueEsc(board.title || "Patient Queue")}</div>
      <div class="q-clock" data-clock></div>
    </div>
    <div class="q-grid" style="--cols:${cols};--rows:${rows}">${cards || '<div class="q-empty">No rooms have been set up yet.</div>'}</div>
    <div class="q-conn" data-conn>Reconnecting…</div>`;
}

function startQueueBoard(board, container, client) {
  const root = document.createElement("div");
  root.className = "queue-board queue-" + (board.template || "light");
  root.style.setProperty("--accent", board.accent || "#0e6e6e");
  container.appendChild(root);

  let stopped = false;
  let timer = null;
  let clockTimer = null;
  let rooms = [];
  let seen = null;          // room id -> called_at we already announced (null until first load)
  let loaded = false;
  let portrait = false;

  function fitUnit() {
    // Sizes scale like a 16:9 screen of the same width, so tall (portrait) screens stay readable.
    const h = container.clientHeight || window.innerHeight;
    const w = container.clientWidth || window.innerWidth;
    portrait = w < h;
    root.style.setProperty("--u", Math.min(h / 100, w / 177) + "px");
    root.classList.toggle("q-portrait", portrait);
  }
  fitUnit();
  const onResize = () => { fitUnit(); if (loaded) draw(new Set()); };
  window.addEventListener("resize", onResize);

  function tickClock() {
    const el = root.querySelector("[data-clock]");
    if (!el) return;
    const d = new Date();
    el.textContent = d.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" });
  }

  function draw(calledNow) {
    root.innerHTML = renderQueueRooms(board, rooms, calledNow || new Set(), portrait);
    tickClock();
  }

  async function poll() {
    if (stopped) return;
    let ok = false;
    try {
      const { data, error } = await client.rpc("queue_snapshot", { p_board: board.id });
      if (!error && Array.isArray(data)) {
        ok = true;
        const calledNow = new Set();
        const next = {};
        data.forEach(r => {
          next[r.id] = r.called_at || "";
          // A newer call time on a room that has someone in it = a fresh call.
          if (seen && r.current && next[r.id] && seen[r.id] !== next[r.id]) calledNow.add(r.id);
        });
        const changed = JSON.stringify(data) !== JSON.stringify(rooms) || !loaded;
        rooms = data;
        seen = next;
        loaded = true;
        if (changed) draw(calledNow);
        if (calledNow.size && board.chime !== false) queueChime();
        root.classList.remove("q-offline");
      }
    } catch (e) { /* treated as offline below */ }
    if (!ok) {
      if (!loaded) { draw(new Set()); }
      root.classList.add("q-offline");
    }
    if (!stopped) timer = setTimeout(poll, QUEUE_POLL_MS);
  }

  draw(new Set());
  poll();
  clockTimer = setInterval(tickClock, 15000);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clockTimer);
      window.removeEventListener("resize", onResize);
    },
  };
}
