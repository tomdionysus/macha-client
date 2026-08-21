import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, Loading } from '../components/Status';
import { useAsync } from '../hooks/useAsync';
const INTERNAL_EXTERNAL_ID_PREFIX = 'macha_';
const METADATA_LOCK_KEY = 'macha_metadata_locked';
function optionalInt(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
}
function isProviderExternalId(key) {
    return !key.startsWith(INTERNAL_EXTERNAL_ID_PREFIX);
}
function providerLabel(key) {
    switch (key) {
        case 'tmdb': return 'TMDB';
        case 'tmdb_collection': return 'TMDB collection';
        case 'musicbrainz': return 'MusicBrainz';
        case 'musicbrainz_release': return 'MusicBrainz release';
        case 'musicbrainz_release_group': return 'MusicBrainz release group';
        default: return key;
    }
}
function entityLabel(kind) {
    switch (kind) {
        case 'show': return 'Series';
        default: return kind.charAt(0).toUpperCase() + kind.slice(1);
    }
}
function reorderArtwork(items, selected) {
    const roles = [];
    for (const item of items)
        if (!roles.includes(item.role))
            roles.push(item.role);
    const output = [];
    for (const role of roles) {
        const group = items.filter((item) => item.role === role);
        const selectedId = selected[role];
        if (selectedId) {
            const chosen = group.find((item) => item.id === selectedId);
            if (chosen)
                output.push(chosen);
        }
        for (const item of group) {
            if (!output.some((candidate) => candidate.role === item.role && candidate.id === item.id))
                output.push(item);
        }
    }
    return output;
}
function ArtworkPreview({ api, artwork, selected, onSelect }) {
    const [url, setUrl] = useState();
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        let objectUrl;
        setUrl(undefined);
        setFailed(false);
        void api.artwork(artwork.id).then((blob) => {
            if (cancelled)
                return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
        }).catch(() => {
            if (!cancelled)
                setFailed(true);
        });
        return () => {
            cancelled = true;
            if (objectUrl)
                URL.revokeObjectURL(objectUrl);
        };
    }, [api, artwork.id]);
    return (_jsxs("button", { className: `metadata-artwork-option${selected ? ' selected' : ''}`, "data-tv-focusable": "true", type: "button", onClick: onSelect, "aria-pressed": selected, title: selected ? 'Selected image' : 'Use this image', children: [_jsxs("span", { className: "metadata-artwork-image", children: [url && _jsx("img", { src: url, alt: "" }), !url && !failed && _jsx("span", { className: "metadata-artwork-loading", children: "\u2026" }), failed && _jsx("span", { className: "metadata-artwork-loading", children: "Unavailable" })] }), _jsx("span", { className: "metadata-artwork-id", children: artwork.id.slice(0, 10) })] }));
}
function MetadataForm({ api, initial, onBack, onSaved, onCleared }) {
    const [draft, setDraft] = useState(() => structuredClone(initial));
    const [aliasesText, setAliasesText] = useState(() => initial.aliases.join('\n'));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState();
    const [confirmClear, setConfirmClear] = useState(false);
    const [selectedArtwork, setSelectedArtwork] = useState(() => {
        const selected = {};
        for (const art of initial.artwork)
            if (!selected[art.role])
                selected[art.role] = art.id;
        return selected;
    });
    const providerIds = useMemo(() => Object.entries(draft.external_ids).filter(([key]) => isProviderExternalId(key)), [draft.external_ids]);
    const artworkRoles = useMemo(() => {
        const roles = [];
        for (const art of draft.artwork)
            if (!roles.includes(art.role))
                roles.push(art.role);
        return roles;
    }, [draft.artwork]);
    const update = (key, value) => {
        setDraft((current) => ({ ...current, [key]: value }));
    };
    const lockExternalIds = (externalIds) => ({
        ...externalIds,
        [METADATA_LOCK_KEY]: '1',
    });
    const clearMetadata = async () => {
        setSaving(true);
        setError(undefined);
        try {
            await api.clearMetadata(initial.id, initial.revision);
            onCleared(initial);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught : new Error(String(caught)));
            setConfirmClear(false);
        }
        finally {
            setSaving(false);
        }
    };
    const save = async () => {
        const title = draft.title.trim();
        if (!title) {
            setError(new Error('Title is required.'));
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            const payload = {
                ...draft,
                title,
                sort_title: draft.sort_title.trim() || title,
                aliases: aliasesText.split('\n').map((alias) => alias.trim()).filter(Boolean),
                artwork: reorderArtwork(draft.artwork, selectedArtwork),
                external_ids: lockExternalIds(draft.external_ids),
            };
            await api.update(payload, initial.revision);
            onSaved();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught : new Error(String(caught)));
        }
        finally {
            setSaving(false);
        }
    };
    return (_jsxs("section", { className: "metadata-editor", children: [_jsxs("div", { className: "metadata-editor-toolbar", children: [_jsx("button", { className: "back-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "\u2190 Back" }), _jsxs("div", { className: "metadata-editor-actions", children: [_jsx("button", { className: "secondary-button", "data-tv-focusable": "true", onClick: onBack, type: "button", children: "Cancel" }), _jsx("button", { className: "primary-button", "data-tv-focusable": "true", disabled: saving, onClick: () => void save(), type: "button", children: saving ? 'Saving…' : 'Save changes' })] })] }), _jsxs("p", { className: "eyebrow", children: ["Edit ", entityLabel(draft.kind)] }), _jsx("h1", { children: draft.title }), _jsx("p", { className: "metadata-editor-note", children: "Manual changes are kept when the catalogue scanner runs again." }), error && _jsx("div", { className: "metadata-editor-error", role: "alert", children: error.message }), _jsxs("div", { className: "metadata-editor-grid", children: [_jsxs("section", { className: "metadata-editor-panel", children: [_jsx("h2", { children: "Metadata" }), _jsxs("label", { children: [_jsx("span", { children: "Title" }), _jsx("input", { value: draft.title, onChange: (event) => update('title', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "Sort title" }), _jsx("input", { value: draft.sort_title, onChange: (event) => update('sort_title', event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "Year" }), _jsx("input", { inputMode: "numeric", value: draft.year ?? '', onChange: (event) => update('year', optionalInt(event.target.value)) })] }), (draft.kind === 'season' || draft.kind === 'episode') && (_jsxs("label", { children: [_jsx("span", { children: "Season number" }), _jsx("input", { inputMode: "numeric", value: draft.season_number ?? '', onChange: (event) => update('season_number', optionalInt(event.target.value)) })] })), draft.kind === 'episode' && (_jsxs("label", { children: [_jsx("span", { children: "Episode number" }), _jsx("input", { inputMode: "numeric", value: draft.episode_number ?? '', onChange: (event) => update('episode_number', optionalInt(event.target.value)) })] })), draft.kind === 'track' && (_jsxs(_Fragment, { children: [_jsxs("label", { children: [_jsx("span", { children: "Disc number" }), _jsx("input", { inputMode: "numeric", value: draft.disc_number ?? '', onChange: (event) => update('disc_number', optionalInt(event.target.value)) })] }), _jsxs("label", { children: [_jsx("span", { children: "Track number" }), _jsx("input", { inputMode: "numeric", value: draft.track_number ?? '', onChange: (event) => update('track_number', optionalInt(event.target.value)) })] })] })), _jsxs("label", { className: "metadata-editor-wide-field", children: [_jsx("span", { children: "Synopsis" }), _jsx("textarea", { rows: 8, value: draft.synopsis, onChange: (event) => update('synopsis', event.target.value) })] }), _jsxs("label", { className: "metadata-editor-wide-field", children: [_jsxs("span", { children: ["Aliases ", _jsx("small", { children: "one per line" })] }), _jsx("textarea", { rows: 4, value: aliasesText, onChange: (event) => setAliasesText(event.target.value) })] })] }), _jsxs("section", { className: "metadata-editor-panel", children: [_jsx("h2", { children: "Match" }), providerIds.length ? (_jsx("dl", { className: "metadata-provider-ids", children: providerIds.map(([key, value]) => (_jsxs("div", { children: [_jsx("dt", { children: providerLabel(key) }), _jsx("dd", { children: value })] }, key))) })) : (_jsx("p", { className: "metadata-editor-muted", children: "This item is not matched to an online metadata provider." })), draft.external_ids[METADATA_LOCK_KEY] === '1' && (_jsx("p", { className: "metadata-lock-status", children: "Manual metadata" })), _jsx("div", { className: "metadata-destructive-actions", children: _jsx("button", { className: "secondary-button metadata-clear-button", "data-tv-focusable": "true", disabled: saving, onClick: () => setConfirmClear(true), type: "button", children: "Clear metadata" }) }), confirmClear && (_jsxs("div", { className: "metadata-confirm", role: "alertdialog", "aria-live": "polite", children: [_jsx("strong", { children: "Clear all catalogue metadata?" }), _jsxs("p", { children: ["This removes the catalogue match, descriptive metadata and artwork for this ", entityLabel(draft.kind).toLowerCase(), ".", ' ', "Dependent catalogue entries are also removed where necessary so the underlying media becomes unbound and can be probed and matched again by the cataloguer."] }), _jsxs("div", { children: [_jsx("button", { className: "secondary-button", "data-tv-focusable": "true", disabled: saving, onClick: () => setConfirmClear(false), type: "button", children: "Cancel" }), _jsx("button", { className: "primary-button metadata-confirm-danger", "data-tv-focusable": "true", disabled: saving, onClick: () => void clearMetadata(), type: "button", children: saving ? 'Clearing…' : 'Clear metadata' })] })] }))] })] }), _jsxs("section", { className: "metadata-editor-panel metadata-artwork-panel", children: [_jsx("h2", { children: "Artwork" }), artworkRoles.length === 0 && _jsx("p", { className: "metadata-editor-muted", children: "No artwork is currently attached to this item." }), artworkRoles.map((role) => {
                        const items = draft.artwork.filter((art) => art.role === role);
                        return (_jsxs("div", { className: "metadata-artwork-role", children: [_jsxs("div", { className: "metadata-artwork-role-heading", children: [_jsx("h3", { children: role }), _jsx("span", { children: items.length > 1 ? 'Choose the image used by the client' : 'Current image' })] }), _jsx("div", { className: "metadata-artwork-grid", children: items.map((art) => (_jsx(ArtworkPreview, { api: api, artwork: art, selected: (selectedArtwork[role] ?? items[0]?.id) === art.id, onSelect: () => setSelectedArtwork((current) => ({ ...current, [role]: art.id })) }, `${art.role}:${art.id}`))) })] }, role));
                    })] })] }));
}
export function MetadataEditorScreen({ api, itemId, onBack, onSaved, onCleared }) {
    const item = useAsync(() => api.get(itemId), [api, itemId]);
    if (item.loading)
        return _jsx(Loading, {});
    if (item.error)
        return _jsx(ErrorMessage, { error: item.error });
    if (!item.value)
        return null;
    return _jsx(MetadataForm, { api: api, initial: item.value, onBack: onBack, onSaved: onSaved, onCleared: onCleared }, `${item.value.id}:${item.value.revision}`);
}
