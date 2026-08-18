import { jsx as _jsx } from "react/jsx-runtime";
import { ALPHABET_INDEX } from '../titleIndex';
export function AlphabetIndex({ availableKeys, onSelect }) {
    return (_jsx("nav", { className: "alphabet-index", "aria-label": "Alphabetical index", children: ALPHABET_INDEX.map((key) => {
            const available = availableKeys.has(key);
            return (_jsx("button", { type: "button", className: "alphabet-index-button", disabled: !available, "data-tv-focusable": available ? 'true' : undefined, "aria-label": key === '#' ? 'Titles beginning with a number or symbol' : `Titles beginning with ${key}`, onClick: () => onSelect(key), children: key }, key));
        }) }));
}
