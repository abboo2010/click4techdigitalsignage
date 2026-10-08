/* Offline support for the signage player.
 *
 * The player keeps working when the internet drops:
 *   - the player page and its scripts are cached (network first, so updates
 *     still arrive straight away when online)
 *   - the screen's settings, playlist, menus and ticker text are cached
 *   - every image and video of the screen is downloaded and stored on the
 *     device, and served from there (including video seeking)
 *
 * Only the player is affected. The dashboard and admin pages are left alone.
 */

const VERSION = "v1";
const SHELL = "signage-shell-" + VERSION;
const DATA = "signage-data-" + VERSION;
const MEDIA = "signage-media-" + VERSION;
const META = "signage-meta-" + VERSION;

// The public (anon) key the player uses. Requests carrying anything else
// (for example a logged-in dashboard user) are never cached.
const ANON_BEARER = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoamlucWVrbnN0d3VjZWdzb3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjUwNzgsImV4cCI6MjEwNDUwMTA3OH0.6NfsD4SxR2f3pkBDrAjBTaE2juXrO85kVXHI7ulxdSk";

const SHELL_FILES = [
  "player.html", "assets/player.js", "assets/player.css", "assets/menu.js",
  "assets/menu.css", "assets/schedule.js", "assets/fonts.js", "assets/vendor/supabase.js",
];
// Must match the Google Fonts link in player.html exactly.
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Montserrat:wght@400;600;700&family=Oswald:wght@400;600;700&family=Playfair+Display:wght@400;600;700&family=Poppins:wght@400;600;700&family=Roboto:wght@400;600;700&display=swap";
const NETWORK_WAIT_MS = 4000;   // on a flaky connection, fall back to the saved copy after this long

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    for (const f of SHELL_FILES) {
      try { await cache.add(new URL(f, self.registration.scope).href); } catch (e) { /* cached on first use instead */ }
    }
    try { await cache.add(FONTS_CSS); } catch (e) { /* optional */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [SHELL, DATA, MEDIA, META];
    for (const name of await caches.keys()) {
      if (name.startsWith("signage-") && !keep.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// ---------- helpers ----------

async function networkFirst(request, cacheName, key, waitMs) {
  const cache = await caches.open(cacheName);
  const net = fetch(request).then(res => {
    if (res && (res.ok || res.type === "opaque") && !res.redirected) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  net.catch(() => {});
  try {
    const cached = await cache.match(key, { ignoreVary: true });
    if (!cached) return await net;
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), waitMs))]);
  } catch (e) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return cached;
    throw e;
  }
}

// Serve a stored file, honouring Range requests so videos can start and seek.
async function rangeResponse(request, cached) {
  const range = request.headers.get("range");
  if (!range) return cached;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m || (m[1] === "" && m[2] === "")) return cached;
  const blob = await cached.blob();
  const size = blob.size;
  const start = m[1] === "" ? Math.max(0, size - parseInt(m[2], 10)) : parseInt(m[1], 10);
  const end = (m[1] === "" || m[2] === "") ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
      "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Accept-Ranges": "bytes",
    },
  });
}

const inflight = new Map();
function cacheMedia(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    const cache = await caches.open(MEDIA);
    if (await cache.match(url)) return;
    const res = await fetch(url, { mode: "cors" });
    if (res.ok && res.status === 200) await cache.put(url, res);
  })().catch(() => {}).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

function isSupabase(url) { return url.hostname.endsWith(".supabase.co"); }
function isMediaUrl(url) { return isSupabase(url) && url.pathname.indexOf("/storage/v1/object/public/") === 0; }

// ---------- requests ----------

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // The player page and its scripts.
  if (url.origin === self.location.origin) {
    const rel = url.pathname.replace(/^\//, "");
    if (SHELL_FILES.includes(rel)) {
      const key = new URL(rel, self.registration.scope).href;   // ignore ?screen=... in the cache key
      event.respondWith(networkFirst(request, SHELL, key, NETWORK_WAIT_MS));
    }
    return;
  }

  // Google Fonts used by the ticker and side panel.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(networkFirst(request, SHELL, request.url, NETWORK_WAIT_MS));
    return;
  }

  // The screen's data (settings, playlist, menus, ticker).
  if (isSupabase(url) && url.pathname.indexOf("/rest/v1/") === 0) {
    if (request.headers.get("Authorization") === ANON_BEARER) {
      event.respondWith(networkFirst(request, DATA, request.url, NETWORK_WAIT_MS));
    }
    return;
  }

  // The screen's images and videos: serve the stored copy, download if missing.
  if (isMediaUrl(url)) {
    event.respondWith((async () => {
      const client = event.clientId ? await self.clients.get(event.clientId) : null;
      const fromPlayer = client && /\/player\.html/.test(client.url);
      if (!fromPlayer) return fetch(request);
      const cache = await caches.open(MEDIA);
      const cached = await cache.match(request.url);
      if (cached) return rangeResponse(request, cached);
      event.waitUntil(cacheMedia(request.url));
      return fetch(request);
    })());
  }
});

// ---------- messages from the player ----------
// { type: "sync", slug, urls }: keep exactly these files for this screen,
// download any that are missing, and drop files no screen needs any more.

self.addEventListener("message", event => {
  const d = event.data || {};
  if (d.type === "sync" && Array.isArray(d.urls)) event.waitUntil(syncMedia(d.slug || "default", d.urls));
});

async function syncMedia(slug, urls) {
  const wanted = urls.map(u => new URL(u).href);
  const meta = await caches.open(META);
  await meta.put("/__keep/" + encodeURIComponent(slug), new Response(JSON.stringify(wanted)));

  // Everything any screen on this device still needs.
  const keep = new Set();
  for (const req of await meta.keys()) {
    const res = await meta.match(req);
    try { JSON.parse(await res.text()).forEach(u => keep.add(u)); } catch (e) { /* ignore */ }
  }
  const cache = await caches.open(MEDIA);
  for (const req of await cache.keys()) {
    if (!keep.has(req.url)) await cache.delete(req);
  }
  for (const u of wanted) await cacheMedia(u);
}
