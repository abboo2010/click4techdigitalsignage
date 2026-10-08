/* Font choices for the ticker and side panel. Shared by the player and the
 * dashboard. "System" fonts work offline; the Google fonts need the screen
 * to be online (they fall back to the default font if not). */
const SIGNAGE_FONTS = [
  { id: "default",    name: "Default (Segoe UI)",  css: '"Segoe UI", Arial, Helvetica, sans-serif' },
  { id: "arial",      name: "Arial",               css: 'Arial, Helvetica, sans-serif' },
  { id: "verdana",    name: "Verdana",             css: 'Verdana, Geneva, sans-serif' },
  { id: "trebuchet",  name: "Trebuchet",           css: '"Trebuchet MS", Helvetica, sans-serif' },
  { id: "georgia",    name: "Georgia (serif)",     css: 'Georgia, "Times New Roman", serif' },
  { id: "courier",    name: "Courier (typewriter)", css: '"Courier New", Courier, monospace' },
  { id: "roboto",     name: "Roboto",              css: '"Roboto", "Segoe UI", Arial, sans-serif', google: true },
  { id: "poppins",    name: "Poppins",             css: '"Poppins", "Segoe UI", Arial, sans-serif', google: true },
  { id: "montserrat", name: "Montserrat",          css: '"Montserrat", "Segoe UI", Arial, sans-serif', google: true },
  { id: "oswald",     name: "Oswald (tall, bold)", css: '"Oswald", Impact, Arial, sans-serif', google: true },
  { id: "lato",       name: "Lato",                css: '"Lato", "Segoe UI", Arial, sans-serif', google: true },
  { id: "playfair",   name: "Playfair Display (elegant)", css: '"Playfair Display", Georgia, serif', google: true },
];

function fontCss(id) {
  const f = SIGNAGE_FONTS.find(x => x.id === id);
  return (f || SIGNAGE_FONTS[0]).css;
}

function validColor(c, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(c || "") ? c : fallback;
}

// Resolve when the font is ready (or after a short wait), so text is measured correctly.
function waitForFont(id) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const css = fontCss(id);
  return Promise.race([
    document.fonts.load("600 30px " + css).catch(() => {}),
    new Promise(r => setTimeout(r, 2500)),
  ]);
}
