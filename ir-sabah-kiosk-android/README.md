# IR@SABAH Kiosk (Android)

Fullscreen WebView app for https://drchandranir.info/kiosk. Hides the status bar and the
3-button navigation bar (immersive mode), Back is disabled.

**Exit:** tap the invisible bottom-left corner, enter the password. The password is stored only as a
salted SHA-256 hash in `MainActivity.java` (`EXIT_HASH`, salt `irsabah-kiosk-exit:`).

Built by GitHub Actions to `downloads/ir-sabah-kiosk.apk`.
