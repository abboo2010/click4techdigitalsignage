# IR@Sabah Kiosk (Windows wrapper)

Fullscreen Windows kiosk app for the touch-screen version of
**https://drchandranir.info/kiosk** (Dr. Chandran Nadarajan, Click 4 Tech Solutions PLT).

Electron app: opens the kiosk fullscreen (no taskbar, no title bar, no browser
banner), with a hidden exit.

## Behaviour
- Opens fullscreen automatically on launch.
- **Exit:** tap the bottom-left corner once -> password box (with its own
  on-screen keyboard for touch-only screens) -> correct password closes the app.
  5 wrong tries lock the box for 30 s. `Ctrl+Alt+X` opens the same box from a keyboard.
- The site itself returns to its splash after 90 s without touches, so there is no separate screensaver.
- If the site can't be reached it shows "Connecting..." and retries every 10 s.
- Overlay windows use inline `data:` URLs (not `loadFile`) on purpose: loading local
  .html out of `app.asar` rendered raw source on the original PC.

## Settings: `kiosk-config.json` (next to the installed .exe, edit with Notepad)
| key | meaning |
|---|---|
| `url` | page to load, default `https://drchandranir.info/kiosk` |
| `exitPassword` | password for the hidden exit. **The value in this repo is a placeholder - set a real one before building.** |
| `debugShowHotspot` | `true` draws a red box around the hidden tap area |

A `kiosk-debug.log` is written next to the config (start-up, hotspot taps, password
attempts - never the password itself).

## Build the installer
Needs Node 20+. On Windows:

    npm install
    npm run dist

Output: `dist/IR-Sabah-Kiosk-Setup.exe` (one-click installer, desktop shortcut, runs after install).
Building on Linux additionally needs `wine` and `wine32:i386` (to embed the icon).
The installer is ~80 MB: do not commit it (see `.gitignore`).

Set `exitPassword` in `kiosk-config.json` **and** the `DEFAULTS` line in `app/main.js`
before building; the config file is copied next to the exe by the installer.

## Companion page code
The kiosk page (in the `drchandrannadarajan` repo) detects this app by its `Electron/`
user agent and keeps the bottom-left 90 px corner free of menu buttons for the hidden exit area.
