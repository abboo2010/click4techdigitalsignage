/* Public signage player -- reads a screen's content from Supabase by
 * its slug (?screen=...) and loops it fullscreen, same look and feel
 * as the original local version, just backed by the online database. */

const SUPABASE_URL = "https://ahjinqeknstwucegsotn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoamlucWVrbnN0d3VjZWdzb3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjUwNzgsImV4cCI6MjEwNDUwMTA3OH0.6NfsD4SxR2f3pkBDrAjBTaE2juXrO85kVXHI7ulxdSk";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const POLL_INTERVAL_MS = 30000;
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

function publicMediaUrl(storagePath) {
  const { data } = db.storage.from("media").getPublicUrl(storagePath);
  return data.publicUrl;
}

function showFatal(text) {
  stage.innerHTML = `<div id="stage-error">${text}</div>`;
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
  const { data, error } = await db
    .from("media_items")
    .select("*")
    .eq("screen_id", screenId)
    .order("sort_order", { ascending: true });
  if (error) return [];
  return data;
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
  const url = publicMediaUrl(item.storage_path);
  if (item.type === "image") {
    const frame = document.createElement("div");
    frame.className = "media-frame";
    const bg = document.createElement("img");
    bg.className = "bg"; bg.src = url; bg.alt = "";
    const fg = document.createElement("img");
    fg.className = "fg"; fg.src = url; fg.alt = "";
    frame.appendChild(bg); frame.appendChild(fg);
    stage.appendChild(frame);
    const seconds = item.duration_seconds || (screenRow && screenRow.image_duration) || 8;
    setTimeout(advance, seconds * 1000);
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
    setTimeout(advance, 3000);
  }
}

function advance() {
  if (pendingPlaylist) {
    playlist = pendingPlaylist;
    pendingPlaylist = null;
    currentIndex = 0;
  } else if (playlist.length) {
    currentIndex = (currentIndex + 1) % playlist.length;
  }

  if (!playlist.length) {
    showEmptyState();
    setTimeout(advance, 5000);
    return;
  }
  showItem(playlist[currentIndex]);
}

function showEmptyState() {
  clearStage();
  const div = document.createElement("div");
  div.id = "stage-empty";
  div.textContent = "No videos or images have been added to this screen yet.";
  stage.appendChild(div);
}

async function pollForUpdates() {
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

  playlist = await loadPlaylist(screenRow.id);
  lastTickerText = await loadTickerText(screenRow.id);
  buildTickerTrack(lastTickerText || "Welcome");

  if (playlist.length) {
    showItem(playlist[currentIndex]);
  } else {
    showEmptyState();
  }

  setInterval(pollForUpdates, POLL_INTERVAL_MS);
}

init();
