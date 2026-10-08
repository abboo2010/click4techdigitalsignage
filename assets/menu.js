/* Menu boards -- shared by the player (to show a menu on the screen) and
 * the dashboard (to preview it while editing), so both look identical.
 *
 * A menu is:
 *   { title, template: "dark"|"light"|"bold", accent: "#rrggbb", currency: "RM",
 *     categories: [ { name, items: [ { name, price, desc, soldOut } ] } ] }
 *
 * Everything is sized in "u" units (about 1% of screen height), so a menu
 * looks the same on any TV. A long menu is split across several slides.
 */

const MENU_TICKER_H = 92;                          // ticker bar height in px (same as player.css)
const MENU_COST = { cat: 10, item: 7, itemDesc: 10.2 };  // heights in u
const MENU_RESERVED = 26;                          // header 18u + top/bottom padding 8u

function menuEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "12.5" -> "RM 12.50"; free text such as "S 8 / L 10" is shown as typed.
function formatPrice(price, currency) {
  const p = String(price == null ? "" : price).trim();
  if (!p) return "";
  if (/^\d+(\.\d{1,2})?$/.test(p)) return (currency ? currency + " " : "") + Number(p).toFixed(2);
  return p;
}

// Mix a #rrggbb colour towards white by `amount` (0..1).
function menuLighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// w = screen width, fullH = screen height (both px)
function menuMetrics(w, fullH) {
  const stageH = fullH - MENU_TICKER_H;
  const portrait = w < fullH;
  const u = portrait ? w * 0.0085 : Math.min(fullH / 100, w * 0.0056);
  const columns = portrait ? 1 : 2;
  const cap = Math.max(25, stageH / u - MENU_RESERVED);   // usable column height in u
  return { u, columns, cap };
}

function menuItemCost(it) { return it.desc ? MENU_COST.itemDesc : MENU_COST.item; }

// Keep only categories that have at least one named item.
function cleanMenuCategories(menu) {
  return (menu.categories || [])
    .map(c => ({
      name: String(c.name || "").trim(),
      items: (c.items || [])
        .map(i => ({
          name: String(i.name || "").trim(),
          price: String(i.price == null ? "" : i.price).trim(),
          desc: String(i.desc || "").trim(),
          soldOut: !!i.soldOut,
        }))
        .filter(i => i.name),
    }))
    .filter(c => c.items.length);
}

function layoutMenu(cats, columns, limit) {
  const pages = [];
  const blank = () => ({ columns: Array.from({ length: columns }, () => []) });
  let page = blank(), col = 0, used = 0;

  const nextColumn = () => {
    if (col + 1 < columns) col++;
    else { pages.push(page); page = blank(); col = 0; }
    used = 0;
  };

  cats.forEach(cat => {
    const heading = () => { page.columns[col].push({ kind: "cat", name: cat.name }); used += MENU_COST.cat; };
    const catCost = MENU_COST.cat + cat.items.reduce((s, i) => s + menuItemCost(i), 0);
    if (used > 0 && used + catCost > limit && catCost <= limit) {
      nextColumn();                       // whole category fits in a fresh column: do not split it
    } else if (used > 0 && used + MENU_COST.cat + menuItemCost(cat.items[0]) > limit) {
      nextColumn();                       // never leave a heading alone at the bottom of a column
    }
    heading();
    cat.items.forEach(it => {
      if (used + menuItemCost(it) > limit && used > MENU_COST.cat) { nextColumn(); heading(); }
      page.columns[col].push(Object.assign({ kind: "item" }, it));
      used += menuItemCost(it);
    });
  });
  if (page.columns.some(c => c.length)) pages.push(page);
  return pages;
}

// Split a menu into slides for a screen of w x fullH pixels.
function paginateMenu(menu, w, fullH) {
  const cats = cleanMenuCategories(menu);
  if (!cats.length) return [];
  const m = menuMetrics(w, fullH);

  let pages = layoutMenu(cats, m.columns, m.cap);

  // Balance the columns so a short menu is not all squeezed into the first one.
  const total = cats.reduce((sum, c) =>
    sum + MENU_COST.cat + c.items.reduce((s, i) => s + menuItemCost(i), 0), 0);
  const target = Math.min(m.cap, total / (pages.length * m.columns) + MENU_COST.itemDesc);
  const balanced = layoutMenu(cats, m.columns, target);
  if (balanced.length <= pages.length) pages = balanced;
  return pages;
}

function menuItemCount(menu) {
  return cleanMenuCategories(menu).reduce((n, c) => n + c.items.length, 0);
}

// Build the DOM for one slide. opts: { w, fullH, pageNo, pageCount }
function buildMenuPageEl(page, menu, opts) {
  const m = menuMetrics(opts.w, opts.fullH);
  const root = document.createElement("div");
  root.className = "menu menu-" + (["dark", "light", "bold"].indexOf(menu.template) >= 0 ? menu.template : "dark");
  root.style.setProperty("--u", m.u + "px");
  const accent = /^#[0-9a-fA-F]{6}$/.test(menu.accent || "") ? menu.accent : "#8b1e1e";
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-text", menuLighten(accent, 0.5));   // readable on dark backgrounds

  const lineHtml = line => {
    if (line.kind === "cat") return `<div class="m-cat">${menuEsc(line.name)}</div>`;
    const price = line.soldOut ? "SOLD OUT" : formatPrice(line.price, menu.currency);
    return `<div class="m-item${line.desc ? " has-desc" : ""}${line.soldOut ? " sold" : ""}">
      <div class="m-line">
        <span class="m-name">${menuEsc(line.name)}</span>
        <span class="m-dots"></span>
        <span class="m-price">${menuEsc(price)}</span>
      </div>
      ${line.desc ? `<div class="m-desc">${menuEsc(line.desc)}</div>` : ""}
    </div>`;
  };

  root.innerHTML = `
    <div class="menu-header"><div class="menu-title">${menuEsc(menu.title || "Menu")}</div></div>
    <div class="menu-cols">
      ${page.columns.map(col => `<div class="menu-col">${col.map(lineHtml).join("")}</div>`).join("")}
    </div>
    ${opts.pageCount > 1 ? `<div class="menu-page">${opts.pageNo} / ${opts.pageCount}</div>` : ""}`;
  return root;
}
