import { jsx as _jsx } from "react/jsx-runtime";
import logoUrl from '../assets/macha-logo.svg?url';
export function AppLogo() {
    return _jsx("img", { className: "app-logo", src: logoUrl, alt: "Macha" });
}
