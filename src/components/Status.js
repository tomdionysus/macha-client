import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import errorIconUrl from '../assets/error.svg?url';
import { uiSettings } from '../settings';
export function Loading({ delayMs = uiSettings.loadingIndicatorDelayMs } = {}) {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), Math.max(0, delayMs));
        return () => window.clearTimeout(timer);
    }, [delayMs]);
    if (!visible)
        return null;
    return (_jsx("div", { className: "loading-overlay", role: "status", "aria-live": "polite", "aria-label": "Loading", children: _jsx("div", { className: "loading-spinner", "aria-hidden": "true" }) }));
}
export function ErrorMessage({ error }) {
    return (_jsxs("div", { className: "status-screen error-status", role: "alert", children: [_jsx("img", { className: "error-icon", src: errorIconUrl, alt: "", "aria-hidden": "true" }), _jsx("p", { children: error.message })] }));
}
