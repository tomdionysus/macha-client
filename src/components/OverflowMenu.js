import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
export function OverflowMenu({ label, actions, className = '' }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    useEffect(() => {
        if (!open)
            return undefined;
        rootRef.current?.querySelector('.overflow-menu-popover button:not(:disabled)')?.focus();
        const onPointerDown = (event) => {
            if (!rootRef.current?.contains(event.target))
                setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            setOpen(false);
            void Promise.resolve().then(() => triggerRef.current?.focus());
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);
    if (actions.length === 0)
        return null;
    return (_jsxs("div", { ref: rootRef, className: `overflow-menu ${className}`.trim(), children: [_jsx("button", { ref: triggerRef, type: "button", className: "overflow-menu-trigger", "data-tv-focusable": "true", "aria-label": label, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen((value) => !value), children: _jsx("span", { "aria-hidden": "true", children: "\u22EF" }) }), open && (_jsx("div", { className: "overflow-menu-popover", role: "menu", children: actions.map((action, index) => (_jsx("button", { type: "button", role: "menuitem", "data-tv-focusable": "true", className: action.destructive ? 'destructive' : undefined, disabled: action.disabled, onClick: () => {
                        setOpen(false);
                        action.onSelect();
                    }, children: action.label }, `${action.label}-${index}`))) }))] }));
}
