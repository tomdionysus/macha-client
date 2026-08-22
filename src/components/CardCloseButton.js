import { jsx as _jsx } from "react/jsx-runtime";
export function CardCloseButton({ label, onClick, disabled = false, className = '' }) {
    return (_jsx("button", { type: "button", className: `card-close-button${className ? ` ${className}` : ''}`, "data-tv-focusable": "true", "aria-label": label, title: label, disabled: disabled, onClick: onClick, children: _jsx("span", { "aria-hidden": "true", children: "\u00D7" }) }));
}
