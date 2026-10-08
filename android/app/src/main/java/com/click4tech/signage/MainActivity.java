package com.click4tech.signage;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen signage player. Shows the screen's player page in a WebView.
 * The screen link is entered once; press Back 5 times quickly to change it.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "signage";
    private static final String KEY_URL = "url";
    private static final String BASE = "https://digitalsignage.click4techsolutions.com/player.html?screen=";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private FrameLayout root;
    private int backPresses = 0;
    private long firstBackAt = 0;
    private final Runnable retry = new Runnable() {
        @Override public void run() { if (web != null) web.reload(); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        go();
    }

    private String savedUrl() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_URL, null);
    }

    private void go() {
        String url = savedUrl();
        if (url == null) showSetup(); else showPlayer(url);
    }

    // ---------- setup screen ----------

    private void showSetup() {
        releaseWeb();
        root.removeAllViews();
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(60, 40, 60, 40);

        TextView title = new TextView(this);
        title.setText("Click4Tech Digital Signage");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Type the screen link from your dashboard\n(or just the screen code, for example reception-ab12)");
        hint.setTextColor(Color.LTGRAY);
        hint.setTextSize(16);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, 20, 0, 20);
        box.addView(hint);

        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        input.setHint("https://digitalsignage.click4techsolutions.com/player.html?screen=...");
        String old = savedUrl();
        if (old != null) input.setText(old);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final TextView error = new TextView(this);
        error.setTextColor(Color.parseColor("#ff8a80"));
        error.setGravity(Gravity.CENTER);
        error.setPadding(0, 10, 0, 10);
        box.addView(error);

        Button start = new Button(this);
        start.setText("Start screen");
        start.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String url = normalise(input.getText().toString());
                if (url == null) { error.setText("That does not look like a screen link or code."); return; }
                getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
                go();
            }
        });
        box.addView(start);

        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            Button allow = new Button(this);
            allow.setText("Allow auto-start when the device turns on");
            allow.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                    } catch (Exception ignored) {}
                }
            });
            box.addView(allow);
        }

        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        input.requestFocus();
    }

    /** Accepts a full player link or just the screen code. */
    static String normalise(String text) {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) return null;
        if (t.startsWith("http://") || t.startsWith("https://")) {
            return t.contains("player.html") && t.contains("screen=") ? t : null;
        }
        if (t.matches("[A-Za-z0-9_-]+")) return BASE + t;
        return null;
    }

    // ---------- player ----------

    private void showPlayer(String url) {
        releaseWeb();
        root.removeAllViews();
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    // No internet right now: try again in 10 seconds.
                    handler.removeCallbacks(retry);
                    handler.postDelayed(retry, 10000);
                }
            }
            @Override public void onPageFinished(WebView v, String u) { handler.removeCallbacks(retry); }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // The web engine crashed or was stopped: start the screen again.
                handler.post(new Runnable() { @Override public void run() { go(); } });
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(url);
        web.requestFocus();
    }

    private void releaseWeb() {
        handler.removeCallbacks(retry);
        if (web != null) {
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
    }

    // ---------- window / keys ----------

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideBars();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        releaseWeb();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - firstBackAt > 4000) { firstBackAt = now; backPresses = 0; }
        backPresses++;
        if (backPresses >= 5) {
            backPresses = 0;
            showSetup();
        }
        // Otherwise ignore Back so the screen cannot be closed by accident.
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { showSetup(); return true; }
        return super.onKeyDown(keyCode, event);
    }
}
