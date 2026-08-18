const levels = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
let sequence = 0;
let config = {
    level: 'debug',
    console: true,
    maxEntries: 2_000,
};
const entries = [];
function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
function redactString(value) {
    return value.replace(/(\/api\/v1\/playback\/stream\/[^/]+\/)[^/]+/g, '$1<capability>');
}
function normalise(value, depth = 0) {
    if (depth > 6)
        return '[depth-limit]';
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    if (typeof value === 'string')
        return redactString(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined)
        return value;
    if (Array.isArray(value))
        return value.map((item) => normalise(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (/authorization|bearer|token/i.test(key)) {
                out[key] = '<redacted>';
            }
            else {
                out[key] = normalise(child, depth + 1);
            }
        }
        return out;
    }
    return String(value);
}
function emit(level, scope, event, data) {
    if (levels[level] < levels[config.level])
        return;
    const entry = {
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        elapsedMs: Math.round((nowMs() - startedAt) * 10) / 10,
        level,
        scope,
        event,
        ...(data === undefined ? {} : { data: normalise(data) }),
    };
    entries.push(entry);
    if (entries.length > config.maxEntries)
        entries.splice(0, entries.length - config.maxEntries);
    if (!config.console || typeof console === 'undefined')
        return;
    const prefix = `[macha ${entry.elapsedMs.toFixed(1)}ms] [${scope}] ${event}`;
    if (level === 'error')
        console.error(prefix, entry.data ?? '');
    else if (level === 'warn')
        console.warn(prefix, entry.data ?? '');
    else if (level === 'info')
        console.info(prefix, entry.data ?? '');
    else
        console.debug(prefix, entry.data ?? '');
}
export function configureClientDiagnostics(next) {
    config = { ...config, ...next };
    if (config.maxEntries < 100)
        config.maxEntries = 100;
}
export function createClientLogger(scope, context) {
    const write = (level, event, data) => {
        const merged = context
            ? { ...context, ...(data === undefined ? {} : { detail: data }) }
            : data;
        emit(level, scope, event, merged);
    };
    return {
        debug: (event, data) => write('debug', event, data),
        info: (event, data) => write('info', event, data),
        warn: (event, data) => write('warn', event, data),
        error: (event, data) => write('error', event, data),
    };
}
export function clientDiagnosticsText() {
    return entries.map((entry) => JSON.stringify(entry)).join('\n');
}
export function clientDiagnosticsSnapshot() {
    return entries.map((entry) => ({ ...entry }));
}
export function clearClientDiagnostics() {
    entries.length = 0;
}
export function installClientDiagnosticsConsole() {
    if (typeof window === 'undefined')
        return;
    window.machaDiagnostics = {
        dump: clientDiagnosticsText,
        snapshot: clientDiagnosticsSnapshot,
        clear: clearClientDiagnostics,
        async copy() {
            const text = clientDiagnosticsText();
            if (!navigator.clipboard?.writeText)
                throw new Error('Clipboard API is unavailable in this browser.');
            await navigator.clipboard.writeText(text);
        },
    };
}
