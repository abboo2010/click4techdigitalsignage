/* Public signage player -- reads a screen's content from Supabase by
 * its slug (?screen=...) and loops it fullscreen, same look and feel
 * as the original local version, just backed by the online database. */

const SUPABASE_URL = "https://ahjinqeknstwucegsotn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoamlucWVrbnN0d3VjZWdzb3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjUwNzgsImV4cCI6MjEwNDUwMTA3OH0.6NfsD4SxR2f3pkBDrAjBTaE2juXrO85kVXHI7ulxdSk";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const POLL_INTERVAL_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 60000;
const VIDEO_START_FALLBACK_MS = 5000;

const stage = document.getElementById("stage");
const tickerTrack = document.getElementById("ticker-track");

const params = new URLSearchParams(window.location.search);
const screenSlug = params.get("screen");

let screenRow = null;
let playlist = [];
let pendingPlaylist = null;
let currentIndex = 0;
let lastTickerText = null;
let totalItems = 0;
let advanceTimer = null;   // the one pending "go to next item" timer
let closedNow = false;     // true while outside the screen's operating hours
let sidePlaylist = [];     // images for the side panel (sidebar / bottom-strip layouts)
let pendingSide = null;
let sideIndex = -1;
let sideTimer = null;
let clockTimer = null;
let layoutNow = "full";
let scenes = [];           // this screen's scenes, in play order
let rawMedia = [];         // every media item of the screen
let rawMenus = [];         // every menu board of the screen
let activeScene = null;    // the scene playing now
let sceneTimer = null;     // optional fixed time for a scene

function scheduleAdvance(ms) {
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(advance, ms);
}

// Switch between "open" (playing) and "closed" (dark) when the screen's
// operating hours say so. Called on start and every poll.
function syncOpenState() {
  const open = isWithinHours(screenRow);
  document.body.classList.toggle("closed-logo", !open && screenRow.off_hours_mode === "logo");
  if (!open && !closedNow) {
    closedNow = true;
    clearTimeout(advanceTimer);
    clearTimeout(sideTimer);
    clearTimeout(sceneTimer);
    clearStage();
    document.body.classList.add("closed");
    scheduleAdvance(10000);
  } else if (open && closedNow) {
    closedNow = false;
    document.body.classList.remove("closed", "closed-logo");
    enterScene(firstPlayableScene());
    advance();
  }
}

function publicMediaUrl(storagePath) {
  const { data } = db.storage.from("media").getPublicUrl(storagePath);
  return data.publicUrl;
}

function showFatal(text) {
  stage.innerHTML = `<div id="stage-error">${text}</div>`;
}

function applyLogo(screen) {
  const img = document.getElementById("signage-logo");
  if (!img || !screen.logo_path) return;
  img.src = publicMediaUrl(screen.logo_path);
  img.className = screen.logo_position === "right" ? "pos-right" : "pos-left";
  img.classList.add("has-logo");
  img.style.display = "block";
}

// ---------- Layout: main area + side panel ----------

const LAYOUTS_OK = ["full", "right", "left", "bottom", "top", "split", "wideright", "wideleft"];
function validLayout(l) { return LAYOUTS_OK.includes(l) ? l : "full"; }
// layout -> [side position, extra class]
function layoutParts(l) {
  switch (l) {
    case "right": return ["right", ""];
    case "left": return ["left", ""];
    case "bottom": return ["bottom", ""];
    case "top": return ["top", ""];
    case "split": return ["right", "side-split"];
    case "wideright": return ["right", "side-wide"];
    case "wideleft": return ["left", "side-wide"];
    default: return null;
  }
}
const LAYOUT_CLASSES = ["has-side", "layout-right", "layout-left", "layout-bottom", "layout-top", "side-wide", "side-split", "no-ticker"];

// Colours and fonts for the ticker and side panel. Returns true if the ticker font changed.
let lastTickerFont = null;
function applyStyle(screen) {
  const st = document.body.style;
  st.setProperty("--panel", validColor(screen.panel_color, "#8b1e1e"));
  st.setProperty("--panel-text", validColor(screen.panel_text_color, "#ffffff"));
  st.setProperty("--panel-font", fontCss(screen.panel_font));
  if (screen.ticker_bg) st.setProperty("--ticker-bg", validColor(screen.ticker_bg, "#0a0a0a"));
  st.setProperty("--ticker-color", validColor(screen.ticker_color, "#ffffff"));
  // Thin line above the ticker: a colour, or "none" to hide it.
  if (screen.ticker_line === "none") {
    st.setProperty("--ticker-line-w", "0px");
  } else {
    st.setProperty("--ticker-line-w", "3px");
    st.setProperty("--ticker-line", validColor(screen.ticker_line, "#8b1e1e"));
  }
  st.setProperty("--ticker-font", fontCss(screen.ticker_font));
  const fontId = screen.ticker_font || "default";
  const changed = lastTickerFont !== null && lastTickerFont !== fontId;
  lastTickerFont = fontId;
  if (changed) {
    // Re-measure the scrolling text once the new font is ready.
    waitForFont(fontId).then(() => buildTickerTrack(lastTickerText || "Welcome"));
  }
}

// Logo / screen name / colours (shared by every scene).
function applyLayout(screen) {
  applyStyle(screen);
  const logo = document.getElementById("side-logo");
  if (screen.logo_path) {
    logo.src = publicMediaUrl(screen.logo_path);
    logo.classList.add("show");
  } else {
    logo.classList.remove("show");
  }
  // Without a logo, show the screen's name instead.
  document.getElementById("side-name").textContent = screen.logo_path ? "" : (screen.name || "");
}

// The arrangement of one scene: main area, side panel, ticker on or off.
function applySceneLayout(scene) {
  layoutNow = validLayout(scene.layout);
  const cl = document.body.classList;
  cl.remove(...LAYOUT_CLASSES);
  const parts = layoutParts(layoutNow);
  if (parts) { cl.add("has-side", "layout-" + parts[0]); if (parts[1]) cl.add(parts[1]); }
  if (scene.show_ticker === false) cl.add("no-ticker");
  clearInterval(clockTimer);
  if (layoutNow !== "full") { updateClock(); clockTimer = setInterval(updateClock, 5000); }
}

function layoutKey(scene) {
  return [scene.id, validLayout(scene.layout), scene.show_ticker === false ? 0 : 1].join("|");
}

// Live clock in Malaysia time.
function updateClock() {
  const now = new Date();
  document.getElementById("side-clock").textContent =
    new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit", hour12: true })
      .format(now).replace(/\s?(am|pm)/i, (m, ap) => " " + ap.toUpperCase());
  document.getElementById("side-date").textContent =
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "long", day: "numeric", month: "short", year: "numeric" })
      .format(now);
}

function showSideItem() {
  clearTimeout(sideTimer);
  const zone = document.getElementById("side-zone");
  if (layoutNow === "full" || closedNow) return;

  if (pendingSide) { sidePlaylist = pendingSide; pendingSide = null; sideIndex = -1; }
  zone.innerHTML = "";
  if (!sidePlaylist.length) { sideTimer = setTimeout(showSideItem, 5000); return; }

  sideIndex = (sideIndex + 1) % sidePlaylist.length;
  const item = sidePlaylist[sideIndex];
  const url = publicMediaUrl(item.storage_path);
  const frame = document.createElement("div");
  frame.className = "media-frame";
  const bg = document.createElement("img");
  bg.className = "bg"; bg.src = url; bg.alt = "";
  const fg = document.createElement("img");
  fg.className = "fg"; fg.src = url; fg.alt = "";
  frame.appendChild(bg); frame.appendChild(fg);
  zone.appendChild(frame);
  fitFrame(frame, fg);
  const seconds = item.duration_seconds || (screenRow && screenRow.image_duration) || 8;
  sideTimer = setTimeout(showSideItem, seconds * 1000);
}

// Size of the main area, so menu boards fit it whatever the layout.
function mainAreaSize() {
  const st = document.getElementById("stage");
  return { w: st.clientWidth || window.innerWidth, fullH: (st.clientHeight || window.innerHeight) + MENU_TICKER_H };
}

let lastScreenError = null;
async function loadScreen() {
  const { data, error } = await db
    .from("screens")
    .select("*")
    .eq("slug", screenSlug)
    .single();
  if (error || !data) { lastScreenError = error; return null; }
  return data;
}

// ---------- Offline copy ----------
// Registers the service worker (sw.js), which stores the player, the screen's
// data and all of its images/videos on this device, so playback continues
// when the internet drops.

function registerOffline() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => new Promise(resolve => {
      // Is this page being handled by the worker? (A hard refresh, Ctrl+Shift+R,
      // loads the page without it, and then nothing would be stored.)
      if (navigator.serviceWorker.controller) return resolve(true);
      const t = setTimeout(() => resolve(false), 3000);
      navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(t); resolve(true); }, { once: true });
    }))
    .then(controlled => {
      if (!controlled) {
        // Reload once, normally, so the worker takes over.
        try {
          if (!sessionStorage.getItem("swReloaded")) { sessionStorage.setItem("swReloaded", "1"); location.reload(); return; }
        } catch (e) { /* ignore */ }
      }
      // The first requests happened before the worker took over; fetch the
      // data once more now so a copy is stored straight away.
      setTimeout(() => { if (screenRow) pollForUpdates(); }, 1500);
    })
    .catch(() => {});
}

let lastOfflineSync = "";
function syncOfflineMedia(allMedia) {
  if (!("serviceWorker" in navigator)) return;
  const urls = allMedia.filter(m => m.storage_path).map(m => publicMediaUrl(m.storage_path));
  if (screenRow && screenRow.logo_path) urls.push(publicMediaUrl(screenRow.logo_path));
  const key = JSON.stringify(urls);
  if (key === lastOfflineSync) return;
  lastOfflineSync = key;
  navigator.serviceWorker.ready
    .then(reg => reg.active && reg.active.postMessage({ type: "sync", slug: screenSlug, urls }))
    .catch(() => {});
}

// Fetches everything a screen can show. Which part plays when is decided per scene.
async function loadContent(screenId) {
  const [mediaRes, menuRes, sceneRes] = await Promise.all([
    db.from("media_items").select("*").eq("screen_id", screenId).order("sort_order", { ascending: true }),
    // If menu boards / scenes have not been set up yet these simply return nothing.
    db.from("menu_boards").select("*").eq("screen_id", screenId),
    db.from("scenes").select("*").eq("screen_id", screenId),
  ]);
  if (mediaRes.error) return false;
  rawMedia = mediaRes.data || [];
  rawMenus = (menuRes && !menuRes.error && menuRes.data) ? menuRes.data : [];
  syncOfflineMedia(rawMedia);   // keep every file of this screen stored on the device

  const rows = (sceneRes && !sceneRes.error && sceneRes.data) ? sceneRes.data.slice() : [];
  rows.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.created_at).localeCompare(String(b.created_at)));
  // Without scenes the screen behaves exactly as before: one scene with the screen's own layout.
  scenes = rows.length ? rows
    : [{ id: null, name: "Main", layout: screenRow.layout || "full", show_ticker: true, duration_seconds: null }];
  return true;
}

function inScene(item, scene) {
  if (scene.id === null) return true;
  return item.scene_id ? item.scene_id === scene.id : scene.id === scenes[0].id;
}

function sceneHasContent(scene) {
  return rawMedia.some(m => inScene(m, scene) && m.zone !== "side" && isScheduledNow(m))
      || rawMenus.some(m => inScene(m, scene) && isScheduledNow(m));
}

// The playlists (main area and side panel) of one scene, sized for the layout applied right now.
function buildPlaylists(scene) {
  const media = rawMedia.filter(m => inScene(m, scene));
  const mainMedia = media.filter(m => m.zone !== "side");
  const sideMedia = media.filter(m => m.zone === "side" && m.type === "image");
  const menus = rawMenus.filter(m => inScene(m, scene));

  // Remember how many items exist, so the empty screen can say whether
  // nothing was uploaded or nothing is scheduled right now.
  totalItems = mainMedia.length + menus.length;

  // Only keep what is scheduled to play right now (Malaysia time).
  const entries = mainMedia.filter(item => isScheduledNow(item));

  // A menu board becomes one or more full-screen slides.
  menus.filter(menu => isScheduledNow(menu)).forEach(menu => {
    const size = mainAreaSize();
    const pages = paginateMenu(menu, size.w, size.fullH);
    pages.forEach((page, i) => {
      entries.push({
        type: "menu_page",
        id: menu.id + "#" + i,
        sort_order: menu.sort_order,
        pageNo: i + 1,
        pageCount: pages.length,
        page,
        menu: { title: menu.title, template: menu.template, accent: menu.accent, currency: menu.currency },
        duration_seconds: menu.duration_seconds,
      });
    });
  });

  // Same order the client sees on the dashboard (menus and files mixed by when they were added).
  entries.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || ((a.pageNo || 0) - (b.pageNo || 0)));
  return { main: entries, side: sideMedia.filter(item => isScheduledNow(item)) };
}

function firstPlayableScene() {
  return scenes.find(sceneHasContent) || scenes[0];
}

// The next scene that has something to play (may be the same one if it is the only one).
function pickNextScene() {
  const idx = activeScene ? scenes.findIndex(s => s.id === activeScene.id) : -1;
  for (let k = 1; k <= scenes.length; k++) {
    const cand = scenes[(idx + k + scenes.length) % scenes.length];
    if (sceneHasContent(cand)) return cand;
  }
  return scenes[(idx + 1 + scenes.length) % scenes.length];
}

function enterScene(scene) {
  activeScene = scene;
  applySceneLayout(scene);
  const p = buildPlaylists(scene);
  playlist = p.main;
  sidePlaylist = p.side;
  pendingPlaylist = null;
  pendingSide = null;
  currentIndex = -1;
  sideIndex = -1;
  clearTimeout(sceneTimer);
  if (scene.duration_seconds && scenes.length > 1) sceneTimer = setTimeout(sceneTimeUp, scene.duration_seconds * 1000);
  showSideItem();
}

// A scene with a fixed time has used it up.
function sceneTimeUp() {
  if (closedNow) return;
  const next = pickNextScene();
  if (!activeScene || next.id === activeScene.id) {
    // Nothing else to show: keep playing and look again later.
    sceneTimer = setTimeout(sceneTimeUp, (activeScene.duration_seconds || 30) * 1000);
    return;
  }
  clearTimeout(advanceTimer);
  enterScene(next);
  advance();
}

async function loadTickerText(screenId) {
  const { data, error } = await db
    .from("ticker_messages")
    .select("message")
    .eq("screen_id", screenId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error || !data.length) return "";
  return data.map(t => t.message).join("     •     ");
}

function buildTickerTrack(baseText) {
  tickerTrack.classList.remove("scrolling");
  tickerTrack.innerHTML = "";

  const measurer = document.createElement("span");
  measurer.className = "ticker-copy";
  measurer.style.visibility = "hidden";
  measurer.style.position = "absolute";
  measurer.style.whiteSpace = "nowrap";
  measurer.style.left = "-99999px";
  measurer.textContent = baseText;
  document.body.appendChild(measurer);

  const targetWidth = Math.max(window.innerWidth, 800) * 1.5;
  let repeated = baseText;
  let guard = 0;
  while (measurer.scrollWidth < targetWidth && guard < 30) {
    repeated += "     •     " + baseText;
    measurer.textContent = repeated;
    guard++;
  }
  document.body.removeChild(measurer);

  const copyA = document.createElement("span");
  copyA.className = "ticker-copy";
  copyA.textContent = repeated;
  const copyB = document.createElement("span");
  copyB.className = "ticker-copy";
  copyB.textContent = repeated;
  tickerTrack.appendChild(copyA);
  tickerTrack.appendChild(copyB);

  void tickerTrack.offsetWidth;
  const oneCopyWidth = copyA.scrollWidth;
  const speed = (screenRow && screenRow.ticker_speed) || 340;
  const duration = Math.max(8, oneCopyWidth / speed);
  tickerTrack.style.animationDuration = duration + "s";
  tickerTrack.classList.add("scrolling");
}

// A picture that almost fits its space fills it completely (no strip of blurred
// background); anything else is shown whole, with the blurred backdrop around it.
function fitFrame(frame, fg) {
  const apply = () => {
    const box = frame.parentElement;
    if (!box || !fg.naturalWidth || !box.clientWidth || !box.clientHeight) return;
    const ratio = (fg.naturalWidth / fg.naturalHeight) / (box.clientWidth / box.clientHeight);
    frame.classList.toggle("fill", Math.abs(ratio - 1) <= 0.15);
  };
  if (fg.complete) apply(); else fg.addEventListener("load", apply, { once: true });
}

// ---------- Sound ----------
// Browsers only allow sound after the person has clicked on the page once.
// Screens started from the Windows launcher or the Android app are not limited.
let currentVideo = null;
let soundHintTimer = null;

function showSoundHint() {
  let el = document.getElementById("sound-hint");
  if (!el) {
    el = document.createElement("div");
    el.id = "sound-hint";
    el.textContent = "Click anywhere for sound";
    document.body.appendChild(el);
  }
  el.classList.add("show");
  clearTimeout(soundHintTimer);
  soundHintTimer = setTimeout(hideSoundHint, 12000);
}

function hideSoundHint() {
  const el = document.getElementById("sound-hint");
  if (el) el.classList.remove("show");
}

function enableSound() {
  hideSoundHint();
  if (currentVideo && currentVideo.isConnected && currentVideo.muted) {
    currentVideo.muted = false;
    currentVideo.play().catch(() => { currentVideo.muted = true; });
  }
}
["pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, enableSound));

function clearStage() {
  stage.innerHTML = "";
}

function showItem(item) {
  clearStage();
  const url = item.storage_path ? publicMediaUrl(item.storage_path) : null;
  if (item.type === "menu_page") {
    const size = mainAreaSize();
    stage.appendChild(buildMenuPageEl(item.page, item.menu, {
      w: size.w,
      fullH: size.fullH,
      pageNo: item.pageNo,
      pageCount: item.pageCount,
    }));
    scheduleAdvance((item.duration_seconds || 12) * 1000);
  } else if (item.type === "image") {
    const frame = document.createElement("div");
    frame.className = "media-frame";
    const bg = document.createElement("img");
    bg.className = "bg"; bg.src = url; bg.alt = "";
    const fg = document.createElement("img");
    fg.className = "fg"; fg.src = url; fg.alt = "";
    frame.appendChild(bg); frame.appendChild(fg);
    stage.appendChild(frame);
    fitFrame(frame, fg);
    const seconds = item.duration_seconds || (screenRow && screenRow.image_duration) || 8;
    scheduleAdvance(seconds * 1000);
  } else if (item.type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.autoplay = true;
    video.muted = false;   // play with sound; falls back to silent if the browser blocks it
    video.playsInline = true;
    video.addEventListener("ended", advance, { once: true });
    video.addEventListener("error", advance, { once: true });
    stage.appendChild(video);
    const fallback = setTimeout(advance, VIDEO_START_FALLBACK_MS);
    currentVideo = video;
    video.play().then(() => { clearTimeout(fallback); if (!video.muted) hideSoundHint(); }).catch(() => {
      // The browser blocked sound before any click: play silently, and turn sound on at the first click.
      video.muted = true;
      showSoundHint();
      video.play().then(() => clearTimeout(fallback)).catch(() => {});
    });
  } else {
    scheduleAdvance(3000);
  }
}

function advance() {
  clearTimeout(advanceTimer);
  if (closedNow) { scheduleAdvance(10000); return; }

  // Reached the end of this scene's content: on to the next scene (unless it has a fixed time).
  const atEnd = currentIndex >= 0 && currentIndex + 1 >= playlist.length;
  if (atEnd && scenes.length > 1 && !(activeScene && activeScene.duration_seconds)) {
    const next = pickNextScene();
    if (!activeScene || next.id !== activeScene.id) enterScene(next);
  }

  if (pendingPlaylist) {
    playlist = pendingPlaylist;
    pendingPlaylist = null;
    currentIndex = 0;
  } else if (playlist.length) {
    currentIndex = (currentIndex + 1) % playlist.length;
  }

  if (!playlist.length) {
    showEmptyState();
    scheduleAdvance(5000);
    return;
  }
  showItem(playlist[currentIndex]);
}

function showEmptyState() {
  clearStage();
  const div = document.createElement("div");
  div.id = "stage-empty";
  div.textContent = totalItems > 0
    ? "Nothing is scheduled to play right now."
    : "No videos or images have been added to this screen yet.";
  stage.appendChild(div);
}

async function pollForUpdates() {
  // Pick up changes to the screen's own settings (operating hours, logo...).
  const freshScreen = await loadScreen();
  if (freshScreen) {
    screenRow = freshScreen;
    applyLogo(screenRow);
    applyLayout(screenRow);
  }
  syncOpenState();

  const [ok, freshTicker] = await Promise.all([
    loadContent(screenRow.id),
    loadTickerText(screenRow.id),
  ]);

  if (ok && activeScene) {
    const cur = scenes.find(s => s.id === activeScene.id);
    // The layout of the scene that is playing was edited: restart so everything is re-measured.
    if (cur && layoutKey(cur) !== layoutKey(activeScene)) { location.reload(); return; }
    if (cur) activeScene = cur;
    if (!closedNow) {
      const fresh = buildPlaylists(activeScene);
      if (JSON.stringify(fresh.main) !== JSON.stringify(playlist)) pendingPlaylist = fresh.main;
      if (JSON.stringify(fresh.side) !== JSON.stringify(sidePlaylist)) pendingSide = fresh.side;
    }
  }
  if (freshTicker !== lastTickerText) {
    lastTickerText = freshTicker;
    buildTickerTrack(freshTicker || "Welcome");
  }
}

async function init() {
  registerOffline();
  if (!screenSlug) {
    showFatal("No screen specified. The player link should look like player.html?screen=your-screen-slug");
    return;
  }
  screenRow = await loadScreen();
  // No internet at start-up (and nothing stored yet) or a wrong link: keep
  // trying, so the screen starts by itself as soon as it can.
  while (!screenRow) {
    const notFound = lastScreenError && lastScreenError.code === "PGRST116";
    showFatal(notFound
      ? "Screen not found. Check the player link is correct."
      : "Waiting for the internet. This screen starts automatically as soon as it is connected.");
    await new Promise(r => setTimeout(r, 10000));
    screenRow = await loadScreen();
  }

  applyLogo(screenRow);
  applyLayout(screenRow);

  await loadContent(screenRow.id);
  lastTickerText = await loadTickerText(screenRow.id);
  await waitForFont(screenRow.ticker_font);
  buildTickerTrack(lastTickerText || "Welcome");

  if (!isWithinHours(screenRow)) {
    activeScene = scenes[0];
    syncOpenState();   // starts the first scene when the screen opens
  } else {
    enterScene(firstPlayableScene());
    advance();
  }

  setInterval(pollForUpdates, POLL_INTERVAL_MS);

  // Tell the server this screen is alive, now and every minute.
  sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// Check-in used for offline alerts. Failures are ignored on purpose:
// a missed ping must never interrupt what is playing on the screen.
async function sendHeartbeat() {
  try {
    await db.rpc("screen_heartbeat", { p_slug: screenSlug });
  } catch (e) {
    /* ignore */
  }
}

init();
