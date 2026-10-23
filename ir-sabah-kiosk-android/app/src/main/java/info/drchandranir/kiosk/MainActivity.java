package info.drchandranir.kiosk;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * IR@Sabah Kiosk (Android). Shows https://drchandranir.info/kiosk fullscreen with the
 * status bar and navigation bar hidden (immersive mode), so the tablet looks like a
 * dedicated kiosk.
 *
 * Hidden exit: tap the bottom-left corner once -> password box -> correct password closes the app.
 * The password is stored only as a salted SHA-256 hash.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "https://drchandranir.info/kiosk";
    private static final String ALLOWED_HOST = "drchandranir.info";
    private static final String SALT = "irsabah-kiosk-exit:";
    private static final String EXIT_HASH = "baa618975c1f1e75d61ee792b91f98173c7a2413aadb324c58dd2ba6acb46a8f";
    private static final int HOTSPOT_DP = 90;          // matches the corner the page keeps free of menu buttons
    private static final long RETRY_MS = 10000;
    private static final long REHIDE_MS = 2500;
    private static final long DIALOG_TIMEOUT_MS = 30000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View hotspot;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private AlertDialog dialog;
    private int failCount = 0;
    private long lockedUntil = 0;

    private final Runnable retryLoad = new Runnable() {
        @Override public void run() { if (web != null) web.loadUrl(START_URL); }
    };
    private final Runnable closeDialog = new Runnable() {
        @Override public void run() { if (dialog != null && dialog.isShowing()) dialog.dismiss(); }
    };
    private final Runnable rehide = new Runnable() {
        @Override public void run() {
            if (dialog == null || !dialog.isShowing()) hideSystemUi();
            handler.postDelayed(this, REHIDE_MS);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0a2647"));
        setContentView(root);
        buildWebView();
        addHotspot();
        hideSystemUi();
        web.loadUrl(START_URL);
    }

    // ---------------- web view ----------------

    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0a2647"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { return true; }
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // lets the page know it runs inside the kiosk app (it then keeps the exit corner free)
        s.setUserAgentString(s.getUserAgentString() + " IRSabahKiosk/1");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return !isAllowed(request.getUrl().getScheme(), request.getUrl().getHost());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                android.net.Uri u = android.net.Uri.parse(url);
                return !isAllowed(u.getScheme(), u.getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("https://" + ALLOWED_HOST)) handler.removeCallbacks(retryLoad);
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith("https://" + ALLOWED_HOST)) showOffline();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                handler.post(new Runnable() { @Override public void run() { recreate(); } });
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                if (hotspot != null) hotspot.bringToFront();
            }

            @Override
            public void onHideCustomView() { hideCustomView(); }

            @Override
            public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private boolean isAllowed(String scheme, String host) {
        if (scheme == null) return false;
        if (scheme.equals("about") || scheme.equals("data")) return true;
        if (!scheme.equals("https")) return false;
        return host != null && (host.equals(ALLOWED_HOST) || host.endsWith("." + ALLOWED_HOST));
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customCallback != null) { customCallback.onCustomViewHidden(); customCallback = null; }
    }

    private void showOffline() {
        String html = "<html><body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
                + "background:#0a2647;color:#fff;font-family:sans-serif;text-align:center'>"
                + "<div><div style='font-size:42px;font-weight:700;color:#e2bc6c'>IR@SABAH</div>"
                + "<div style='margin-top:14px;font-size:22px;color:#9fb0c8'>Connecting&hellip;</div></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        handler.removeCallbacks(retryLoad);
        handler.postDelayed(retryLoad, RETRY_MS);
    }

    // ---------------- immersive fullscreen ----------------

    private void hideSystemUi() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemUi();
        handler.removeCallbacks(rehide);
        handler.postDelayed(rehide, REHIDE_MS);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(rehide);
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (customView != null) hideCustomView();
        // otherwise ignored: visitors cannot leave the kiosk with Back
    }

    // ---------------- hidden exit ----------------

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density + 0.5f); }

    private void addHotspot() {
        hotspot = new View(this);
        hotspot.setBackgroundColor(Color.TRANSPARENT);
        hotspot.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showExitDialog(); }
        });
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(HOTSPOT_DP), dp(HOTSPOT_DP),
                Gravity.BOTTOM | Gravity.START);
        root.addView(hotspot, lp);
    }

    private void showExitDialog() {
        if (dialog != null && dialog.isShowing()) return;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setSingleLine(true);
        input.setHint("Password");
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);

        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(dp(24), dp(8), dp(24), 0);
        wrap.addView(input, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        dialog = new AlertDialog.Builder(this)
                .setTitle("Exit kiosk")
                .setMessage("Enter the exit password to close the app.")
                .setView(wrap)
                .setPositiveButton("Exit", null)      // set below so a wrong password keeps the box open
                .setNegativeButton("Cancel", null)
                .create();
        dialog.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
            @Override public void onDismiss(android.content.DialogInterface d) {
                handler.removeCallbacks(closeDialog);
                hideSystemUi();
            }
        });
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { tryExit(input); }
        });
        input.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener() {
            @Override public boolean onEditorAction(android.widget.TextView tv, int actionId, android.view.KeyEvent ev) {
                tryExit(input);
                return true;
            }
        });
        input.requestFocus();
        handler.removeCallbacks(closeDialog);
        handler.postDelayed(closeDialog, DIALOG_TIMEOUT_MS);   // never leave the box sitting open
    }

    private void tryExit(EditText input) {
        long now = System.currentTimeMillis();
        if (now < lockedUntil) {
            input.setError("Too many attempts. Try again in " + ((lockedUntil - now) / 1000 + 1) + "s.");
            return;
        }
        String typed = input.getText().toString();
        if (matches(typed)) {
            failCount = 0;
            if (dialog != null) dialog.dismiss();
            exitApp();
        } else {
            failCount++;
            if (failCount >= 5) {
                failCount = 0;
                lockedUntil = System.currentTimeMillis() + 30000;
                input.setError("Too many attempts. Locked for 30s.");
            } else {
                input.setError("Wrong password.");
            }
            input.setText("");
            handler.removeCallbacks(closeDialog);
            handler.postDelayed(closeDialog, DIALOG_TIMEOUT_MS);
        }
    }

    private boolean matches(String typed) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest((SALT + typed).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : d) sb.append(String.format("%02x", x));
            return MessageDigest.isEqual(sb.toString().getBytes(StandardCharsets.UTF_8),
                    EXIT_HASH.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }

    private void exitApp() {
        try { stopLockTask(); } catch (Exception ignored) { }
        finishAndRemoveTask();
        handler.postDelayed(new Runnable() {
            @Override public void run() { android.os.Process.killProcess(android.os.Process.myPid()); }
        }, 400);
    }
}
