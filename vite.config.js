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
function samsungManifest(version) {
    return {
        name: 'macha-samsung-manifest',
        generateBundle: function () {
            this.emitFile({
                type: 'asset',
                fileName: 'config.xml',
                source: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<widget\n    xmlns=\"http://www.w3.org/ns/widgets\"\n    xmlns:tizen=\"http://tizen.org/ns/widgets\"\n    id=\"http://macha.local/client\"\n    version=\"".concat(version, "\"\n    viewmodes=\"maximized\">\n\n    <tizen:application\n        id=\"macha00001.Macha\"\n        package=\"macha00001\"\n        required_version=\"2.4\"/>\n\n    <content src=\"index.html\"/>\n    <name>Macha</name>\n\n    <tizen:profile name=\"tv-samsung\"/>\n\n    <tizen:privilege\n        name=\"http://tizen.org/privilege/internet\"/>\n\n    <access origin=\"*\" subdomains=\"true\"/>\n</widget>\n"),
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
