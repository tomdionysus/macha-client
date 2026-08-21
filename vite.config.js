var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import packageInfo from './package.json';
import { loadEnv } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
var samsungCssVariables = {
    surface: '#171719',
    'surface-2': '#222226',
    'surface-3': '#2a2a2e',
    'text-dim': '#aaaab2',
    'text-faint': '#77777f',
    'red-950': '#020000',
    'red-900': '#050001',
    'red-800': '#0b0002',
    'red-700': '#130003',
    'red-600': '#1e0005',
    'red-500': '#2c0008',
    'red-400': '#42000d',
    focus: '#4b000f',
    accent: '#2c0008',
    'accent-surface': '#130003a8',
    'accent-surface-strong': '#260007c2',
    'accent-focus-wash': '#39000b24',
    'accent-glow': '#62001428',
    'glass-blur': 'blur(10px) saturate(118%)',
};
var samsungLegacyLayout = "\n/* Generated only for the Tizen 3.0 / Chromium 47 Samsung build. */\nhtml, body, #root { width: 100%; height: 100%; min-height: 100%; margin: 0; }\nbody { min-width: 0; background: #0e0e0f; color: #e2e2e5; }\n.app-shell { position: relative; width: 100%; min-height: 100%; }\n.app-shell > main { position: relative; z-index: 1; }\n.app-watermark { position: fixed; left: 50%; top: 53%; width: 430px; height: 430px; margin-left: -215px; margin-top: -215px; }\n.splash { position: fixed; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; }\n\n.topbar { position: relative; top: auto; display: flex; align-items: center; min-height: 68px; padding: 10px 58px; }\n.brand-link { display: flex; align-items: center; flex: 0 0 auto; margin-right: 28px; }\n.brand-link .app-logo { margin-right: 9px; }\n.topbar nav { display: flex; flex: 1 1 auto; justify-content: center; }\n.topbar nav a { display: block; margin: 0 4px; }\n.platform-badge { flex: 0 0 150px; margin-left: 28px; text-align: right; }\nmain { padding: 16px 58px 64px; }\nh1 { font-size: 48px; }\nh2 { font-size: 24px; }\n\n.media-row { display: flex; flex-wrap: nowrap; }\n.media-row > .media-card, .media-row > .continue-card { margin-right: 16px; }\n.media-grid { display: flex; flex-wrap: wrap; }\n.media-grid > .media-card { width: 190px; flex: 0 0 190px; margin: 0 16px 24px 0; }\n.media-card { width: 190px; flex: 0 0 190px; }\n.poster { width: 100%; height: 285px; }\n.music-artwork, .media-card-album .poster, .media-card-artist .poster, .media-card-track .poster { height: 190px; }\n.card-overflow-menu { height: 285px; }\n.media-card-album .card-overflow-menu, .media-card-artist .card-overflow-menu, .media-card-track .card-overflow-menu { height: 190px; }\n.continue-card-context { display: block; }\n.continue-card-context-link { width: auto; }\n\n.alphabet-index { top: 78px; right: 12px; bottom: 12px; }\n.alphabet-index-button { font-size: 11px; }\n\n.poster-placeholder, .movie-detail-poster-placeholder, .episode-still-placeholder,\n.loading-overlay, .audio-player-placeholder, .player-fatal-error, .overflow-menu-trigger,\n.episode-play-action, .player-button-row button, .media-control-button, .player-mini-controls button,\n.status-screen { display: flex; align-items: center; justify-content: center; }\n\n.movie-detail-layout { display: flex; align-items: flex-start; margin-top: 12px; }\n.movie-detail-poster { width: 300px; height: 450px; flex: 0 0 300px; margin-right: 42px; }\n.movie-detail-copy { flex: 1 1 auto; min-width: 0; }\n.episode-rail > * { margin-right: 18px; }\n.episode-rail-item { flex: 0 0 480px; }\n.episode-still { height: 270px; }\n.episode-still-placeholder { height: 270px; }\n.episode-heading { display: flex; }\n\n.album-header { display: flex; align-items: flex-end; }\n.album-cover { width: 280px; height: 280px; flex: 0 0 280px; margin-right: 42px; }\n.track-list { display: block; }\n.music-subnav, .playlist-heading-row, .playlist-actions { display: flex; }\n.track-row, .track-row-open { display: flex; align-items: center; }\n.track-row-open { flex: 1 1 auto; }\n.track-number, .track-action { width: 48px; flex: 0 0 48px; }\n.track-title, .track-copy { flex: 1 1 auto; }\n.playlist-track-row { display: flex; align-items: center; }\n.playlist-drag-handle, .playlist-remove, .playlist-track-number { flex: 0 0 auto; }\n.playlist-artwork { width: 50px; height: 50px; flex: 0 0 50px; margin: 0 10px; }\n.playlist-track-copy { flex: 1 1 auto; min-width: 0; }\n.player-volume-control { display: flex; align-items: center; }\n\n.settings { width: 900px; max-width: 100%; }\n.settings-line { display: flex; }\n.settings-line > * { margin-right: 10px; }\n.settings-hero { display: flex; align-items: center; padding: 28px; }\n.settings-logo { width: 138px; height: 138px; flex: 0 0 138px; margin-right: 32px; }\n.settings-brand-copy { flex: 1 1 auto; }\n.settings-status-grid { display: flex; }\n.settings-status-card { flex: 1 1 0; margin-right: 16px; }\n.settings-status-card dl { display: block; }\n.settings-status-card dl > div { display: flex; justify-content: space-between; }\n\n.ingest-header { display: flex; align-items: flex-end; justify-content: space-between; }\n.ingest-header > div:first-child { flex: 1 1 auto; }\n.ingest-staging-summary { width: 360px; flex: 0 0 360px; margin-left: 24px; }\n.ingest-submit-grid { display: flex; }\n.ingest-submit-card { flex: 1 1 0; margin-right: 16px; }\n.ingest-submit-card:last-child { margin-right: 0; }\n.ingest-submit-line { display: flex; }\n.ingest-submit-line input { flex: 1 1 auto; margin-right: 10px; }\n.ingest-submit-line button { flex: 0 0 auto; }\n.ingest-job-heading { display: flex; justify-content: space-between; }\n.ingest-job-stats { display: flex; flex-wrap: wrap; }\n.ingest-job-stats > div { width: 16.66%; flex: 0 0 16.66%; padding-right: 12px; }\n.ingest-job-stats-import > div { width: 33.33%; flex-basis: 33.33%; }\n.ingest-job-actions { display: flex; justify-content: flex-end; }\n.ingest-job-actions button { margin-left: 8px; }\n.sponsor-heading { display: flex; align-items: center; }\n.sponsor-logo { width: 180px; height: 180px; flex: 0 0 180px; margin-right: 42px; }\n.sponsor-options { display: flex; }\n.sponsor-options article { flex: 1 1 0; margin-right: 16px; }\n\n.status-screen { min-height: 700px; flex-direction: column; text-align: center; }\n.player-page, .player-presentation-full, .player-host, .native-video, .player-backdrop { top: 0; right: 0; bottom: 0; left: 0; }\n.player-page { position: fixed !important; width: 100% !important; height: 100% !important; }\n.player-host { position: absolute !important; width: 100% !important; height: 100% !important; }\n.native-video, .samsung-avplay { position: absolute !important; width: 100% !important; height: 100% !important; }\n.player-chrome { position: absolute !important; top: auto !important; right: 0 !important; bottom: 0 !important; left: 0 !important; height: auto !important; min-height: 0 !important; z-index: 120 !important; }\n.player-stream-status, .player-options { display: block; }\n.player-option-group { display: flex; align-items: flex-start; }\n.player-option-group > span { width: 104px; flex: 0 0 104px; }\n.player-scrubber-row { display: flex; align-items: center; }\n.player-scrubber-row > :first-child, .player-scrubber-row > :last-child { width: 72px; flex: 0 0 72px; }\n.player-scrubber { flex: 1 1 auto; margin: 0 16px; }\n.audio-player-art { width: 420px; height: 420px; margin-left: -210px; margin-top: -210px; }\n.player-mini-copy { display: flex; align-items: center; }\n.player-mini-title, .player-mini-subtitle { display: block; }\n.player-mini-time { position: absolute; right: 14px; top: 14px; }\n.toast { max-width: 560px; }\n\n[data-tv-focusable=\"true\"]:focus,\n[data-tv-focusable=\"true\"][data-tv-selected=\"true\"] {\n  outline: 4px solid #620014 !important;\n  outline-offset: 2px !important;\n  background-color: rgba(57,0,11,0.55) !important;\n  box-shadow: 0 0 26px rgba(98,0,20,0.75) !important;\n}\n";
function legacyRgba(css) {
    var expanded = css.replace(/#([0-9a-fA-F]{4})(?![0-9a-fA-F])/g, function (_match, value) {
        var _a = value.split(''), r = _a[0], g = _a[1], b = _a[2], a = _a[3];
        var alpha = parseInt(a + a, 16) / 255;
        return "rgba(".concat(parseInt(r + r, 16), ",").concat(parseInt(g + g, 16), ",").concat(parseInt(b + b, 16), ",").concat(alpha.toFixed(3), ")");
    });
    return expanded.replace(/#([0-9a-fA-F]{8})(?![0-9a-fA-F])/g, function (_match, value) {
        var r = parseInt(value.slice(0, 2), 16);
        var g = parseInt(value.slice(2, 4), 16);
        var b = parseInt(value.slice(4, 6), 16);
        var alpha = parseInt(value.slice(6, 8), 16) / 255;
        return "rgba(".concat(r, ",").concat(g, ",").concat(b, ",").concat(alpha.toFixed(3), ")");
    });
}
function samsungCssCompatibility() {
    var decodeAsset = function (source) {
        var _a;
        if (typeof source === 'string')
            return source;
        var out = '';
        for (var offset = 0; offset < source.length; offset += 8192) {
            var end = Math.min(offset + 8192, source.length);
            for (var index = offset; index < end; index += 1) {
                out += String.fromCharCode((_a = source[index]) !== null && _a !== void 0 ? _a : 0);
            }
        }
        return out;
    };
    return {
        name: 'macha-samsung-css-compatibility',
        transformIndexHtml: function () {
            return [
                {
                    tag: 'script',
                    attrs: { type: 'text/javascript', src: '$WEBAPIS/webapis/webapis.js' },
                    injectTo: 'head-prepend',
                },
                {
                    tag: 'link',
                    attrs: { rel: 'stylesheet', href: './samsung-tizen3.css' },
                    injectTo: 'head',
                },
            ];
        },
        generateBundle: function (_options, bundle) {
            for (var _i = 0, _a = Object.keys(bundle); _i < _a.length; _i++) {
                var fileName = _a[_i];
                var output = bundle[fileName];
                if (output.type !== 'asset' || !output.fileName.endsWith('.css'))
                    continue;
                var css = decodeAsset(output.source);
                for (var _b = 0, _c = Object.keys(samsungCssVariables); _b < _c.length; _b++) {
                    var name_1 = _c[_b];
                    css = css.replace(new RegExp("var\\(--".concat(name_1, "\\)"), 'g'), samsungCssVariables[name_1]);
                }
                css = css.replace(/:focus-visible/g, ':focus');
                output.source = legacyRgba(css);
            }
            this.emitFile({
                type: 'asset',
                fileName: 'samsung-tizen3.css',
                source: legacyRgba(samsungLegacyLayout),
            });
        },
    };
}
function samsungManifest(version) {
    return {
        name: 'macha-samsung-manifest',
        generateBundle: function () {
            this.emitFile({
                type: 'asset',
                fileName: 'config.xml',
                source: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<widget\n    xmlns=\"http://www.w3.org/ns/widgets\"\n    xmlns:tizen=\"http://tizen.org/ns/widgets\"\n    id=\"http://macha.local/client\"\n    version=\"".concat(version, "\"\n    viewmodes=\"maximized\">\n\n    <tizen:application\n        id=\"macha00001.Macha\"\n        package=\"macha00001\"\n        required_version=\"2.4\"/>\n\n    <content src=\"index.html\"/>\n    <name>Macha</name>\n\n    <tizen:profile name=\"tv-samsung\"/>\n\n    <tizen:privilege\n        name=\"http://tizen.org/privilege/internet\"/>\n    <tizen:privilege\n        name=\"http://tizen.org/privilege/tv.audio\"/>\n\n    <access origin=\"http://10.44.1.50:7438\" subdomains=\"false\"/>\n</widget>\n"),
            });
        },
    };
}
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    var target = env.MACHA_API_TARGET;
    var samsung = mode === 'samsung';
    return {
        base: samsung ? './' : undefined,
        plugins: __spreadArray([
            react()
        ], (samsung ? [
            legacy({
                targets: ['Chrome >= 47'],
                renderModernChunks: false,
                additionalLegacyPolyfills: ['core-js/proposals/global-this'],
            }),
            samsungCssCompatibility(),
            samsungManifest(packageInfo.version),
        ] : []), true),
        server: target ? {
            proxy: {
                '/api': {
                    target: target,
                    changeOrigin: true,
                },
            },
        } : undefined,
        test: {
            environment: 'node',
        },
    };
});
