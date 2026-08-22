import { jsx as _jsx } from "react/jsx-runtime";
import { NavLink } from 'react-router-dom';
export function SectionNav({ ariaLabel, items }) {
    return (_jsx("nav", { className: "section-subnav", "aria-label": ariaLabel, children: items.map((item) => (_jsx(NavLink, { to: item.to, end: item.end, "data-tv-focusable": "true", className: ({ isActive }) => isActive ? 'active' : undefined, children: item.label }, item.to))) }));
}
