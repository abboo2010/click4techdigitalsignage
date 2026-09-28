// Shared Supabase client + small helpers used by index.html, admin.html, dashboard.html.

const SUPABASE_URL = "https://ahjinqeknstwucegsotn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoamlucWVrbnN0d3VjZWdzb3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MjUwNzgsImV4cCI6MjEwNDUwMTA3OH0.6NfsD4SxR2f3pkBDrAjBTaE2juXrO85kVXHI7ulxdSk";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function slugify(text) {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    || "item";
}

async function requireSession() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

async function getMyProfile() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data, error } = await db
    .from("profiles")
    .select("id, org_id, role, full_name")
    .eq("id", user.id)
    .single();
  if (error) {
    console.error("Failed to load profile", error);
    return null;
  }
  return data;
}

async function logout() {
  await db.auth.signOut();
  window.location.href = "index.html";
}

function publicMediaUrl(storagePath) {
  const { data } = db.storage.from("media").getPublicUrl(storagePath);
  return data.publicUrl;
}

function showMessage(el, text, isError) {
  el.textContent = text;
  el.style.display = text ? "block" : "none";
  el.className = "msg " + (isError ? "msg-error" : "msg-ok");
}
