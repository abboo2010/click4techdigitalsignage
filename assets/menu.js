/* Menu boards -- shared by the player (to show a menu on the screen) and
 * the dashboard (to preview it while editing), so both look identical.
 *
 * A menu is:
 *   { title, template: "dark"|"light"|"bold", accent: "#rrggbb", currency: "RM",
 *     board_type, languages: ["en","bm","zh"], lang_mode: "stack"|"rotate",
 *     categories: [ { name, items: [ { name, price, desc, soldOut,
 *                     name_bm, name_zh, desc_bm, desc_zh, image, badge, was_price } ] } ] }
 *
 * Two ways to draw a menu:
 *   - text menu  : names, dotted line, prices, in columns (used when no item has a photo)
 *   - photo menu : a card per item with its photo, name and price (used when any item has a photo)
 *
 * Languages: "stack" shows every chosen language together (English big, others smaller
 * underneath); "rotate" makes one set of slides per language.
 *
 * Everything is sized in "u" units (about 1% of screen height), so a menu
 * looks the same on any TV. A long menu is split across several slides.
 */

const MENU_TICKER_H = 92;                          // ticker bar height in px (same as player.css)
const MENU_COST = { cat: 10, item: 7, itemDesc: 10.2, alt: 3.2 };  // text menu heights in u (alt = one extra language line)
const PHOTO_COST = { head: 6.5, row: 17.5, gap: 1.8 };             // photo menu heights in u
const MENU_RESERVED = 26;                          // header 18u + top/bottom padding 8u
const MENU_LANG_IDS = ["en", "bm", "zh"];

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

// ---------- languages ----------

// The languages a menu shows, English always included, in a fixed order.
function menuLangList(menu) {
  const chosen = (menu.languages || []).filter(x => MENU_LANG_IDS.indexOf(x) >= 0);
  if (chosen.indexOf("en") < 0) chosen.push("en");
  return MENU_LANG_IDS.filter(x => chosen.indexOf(x) >= 0);
}

function menuRotates(menu) { return menu.lang_mode === "rotate" && menuLangList(menu).length > 1; }

// An item's name / description in one language; English is used when no translation was typed.
function menuItemName(it, lang) { return (lang && lang !== "en" && it["name_" + lang]) || it.name; }
function menuItemDesc(it, lang) { return (lang && lang !== "en" && it["desc_" + lang]) || it.desc; }

// The small lines shown under an item's English name when all languages are shown together.
function menuAltLines(it, menu) {
  if (menuRotates(menu)) return [];
  return menuLangList(menu).filter(l => l !== "en")
    .map(l => [it["name_" + l], it["desc_" + l]].filter(Boolean).join(" — "))
    .filter(Boolean);
}

// ---------- photos ----------

// Public address of an item's photo (a path in the "media" storage bucket).
function menuImageUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return typeof publicMediaUrl === "function" ? publicMediaUrl(path) : "";
}

function menuHasPhotos(menu) {
  return (menu.categories || []).some(c => (c.items || []).some(i => i && i.image));
}

// ---------- sizes ----------

// w = screen width, fullH = screen height (both px)
function menuMetrics(w, fullH) {
  const stageH = fullH - MENU_TICKER_H;
  const portrait = w < fullH;
  const u = portrait ? w * 0.0085 : Math.min(fullH / 100, w * 0.0056);
  const columns = portrait ? 1 : 2;
  const cap = Math.max(25, stageH / u - MENU_RESERVED);   // usable column height in u
  return { u, columns, cap, portrait };
}

function menuItemCost(it, menu) {
  return (it.desc ? MENU_COST.itemDesc : MENU_COST.item) + menuAltLines(it, menu).length * MENU_COST.alt;
}

// Keep only categories that have at least one named item.
function cleanMenuCategories(menu) {
  return (menu.categories || [])
    .map(c => ({
      name: String(c.name || "").trim(),
      items: (c.items || [])
        .map(i => {
          const t = v => String(v == null ? "" : v).trim();
          return {
            name: t(i.name), price: t(i.price), desc: t(i.desc), soldOut: !!i.soldOut,
            name_bm: t(i.name_bm), name_zh: t(i.name_zh), desc_bm: t(i.desc_bm), desc_zh: t(i.desc_zh),
            image: t(i.image), badge: t(i.badge), was_price: t(i.was_price),
          };
        })
        .filter(i => i.name),
    }))
    .filter(c => c.items.length);
}

// ---------- splitting a menu into slides ----------

function layoutMenu(cats, columns, limit, keep, menu) {
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
    const catCost = MENU_COST.cat + cat.items.reduce((s, i) => s + menuItemCost(i, menu), 0);
    if (keep && used > 0 && used + catCost > limit && catCost <= limit) {
      nextColumn();                       // whole category fits in a fresh column: do not split it
    } else if (used > 0 && used + MENU_COST.cat + menuItemCost(cat.items[0], menu) > limit) {
      nextColumn();                       // never leave a heading alone at the bottom of a column
    }
    heading();
    cat.items.forEach(it => {
      if (used + menuItemCost(it, menu) > limit && used > MENU_COST.cat) { nextColumn(); heading(); }
      page.columns[col].push(Object.assign({ kind: "item" }, it));
      used += menuItemCost(it, menu);
    });
  });
  if (page.columns.some(c => c.length)) pages.push(page);
  return pages;
}

function paginateTextMenu(cats, menu, m) {
  // Prefer keeping each category whole in one column; if that needs more
  // slides than splitting a category across columns, split instead.
  let keep = true;
  let pages = layoutMenu(cats, m.columns, m.cap, true, menu);
  const split = layoutMenu(cats, m.columns, m.cap, false, menu);
  if (split.length < pages.length) { pages = split; keep = false; }

  // Balance the columns so a short menu is not all squeezed into the first one.
  const total = cats.reduce((sum, c) =>
    sum + MENU_COST.cat + c.items.reduce((s, i) => s + menuItemCost(i, menu), 0), 0);
  const target = Math.min(m.cap, total / (pages.length * m.columns) + MENU_COST.itemDesc);
  const balanced = layoutMenu(cats, m.columns, target, keep, menu);
  if (balanced.length <= pages.length) pages = balanced;
  return pages;
}

// Photo menu: rows of cards under a category heading. A category that runs onto
// the next slide gets its heading again.
function paginatePhotoMenu(cats, m) {
  const cols = m.columns;
  const rowH = PHOTO_COST.row + PHOTO_COST.gap;
  const pages = [];
  let page = { photo: true, cols, blocks: [] }, used = 0;
  const startPage = () => { if (page.blocks.length) pages.push(page); page = { photo: true, cols, blocks: [] }; used = 0; };

  cats.forEach(cat => {
    if (used > 0 && used + PHOTO_COST.head + rowH > m.cap) startPage();
    page.blocks.push({ kind: "cat", name: cat.name }); used += PHOTO_COST.head;
    for (let i = 0; i < cat.items.length; i += cols) {
      if (used + rowH > m.cap && used > PHOTO_COST.head) {
        startPage();
        page.blocks.push({ kind: "cat", name: cat.name }); used += PHOTO_COST.head;
      }
      page.blocks.push({ kind: "row", items: cat.items.slice(i, i + cols) });
      used += rowH;
    }
  });
  if (page.blocks.length) pages.push(page);

  // A slide with only a few rows would leave a gap at the bottom, so its cards grow a little (up to 30%).
  pages.forEach(p => {
    const heads = p.blocks.filter(b => b.kind === "cat").length * PHOTO_COST.head;
    const nRows = p.blocks.filter(b => b.kind === "row").length;
    p.fill = nRows ? Math.max(1, Math.min(1.3, ((m.cap - heads) / nRows - PHOTO_COST.gap) / PHOTO_COST.row)) : 1;
  });
  return pages;
}

// Split a menu into slides for a screen of w x fullH pixels.
// With "rotate" there is one set of slides per language (page.lang says which).
function paginateMenu(menu, w, fullH) {
  const cats = cleanMenuCategories(menu);
  if (!cats.length) return [];
  const m = menuMetrics(w, fullH);
  const photo = menuHasPhotos({ categories: cats });
  const langs = menuRotates(menu) ? menuLangList(menu) : [null];

  const out = [];
  langs.forEach(lang => {
    const pages = photo ? paginatePhotoMenu(cats, m) : paginateTextMenu(cats, menu, m);
    pages.forEach(p => { p.lang = lang; out.push(p); });
  });
  return out;
}

function menuItemCount(menu) {
  return cleanMenuCategories(menu).reduce((n, c) => n + c.items.length, 0);
}

// ---------- drawing ----------

function menuPhotoCardHtml(it, menu, lang) {
  const name = menuItemName(it, lang);
  const desc = menuItemDesc(it, lang);
  const alts = menuAltLines(it, menu);
  const url = menuImageUrl(it.image);
  const initial = menuEsc((name || "?").trim().charAt(0).toUpperCase());
  const price = it.soldOut ? "SOLD OUT" : formatPrice(it.price, menu.currency);
  const was = (!it.soldOut && it.was_price) ? formatPrice(it.was_price, menu.currency) : "";

  const photo = url
    ? `<div class="p-photo"><img src="${menuEsc(url)}" alt="" onerror="this.parentNode.classList.add('nophoto');this.parentNode.insertAdjacentHTML('afterbegin','<span>${initial}</span>');this.remove()">` +
      `${it.badge ? `<span class="p-badge">${menuEsc(it.badge)}</span>` : ""}</div>`
    : `<div class="p-photo nophoto"><span>${initial}</span>${it.badge ? `<span class="p-badge">${menuEsc(it.badge)}</span>` : ""}</div>`;

  return `<div class="p-card${it.soldOut ? " sold" : ""}">
    ${photo}
    <div class="p-text">
      <div class="p-top">
        <span class="p-name">${menuEsc(name)}</span>
        <span class="p-price">${was ? `<s>${menuEsc(was)}</s>` : ""}<b>${menuEsc(price)}</b></span>
      </div>
      ${alts.map(a => `<div class="p-alt">${menuEsc(a)}</div>`).join("")}
      ${desc ? `<div class="p-desc">${menuEsc(desc)}</div>` : ""}
    </div>
  </div>`;
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
  const lang = page.lang || null;

  let body;
  if (page.photo) {
    root.style.setProperty("--cols", page.cols);
    root.style.setProperty("--fill", page.fill || 1);
    body = `<div class="menu-photos">` + page.blocks.map(b =>
      b.kind === "cat"
        ? `<div class="m-cat">${menuEsc(b.name)}</div>`
        : `<div class="p-row">${b.items.map(it => menuPhotoCardHtml(it, menu, lang)).join("")}</div>`
    ).join("") + `</div>`;
  } else {
    const lineHtml = line => {
      if (line.kind === "cat") return `<div class="m-cat">${menuEsc(line.name)}</div>`;
      const price = line.soldOut ? "SOLD OUT" : formatPrice(line.price, menu.currency);
      const desc = menuItemDesc(line, lang);
      const alts = menuAltLines(line, menu);
      return `<div class="m-item${desc ? " has-desc" : ""}${line.soldOut ? " sold" : ""}" style="height:calc(var(--u) * ${menuItemCost(line, menu)})">
        <div class="m-line">
          <span class="m-name">${menuEsc(menuItemName(line, lang))}</span>
          <span class="m-dots"></span>
          <span class="m-price">${menuEsc(price)}</span>
        </div>
        ${alts.map(a => `<div class="m-alt">${menuEsc(a)}</div>`).join("")}
        ${desc ? `<div class="m-desc">${menuEsc(desc)}</div>` : ""}
      </div>`;
    };
    body = `<div class="menu-cols">
      ${page.columns.map(col => `<div class="menu-col">${col.map(lineHtml).join("")}</div>`).join("")}
    </div>`;
  }

  // Header: just the title, or (when the board has a restaurant name and/or logo) logo + name above the title.
  const brandName = String(menu.restaurant_name || "").trim();
  const logoUrl = menuImageUrl(menu.logo_path);
  const header = (brandName || logoUrl)
    ? `<div class="menu-header has-brand${m.portrait ? " portrait" : ""}">
         ${logoUrl ? `<img class="menu-logo" src="${menuEsc(logoUrl)}" alt="" onerror="this.remove()">` : ""}
         <div class="menu-head-text">
           ${brandName ? `<div class="menu-brand">${menuEsc(brandName)}</div>` : ""}
           <div class="menu-title">${menuEsc(menu.title || "Menu")}</div>
         </div>
       </div>`
    : `<div class="menu-header"><div class="menu-title">${menuEsc(menu.title || "Menu")}</div></div>`;

  root.innerHTML = `
    ${header}
    ${body}
    ${opts.pageCount > 1 ? `<div class="menu-page">${opts.pageNo} / ${opts.pageCount}</div>` : ""}`;
  return root;
}
