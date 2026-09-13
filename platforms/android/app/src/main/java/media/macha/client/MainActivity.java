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
    /** Set only for a loss we expect to end, so an unrelated resume never restarts a film. */
    private boolean pausedByTransientFocusLoss;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        // A film is not idleness. Without this the device runs its ordinary
        // inactivity sequence — dim, screensaver, sleep — through playback,
        // because nobody has touched the remote for ninety minutes.
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
        // The packaged, trusted UI must be able to reach the user's HTTP Macha nodes.
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
        // Some TV vendor builds have no DecorView until content is attached.
        // Defer the insets request rather than making launch depend on it.
        webView.post(this::enterImmersiveMode);
        webView.loadUrl("file:///android_asset/index.html");
        webView.requestFocus();
    }

    /**
     * Hold audio focus for as long as this activity is in front.
     *
     * Requested rather than assumed: an Android TV app that never asks holds
     * nothing, so anything that does ask — a launcher preview, a system sound,
     * a screensaver warming up — takes the audio device and this app is
     * silenced with no event and no way back. The picture carries on, because
     * video is not focus-managed. That is indistinguishable from a decoder
     * fault from the sofa, and it was the leading explanation for sound
     * disappearing a couple of minutes into every title.
     *
     * Focus is per-activity rather than per-generation because there is no
     * bridge to hold it per-generation with: `BridgeContract.kt` is a design
     * stub and nothing in the page can call in. This app is a full-screen
     * leanback media app, so "in front" and "playing" are close enough to the
     * same thing that the difference is not worth a JavaScript interface.
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
     * Yield the audio device when something takes it, and say so on screen.
     *
     * Holding focus and playing over whatever took it is the antisocial half
     * of this feature, and silently losing the sound while the picture runs on
     * is the mystery this is meant to end. Pausing does neither: the viewer
     * sees playback stop, which is a thing they can act on.
     *
     * Reaching into the page's media elements is not how this should be done
     * long-term — playback intent belongs to the coordinator — but there is no
     * bridge to route it through yet, and `onBackPressed` already sets the
     * precedent for talking to the page this way.
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
                // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK: ducking a film for a
                // notification is what ducking is for. Leave it playing.
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
     * Ask the web app whether it wants to handle back itself before falling
     * through to WebView history / finishing the activity. The full player
     * screen uses this to close playback outright instead of letting
     * WebView.goBack() silently pop the hash route while the video keeps
     * playing off-screen (the old, TV-unfriendly "mini player" behavior) —
     * see src/screens/PlayerScreen.tsx's `window.__machaHandleBack`
     * registration.
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
