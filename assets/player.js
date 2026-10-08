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
    clearStage();
    document.body.classList.add("closed");
    scheduleAdvance(10000);
  } else if (open && closedNow) {
    closedNow = false;
    document.body.classList.remove("closed", "closed-logo");
    advance();
    sideIndex = -1;
    showSideItem();
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

function currentLayout(screen) {
  const l = screen && screen.layout;
  return (l === "right" || l === "left" || l === "bottom") ? l : "full";
}

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

function applyLayout(screen) {
  layoutNow = currentLayout(screen);
  document.body.classList.remove("layout-right", "layout-left", "layout-bottom", "has-side");
  if (layoutNow !== "full") document.body.classList.add("has-side", "layout-" + layoutNow);
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

  clearInterval(clockTimer);
  if (layoutNow !== "full") { updateClock(); clockTimer = setInterval(updateClock, 5000); }
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

async function loadPlaylist(screenId) {
  const [mediaRes, menuRes] = await Promise.all([
    db.from("media_items").select("*").eq("screen_id", screenId).order("sort_order", { ascending: true }),
    // If menu boards have not been set up yet this simply returns nothing.
    db.from("menu_boards").select("*").eq("screen_id", screenId),
  ]);
  if (mediaRes.error) return { main: [], side: [] };
  const allMedia = mediaRes.data || [];
  syncOfflineMedia(allMedia);   // keep every file of this screen stored on the device
  const media = allMedia.filter(m => m.zone !== "side");
  const sideMedia = allMedia.filter(m => m.zone === "side" && m.type === "image");
  const menus = (menuRes && !menuRes.error && menuRes.data) ? menuRes.data : [];

  // Remember how many items exist, so the empty screen can say whether
  // nothing was uploaded or nothing is scheduled right now.
  totalItems = media.length + menus.length;

  // Only keep what is scheduled to play right now (Malaysia time).
  const entries = media.filter(item => isScheduledNow(item));

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
    const seconds = item.duration_seconds || (screenRow && screenRow.image_duration) || 8;
    scheduleAdvance(seconds * 1000);
  } else if (item.type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("ended", advance, { once: true });
    video.addEventListener("error", advance, { once: true });
    stage.appendChild(video);
    const fallback = setTimeout(advance, VIDEO_START_FALLBACK_MS);
    video.play().then(() => clearTimeout(fallback)).catch(() => {});
  } else {
    scheduleAdvance(3000);
  }
}

function advance() {
  clearTimeout(advanceTimer);
  if (closedNow) { scheduleAdvance(10000); return; }
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
    const layoutChanged = currentLayout(freshScreen) !== layoutNow;
    screenRow = freshScreen;
    if (layoutChanged) { location.reload(); return; }   // re-measure everything for the new layout
    applyLogo(screenRow);
    applyLayout(screenRow);
  }
  syncOpenState();

  const [freshPlaylist, freshTicker] = await Promise.all([
    loadPlaylist(screenRow.id),
    loadTickerText(screenRow.id),
  ]);
  if (JSON.stringify(freshPlaylist.main) !== JSON.stringify(playlist)) {
    pendingPlaylist = freshPlaylist.main;
  }
  if (JSON.stringify(freshPlaylist.side) !== JSON.stringify(sidePlaylist)) {
    pendingSide = freshPlaylist.side;
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

  const loaded = await loadPlaylist(screenRow.id);
  playlist = loaded.main;
  sidePlaylist = loaded.side;
  lastTickerText = await loadTickerText(screenRow.id);
  await waitForFont(screenRow.ticker_font);
  buildTickerTrack(lastTickerText || "Welcome");

  if (!isWithinHours(screenRow)) {
    currentIndex = -1;   // so the first item plays when the screen opens
    syncOpenState();
  } else if (playlist.length) {
    showItem(playlist[currentIndex]);
  } else {
    showEmptyState();
  }

  showSideItem();
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
