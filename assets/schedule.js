/* Shared schedule logic, used by the player (to decide what plays now)
 * and by the dashboard (to describe a schedule in plain words).
 *
 * A media item may carry these optional fields (all empty = plays always):
 *   schedule_days        array of 0-6 (0 = Sunday ... 6 = Saturday)
 *   schedule_start/end   "HH:MM:SS" daily window (both or neither)
 *   schedule_start_date  "YYYY-MM-DD" first day it may play
 *   schedule_end_date    "YYYY-MM-DD" last day it may play
 *
 * All times are Malaysia time (Asia/Kuala_Lumpur), whatever the clock on the
 * TV / display PC says.
 */

const SCHEDULE_TZ = "Asia/Kuala_Lumpur";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function malaysiaNow(now) {
  now = now || new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const p = {};
  parts.forEach(x => { p[x.type] = x.value; });
  return {
    date: p.year + "-" + p.month + "-" + p.day,
    minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10),
    day: DAY_NAMES.indexOf(p.weekday),
  };
}

function timeToMinutes(t) {
  const parts = String(t).split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function hasSchedule(item) {
  return !!(
    (Array.isArray(item.schedule_days) && item.schedule_days.length && item.schedule_days.length < 7) ||
    (item.schedule_start && item.schedule_end) ||
    item.schedule_start_date || item.schedule_end_date
  );
}

function isScheduledNow(item, now) {
  const n = malaysiaNow(now);
  if (item.schedule_start_date && n.date < item.schedule_start_date) return false;
  if (item.schedule_end_date && n.date > item.schedule_end_date) return false;

  const days = item.schedule_days;
  if (Array.isArray(days) && days.length && days.length < 7 && days.indexOf(n.day) === -1) return false;

  if (item.schedule_start && item.schedule_end) {
    const s = timeToMinutes(item.schedule_start);
    const e = timeToMinutes(item.schedule_end);
    if (s < e) return n.minutes >= s && n.minutes < e;
    if (s > e) return n.minutes >= s || n.minutes < e; // runs past midnight
    // start == end: treated as all day
  }
  return true;
}

// Whole-screen operating hours. Uses the same rules as an item schedule.
// Returns true when the screen should be showing content right now.
function isWithinHours(screen, now) {
  if (!screen || !screen.hours_enabled) return true;
  return isScheduledNow({
    schedule_days: screen.hours_days,
    schedule_start: screen.hours_start,
    schedule_end: screen.hours_end,
  }, now);
}

function hoursSummary(screen) {
  if (!screen || !screen.hours_enabled) return "Always on";
  return scheduleSummary({
    schedule_days: screen.hours_days,
    schedule_start: screen.hours_start,
    schedule_end: screen.hours_end,
  });
}

// "08:30:00" -> "8:30 AM"
function formatTime12(t) {
  const total = timeToMinutes(t);
  let h = Math.floor(total / 60);
  const m = total % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ap;
}

function formatDateShort(d) {
  const parts = d.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return parseInt(parts[2], 10) + " " + months[parseInt(parts[1], 10) - 1] + " " + parts[0];
}

function scheduleSummary(item) {
  if (!hasSchedule(item)) return "Always";
  const bits = [];

  const days = (item.schedule_days || []).slice().sort();
  if (days.length && days.length < 7) {
    const key = days.join(",");
    if (key === "1,2,3,4,5") bits.push("Mon–Fri");
    else if (key === "0,6") bits.push("Weekends");
    else bits.push(days.map(d => DAY_NAMES[d]).join(", "));
  } else {
    bits.push("Every day");
  }

  if (item.schedule_start && item.schedule_end &&
      timeToMinutes(item.schedule_start) !== timeToMinutes(item.schedule_end)) {
    bits.push(formatTime12(item.schedule_start) + " – " + formatTime12(item.schedule_end));
  } else {
    bits.push("All day");
  }

  if (item.schedule_start_date && item.schedule_end_date) {
    bits.push(formatDateShort(item.schedule_start_date) + " – " + formatDateShort(item.schedule_end_date));
  } else if (item.schedule_start_date) {
    bits.push("From " + formatDateShort(item.schedule_start_date));
  } else if (item.schedule_end_date) {
    bits.push("Until " + formatDateShort(item.schedule_end_date));
  }

  return bits.join(" · ");
}
