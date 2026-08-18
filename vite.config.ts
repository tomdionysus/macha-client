import packageInfo from './package.json';
import { loadEnv, type Plugin } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
  const env = loadEnv(mode, '.', '');
  const target = env.MACHA_API_TARGET;
  const samsung = mode === 'samsung';

  return {
    base: samsung ? './' : undefined,
    plugins: [
      react(),
      ...(samsung ? [
        legacy({
          targets: ['Chrome >= 47'],
          renderModernChunks: false,
          additionalLegacyPolyfills: ['core-js/proposals/global-this'],
        }),
        samsungManifest(packageInfo.version),
      ] : []),
    ],
    server: target ? {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    } : undefined,
    test: {
      environment: 'node',
    },
  };
});
