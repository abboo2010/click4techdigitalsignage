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
    clearStage();
    document.body.classList.add("closed");
    scheduleAdvance(10000);
  } else if (open && closedNow) {
    closedNow = false;
    document.body.classList.remove("closed", "closed-logo");
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

async function loadScreen() {
  const { data, error } = await db
    .from("screens")
    .select("*")
    .eq("slug", screenSlug)
    .single();
  if (error || !data) return null;
  return data;
}

async function loadPlaylist(screenId) {
  const [mediaRes, menuRes] = await Promise.all([
    db.from("media_items").select("*").eq("screen_id", screenId).order("sort_order", { ascending: true }),
    // If menu boards have not been set up yet this simply returns nothing.
    db.from("menu_boards").select("*").eq("screen_id", screenId),
  ]);
  if (mediaRes.error) return [];
  const media = mediaRes.data || [];
  const menus = (menuRes && !menuRes.error && menuRes.data) ? menuRes.data : [];

  // Remember how many items exist, so the empty screen can say whether
  // nothing was uploaded or nothing is scheduled right now.
  totalItems = media.length + menus.length;

  // Only keep what is scheduled to play right now (Malaysia time).
  const entries = media.filter(item => isScheduledNow(item));

  // A menu board becomes one or more full-screen slides.
  menus.filter(menu => isScheduledNow(menu)).forEach(menu => {
    const pages = paginateMenu(menu, window.innerWidth, window.innerHeight);
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
  return entries;
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
    stage.appendChild(buildMenuPageEl(item.page, item.menu, {
      w: window.innerWidth,
      fullH: window.innerHeight,
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
    screenRow = freshScreen;
    applyLogo(screenRow);
  }
  syncOpenState();

  const [freshPlaylist, freshTicker] = await Promise.all([
    loadPlaylist(screenRow.id),
    loadTickerText(screenRow.id),
  ]);
  if (JSON.stringify(freshPlaylist) !== JSON.stringify(playlist)) {
    pendingPlaylist = freshPlaylist;
  }
  if (freshTicker !== lastTickerText) {
    lastTickerText = freshTicker;
    buildTickerTrack(freshTicker || "Welcome");
  }
}

async function init() {
  if (!screenSlug) {
    showFatal("No screen specified. The player link should look like player.html?screen=your-screen-slug");
    return;
  }
  screenRow = await loadScreen();
  if (!screenRow) {
    showFatal("Screen not found. Check the player link is correct.");
    return;
  }

  applyLogo(screenRow);

  playlist = await loadPlaylist(screenRow.id);
  lastTickerText = await loadTickerText(screenRow.id);
  buildTickerTrack(lastTickerText || "Welcome");

  if (!isWithinHours(screenRow)) {
    currentIndex = -1;   // so the first item plays when the screen opens
    syncOpenState();
  } else if (playlist.length) {
    showItem(playlist[currentIndex]);
  } else {
    showEmptyState();
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
