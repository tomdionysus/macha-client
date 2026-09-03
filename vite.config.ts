import packageInfo from './package.json';
import type { Plugin } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';


const samsungCssVariables: Record<string, string> = {
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
  'navigation-surface': 'linear-gradient(#0e0e0ff7, #0e0e0fdf)',
  'navigation-blur': 'blur(12px)',
};

const samsungLegacyLayout = `
/* Generated only for the Tizen 3.0 / Chromium 47 Samsung build. */
html, body, #root { width: 100%; height: 100%; min-height: 100%; margin: 0; }
body { min-width: 0; background: #0e0e0f; color: #e2e2e5; }
.app-shell { position: relative; width: 100%; min-height: 100%; }
.app-shell > main { position: relative; z-index: 1; }
.app-watermark { position: fixed; left: 50%; top: 53%; width: 430px; height: 430px; margin-left: -215px; margin-top: -215px; }
.splash { position: fixed; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; }

.topbar { position: relative; top: auto; display: flex; align-items: center; min-height: 68px; padding: 10px 58px; }
.brand-link { display: flex; align-items: center; flex: 0 0 auto; margin-right: 28px; }
.brand-link .app-logo { margin-right: 9px; }
.topbar nav { display: flex; flex: 1 1 auto; justify-content: center; }
.topbar nav a { display: block; margin: 0 4px; }
.platform-badge { flex: 0 0 150px; margin-left: 28px; text-align: right; }
main { padding: 16px 58px 64px; }
h1 { font-size: 48px; }
h2 { font-size: 24px; }

.media-row { display: flex; flex-wrap: nowrap; }
.media-row > .media-card, .media-row > .continue-card { margin-right: 16px; }
.media-grid { display: flex; flex-wrap: wrap; }
.media-grid > .media-card { width: 190px; flex: 0 0 190px; margin: 0 16px 24px 0; }
.media-card { width: 190px; flex: 0 0 190px; }
.poster { width: 100%; height: 285px; }
.music-artwork, .media-card-album .poster, .media-card-artist .poster, .media-card-track .poster { height: 190px; }
.card-overflow-menu { height: 285px; }
.media-card-album .card-overflow-menu, .media-card-artist .card-overflow-menu, .media-card-track .card-overflow-menu { height: 190px; }
.continue-card-context { display: block; }
.continue-card-context-link { width: auto; }

.alphabet-index { top: 78px; right: 12px; bottom: 12px; }
.alphabet-index-button { font-size: 11px; }

.poster-placeholder, .movie-detail-poster-placeholder, .episode-still-placeholder,
.loading-overlay, .audio-player-placeholder, .player-fatal-error, .overflow-menu-trigger,
.episode-play-action, .player-button-row button, .media-control-button, .player-mini-controls button,
.status-screen { display: flex; align-items: center; justify-content: center; }

.movie-detail-layout { display: flex; align-items: flex-start; margin-top: 12px; }
.movie-detail-poster { width: 300px; height: 450px; flex: 0 0 300px; margin-right: 42px; }
.movie-detail-copy { flex: 1 1 auto; min-width: 0; }
.episode-rail > * { margin-right: 18px; }
.episode-rail-item { flex: 0 0 480px; }
.episode-still { height: 270px; }
.episode-still-placeholder { height: 270px; }
.episode-heading { display: flex; }

.album-header { display: flex; align-items: flex-end; }
.album-cover { width: 280px; height: 280px; flex: 0 0 280px; margin-right: 42px; }
.track-list { display: block; }
.section-nav-slot, .section-subnav, .playlist-heading-row, .playlist-actions { display: flex; }
.track-row, .track-row-open { display: flex; align-items: center; }
.track-row-open { flex: 1 1 auto; }
.track-number, .track-action { width: 48px; flex: 0 0 48px; }
.track-title, .track-copy { flex: 1 1 auto; }
.playlist-track-row { display: flex; align-items: center; }
.playlist-drag-handle, .playlist-remove, .playlist-track-number { flex: 0 0 auto; }
.playlist-artwork { width: 50px; height: 50px; flex: 0 0 50px; margin: 0 10px; }
.playlist-track-copy { flex: 1 1 auto; min-width: 0; }
.player-volume-control { display: flex; align-items: center; }

.settings { width: 900px; max-width: 100%; }
.settings-line { display: flex; }
.settings-line > * { margin-right: 10px; }
.settings-hero { display: flex; align-items: center; padding: 28px; }
.settings-logo { width: 138px; height: 138px; flex: 0 0 138px; margin-right: 32px; }
.settings-brand-copy { flex: 1 1 auto; }
.settings-status-grid { display: flex; }
.settings-status-card { flex: 1 1 0; margin-right: 16px; }
.settings-status-card dl { display: block; }
.settings-status-card dl > div { display: flex; justify-content: space-between; }
.async-icon-button { display: flex; align-items: center; justify-content: center; padding: 0; }
.async-icon-button svg { display: block; margin: 0; }

.ingest-header { display: flex; align-items: flex-end; justify-content: space-between; }
.ingest-header > div:first-child { flex: 1 1 auto; }
.ingest-staging-summary { width: 360px; flex: 0 0 360px; margin-left: 24px; }
.ingest-submit-grid { display: flex; }
.ingest-submit-card { flex: 1 1 0; margin-right: 16px; }
.ingest-submit-card:last-child { margin-right: 0; }
.ingest-submit-line { display: flex; }
.ingest-submit-line input { flex: 1 1 auto; margin-right: 10px; }
.ingest-submit-line button { flex: 0 0 auto; }
.ingest-job-heading { display: flex; justify-content: space-between; }
.ingest-job-stats { display: flex; flex-wrap: wrap; }
.ingest-job-stats > div { width: 16.66%; flex: 0 0 16.66%; padding-right: 12px; }
.ingest-job-stats-import > div { width: 33.33%; flex-basis: 33.33%; }
.ingest-job-actions { display: flex; justify-content: flex-end; }
.ingest-job-actions button { margin-left: 8px; }
.sponsor-heading { display: flex; align-items: center; }
.sponsor-logo { width: 180px; height: 180px; flex: 0 0 180px; margin-right: 42px; }
.sponsor-options { display: flex; }
.sponsor-options article { flex: 1 1 0; margin-right: 16px; }

.status-screen { min-height: 700px; flex-direction: column; text-align: center; }
.player-page { position: fixed !important; }
.player-page.player-presentation-full { top: 0 !important; right: 0 !important; bottom: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; }
.player-presentation-full .player-host, .player-presentation-full .native-video { top: 0 !important; right: 0 !important; bottom: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; }
.player-page.player-presentation-mini { top: auto !important; right: 29px !important; bottom: 23px !important; left: 29px !important; width: auto !important; height: 76px !important; min-height: 76px !important; max-height: 76px !important; }
.player-presentation-mini .player-host { top: 0 !important; right: auto !important; bottom: 0 !important; left: 0 !important; width: 132px !important; height: 76px !important; }
.player-presentation-mini .native-video { top: 0 !important; right: 0 !important; bottom: 0 !important; left: 0 !important; width: 100% !important; height: 76px !important; }
.player-presentation-mini.audio-player .player-host { width: 76px !important; height: 76px !important; }
.player-presentation-mini .player-mini-chrome { top: 0 !important; right: 0 !important; bottom: 0 !important; left: 132px !important; height: 76px !important; min-height: 76px !important; max-height: 76px !important; }
.player-presentation-mini.audio-player .player-mini-chrome { left: 76px !important; }
.player-chrome { position: absolute !important; top: auto !important; right: 0 !important; bottom: 0 !important; left: 0 !important; height: auto !important; min-height: 0 !important; z-index: 120 !important; }
.player-stream-status, .player-options { display: block; }
.player-option-group { display: flex; align-items: flex-start; }
.player-option-group > span { width: 104px; flex: 0 0 104px; }
.player-scrubber-row { display: flex; align-items: center; }
.player-scrubber-row > :first-child, .player-scrubber-row > :last-child { width: 72px; flex: 0 0 72px; }
.player-scrubber { flex: 1 1 auto; margin: 0 16px; }
.player-scrubber-display { flex: 1 1 auto; height: 6px; margin: 0 16px; background: #28282c; overflow: hidden; }
.player-scrubber-display > span { display: block; height: 100%; background: #9f1834; }
.audio-player-art { width: 420px; height: 420px; margin-left: -210px; margin-top: -210px; }
.player-mini-copy { display: flex; align-items: center; }
.player-mini-title, .player-mini-subtitle { display: block; }
.player-mini-time { position: absolute; right: 14px; top: 14px; }
.toast { max-width: 560px; }

/* Chromium 47: avoid expensive compositor effects and animation on the TV UI. */
*, *::before, *::after { transition: none !important; animation: none !important; }
.app-watermark, .player-backdrop { display: none !important; }
.topbar, .section-nav-slot, .section-subnav, .media-card, .continue-card, .primary-button, .track-row,
.player-presentation-mini, .settings-status-card, .ingest-submit-card, .overflow-menu-popover {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  box-shadow: none !important;
}
h1, h2, .card-title, .episode-heading strong, .track-title, .player-titlebar strong { text-shadow: none !important; }
.media-card:focus, .episode-still-link:focus { transform: none !important; }

[data-tv-focusable="true"]:focus,
[data-tv-focusable="true"][data-tv-selected="true"] {
  outline: none !important;
  border-radius: 8px !important;
  background-color: transparent !important;
  box-shadow: 0 0 0 4px #620014 !important;
}
`

function legacyRgba(css: string): string {
  const expanded = css.replace(/#([0-9a-fA-F]{4})(?![0-9a-fA-F])/g, (_match, value: string) => {
    const [r, g, b, a] = value.split('');
    const alpha = parseInt(a + a, 16) / 255;
    return `rgba(${parseInt(r + r, 16)},${parseInt(g + g, 16)},${parseInt(b + b, 16)},${alpha.toFixed(3)})`;
  });
  return expanded.replace(/#([0-9a-fA-F]{8})(?![0-9a-fA-F])/g, (_match, value: string) => {
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const alpha = parseInt(value.slice(6, 8), 16) / 255;
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  });
}

function samsungCssCompatibility(): Plugin {
  const decodeAsset = (source: string | Uint8Array): string => {
    if (typeof source === 'string') return source;
    let out = '';
    for (let offset = 0; offset < source.length; offset += 8192) {
      const end = Math.min(offset + 8192, source.length);
      for (let index = offset; index < end; index += 1) {
        out += String.fromCharCode(source[index] ?? 0);
      }
    }
    return out;
  };

  return {
    name: 'macha-samsung-css-compatibility',
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'stylesheet', href: './samsung-tizen3.css' },
          injectTo: 'head',
        },
      ];
    },
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        const output = bundle[fileName];
        if (output.type !== 'asset' || !output.fileName.endsWith('.css')) continue;
        let css = decodeAsset(output.source);
        for (const name of Object.keys(samsungCssVariables)) {
          css = css.replace(new RegExp(`var\\(--${name}\\)`, 'g'), samsungCssVariables[name]);
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

// Tizen config.xml exposes one package/test launcher icon. Samsung TV published 1:1,
// 16:9 and 512x423 launcher artwork is supplied separately through Seller Office;
// the corresponding build assets live under public/samsung/.
function samsungManifest(version: string): Plugin {
  return {
    name: 'macha-samsung-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'config.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<widget
    xmlns="http://www.w3.org/ns/widgets"
    xmlns:tizen="http://tizen.org/ns/widgets"
    id="http://macha.local/client"
    version="${version}"
    viewmodes="maximized">

    <tizen:application
        id="macha00001.Macha"
        package="macha00001"
        required_version="2.4"/>

    <content src="index.html"/>
    <icon src="samsung/macha-icon-package-117.png"/>
    <name>Macha</name>

    <tizen:profile name="tv-samsung"/>

    <tizen:privilege
        name="http://tizen.org/privilege/internet"/>

    <access origin="*" subdomains="true"/>
</widget>
`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const samsung = mode === 'samsung';
  const android = mode === 'android';

  return {
    base: samsung || android ? './' : undefined,
    plugins: [
      react(),
      ...(samsung ? [
        legacy({
          targets: ['Chrome >= 47'],
          renderModernChunks: false,
          additionalLegacyPolyfills: ['core-js/proposals/global-this'],
        }),
        samsungCssCompatibility(),
        samsungManifest(packageInfo.version),
      ] : []),
    ],
    test: {
      environment: 'node',
      setupFiles: './src/test/setup.ts',
    },
    build: android ? {
      outDir: 'platforms/android/app/build/generated/web',
      emptyOutDir: true,
    } : undefined,
  };
});
