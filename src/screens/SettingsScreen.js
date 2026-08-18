import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import logoUrl from '../assets/macha-logo.svg?url';
import { useAsync } from '../hooks/useAsync';
import { routes } from '../routing';
import { clientVersion } from '../version';
function booleanField(status, name) {
    const value = status?.playback[name];
    return typeof value === 'boolean' ? value : undefined;
}
function playbackState(status) {
    if (!status)
        return 'Unknown';
    if (!status.playbackAvailable)
        return 'Unavailable';
    if (booleanField(status, 'enabled') === false)
        return 'Disabled';
    if (booleanField(status, 'ready') === false || booleanField(status, 'available') === false)
        return 'Not ready';
    return 'Ready';
}
function formatLastSync(unixMs) {
    if (!unixMs)
        return 'Never';
    return new Date(unixMs).toLocaleString();
}
export function SettingsScreen({ api, serverApi, serverUrl, apiToken, onSave }) {
    const [url, setUrl] = useState(serverUrl);
    const [token, setToken] = useState(apiToken);
    const server = useAsync(() => serverApi.status(), [serverApi]);
    const catalogue = useAsync(() => api.status(), [api]);
    const serverState = server.loading ? 'Checking…' : server.error ? 'Unavailable' : 'Online';
    const catalogueState = catalogue.loading
        ? 'Checking…'
        : catalogue.error
            ? 'Unavailable'
            : catalogue.value?.ready
                ? 'Ready'
                : catalogue.value?.enabled
                    ? 'Synchronising'
                    : 'Disabled';
    const overallState = server.error
        ? 'Server unavailable'
        : catalogue.error
            ? 'Server online; catalogue unavailable'
            : catalogue.value?.ready
                ? 'Ready'
                : catalogue.loading || server.loading
                    ? 'Checking system state…'
                    : 'Server online; catalogue synchronising';
    return (_jsxs("section", { className: "settings", children: [_jsxs("div", { className: "settings-hero", children: [_jsx("img", { className: "settings-logo", src: logoUrl, alt: "" }), _jsxs("div", { className: "settings-brand-copy", children: [_jsx("p", { className: "eyebrow", children: "Media server" }), _jsx("h1", { children: "Macha" }), _jsx("p", { className: "settings-overall-state", children: overallState })] }), _jsx(Link, { className: "primary-button sponsor-button", "data-tv-focusable": "true", to: routes.sponsor, children: "Donate / Sponsor" })] }), _jsxs("div", { className: "settings-status-grid", "aria-label": "System status", children: [_jsxs("article", { className: "settings-status-card", children: [_jsx("span", { className: "settings-status-label", children: "Server" }), _jsx("strong", { children: serverState }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Version" }), _jsx("dd", { children: server.value?.version ?? (server.loading ? 'Checking…' : 'Not reported') })] }), _jsxs("div", { children: [_jsx("dt", { children: "Playback" }), _jsx("dd", { children: server.error ? 'Unavailable' : playbackState(server.value) })] })] }), (server.error || server.value?.message) && _jsx("p", { className: "settings-status-error", children: server.error?.message ?? server.value?.message })] }), _jsxs("article", { className: "settings-status-card", children: [_jsx("span", { className: "settings-status-label", children: "Catalogue" }), _jsx("strong", { children: catalogueState }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "Items" }), _jsx("dd", { children: catalogue.value?.items ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: "Artwork" }), _jsx("dd", { children: catalogue.value ? `${catalogue.value.local_artwork_objects}/${catalogue.value.artwork_objects} local` : '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: "Generation" }), _jsx("dd", { children: catalogue.value?.metadata_generation ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: "Last sync" }), _jsx("dd", { children: catalogue.value ? formatLastSync(catalogue.value.last_sync_unix_ms) : '—' })] })] }), (catalogue.error || catalogue.value?.error) && (_jsx("p", { className: "settings-status-error", children: catalogue.error?.message ?? catalogue.value?.error }))] }), _jsxs("article", { className: "settings-status-card settings-version-card", children: [_jsx("span", { className: "settings-status-label", children: "Client" }), _jsx("strong", { children: "Web client" }), _jsx("dl", { children: _jsxs("div", { children: [_jsx("dt", { children: "Version" }), _jsx("dd", { children: clientVersion })] }) })] })] }), _jsxs("div", { className: "settings-connection", children: [_jsx("h2", { children: "Connection" }), _jsx("label", { htmlFor: "server-url", children: "Macha API" }), _jsx("div", { className: "settings-line", children: _jsx("input", { id: "server-url", "data-tv-focusable": "true", value: url, onChange: (event) => setUrl(event.target.value), placeholder: "same origin", spellCheck: false }) }), _jsxs("label", { htmlFor: "api-token", children: ["Bearer token ", _jsx("span", { className: "muted", children: "(optional)" })] }), _jsxs("div", { className: "settings-line", children: [_jsx("input", { id: "api-token", "data-tv-focusable": "true", type: "password", value: token, onChange: (event) => setToken(event.target.value), spellCheck: false }), _jsx("button", { "data-tv-focusable": "true", onClick: () => onSave(url, token), children: "Save" })] }), _jsxs("p", { children: ["No account or cloud service. An empty API URL means same-origin ", _jsx("code", { children: "/api/v1/\u2026" }), "."] })] })] }));
}
