import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function EditButton({ onClick, label = 'Edit metadata' }) {
    return (_jsx("button", { className: "entity-edit-button", "data-tv-focusable": "true", onClick: onClick, type: "button", "aria-label": label, title: label, children: _jsxs("svg", { viewBox: "0 0 24 24", width: "18", height: "18", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { d: "M5 19h3.5L18.7 8.8a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0L5 15.5V19Z", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinejoin: "round" }), _jsx("path", { d: "m13.9 6.6 3.5 3.5", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" })] }) }));
}
