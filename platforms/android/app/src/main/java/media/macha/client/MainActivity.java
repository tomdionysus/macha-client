package media.macha.client;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private WebView webView;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    /** Set only on a transient focus loss, so an unrelated resume never restarts playback. */
    private boolean pausedByTransientFocusLoss;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        // Without this the device dims and sleeps during playback: nobody touches the remote.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prepareAudioFocus();

        webView = new WebView(this);
        webView.setBackgroundColor(0xff0e0e0f);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        // The packaged UI must reach the user's plain-HTTP Macha nodes.
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });
        setContentView(webView);
        // Some vendor builds have no DecorView until content is attached, so the insets request is deferred.
        webView.post(this::enterImmersiveMode);
        webView.loadUrl("file:///android_asset/index.html");
        webView.requestFocus();
    }

    /**
     * Hold audio focus while this activity is in front. An app that never
     * requests focus is silenced, with no event, by anything that does, while
     * the picture carries on. Per activity, not per playback: the page has no
     * bridge to call in.
     */
    private void prepareAudioFocus() {
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (audioManager == null) return;
        audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build())
            .setOnAudioFocusChangeListener(this::onAudioFocusChange)
            .build();
    }

    /**
     * Pause the page's media when something else takes audio focus, so the
     * viewer sees playback stop rather than silently losing sound. Done by
     * reaching into the page because there is no bridge to the coordinator.
     */
    private void onAudioFocusChange(int change) {
        if (webView == null) return;
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                pausedByTransientFocusLoss = false;
                setPagePlayback(false);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                pausedByTransientFocusLoss = true;
                setPagePlayback(false);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (!pausedByTransientFocusLoss) break;
                pausedByTransientFocusLoss = false;
                setPagePlayback(true);
                break;
            default:
                // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK: keep playing.
                break;
        }
    }

    private void setPagePlayback(boolean playing) {
        webView.evaluateJavascript(
            "(function(){try{var v=document.getElementsByTagName('video');"
                + "for(var i=0;i<v.length;i++){" + (playing ? "v[i].play();" : "v[i].pause();") + "}"
                + "}catch(e){}})();",
            null
        );
    }

    private void enterImmersiveMode() {
        View decorView = getWindow().getDecorView();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    /**
     * Offer Back to the page first (`window.__machaHandleBack`, registered by
     * PlayerScreen), so the full player closes playback instead of WebView
     * history popping the route while the video plays on.
     */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return !!(window.__machaHandleBack&&window.__machaHandleBack());}catch(e){return false;}})();",
            (String result) -> {
                if ("true".equals(result)) return;
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        );
    }

    @Override
    protected void onPause() {
        if (audioManager != null && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        }
        pausedByTransientFocusLoss = false;
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (audioManager != null && audioFocusRequest != null) {
            audioManager.requestAudioFocus(audioFocusRequest);
        }
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
