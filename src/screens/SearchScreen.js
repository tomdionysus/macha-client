import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { MediaCard } from '../components/MediaCard';
import { ErrorMessage } from '../components/Status';
export function SearchScreen({ api, onOpen }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState();
    useEffect(() => {
        const normalized = query.trim();
        if (normalized.length < 2) {
            setResults([]);
            setError(undefined);
            return;
        }
        let active = true;
        const timer = window.setTimeout(() => {
            void api.search(normalized)
                .then((value) => { if (active)
                setResults(value); })
                .catch((reason) => { if (active)
                setError(String(reason)); });
        }, 180);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [api, query]);
    if (error)
        return _jsx(ErrorMessage, { error: new Error(error) });
    return (_jsxs("section", { children: [_jsx("h1", { children: "Search" }), _jsx("input", { className: "search-input", "data-tv-focusable": "true", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search your library", autoFocus: true }), _jsx("div", { className: "media-grid search-results", children: results.map((item) => _jsx(MediaCard, { api: api, item: item, onOpen: onOpen }, item.id)) })] }));
}
