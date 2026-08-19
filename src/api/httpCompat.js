/**
 * Build a plain header object without relying on the Headers(init) constructor.
 * Older Tizen Chromium implements Fetch but only exposes the earliest Headers
 * constructor shape.
 */
export function mergeRequestHeaders(initial, values) {
    const result = {};
    if (initial) {
        if (Array.isArray(initial)) {
            for (const pair of initial)
                result[pair[0]] = pair[1];
        }
        else {
            const iterable = initial;
            if (typeof iterable.forEach === 'function') {
                iterable.forEach((value, key) => { result[key] = value; });
            }
            else {
                const object = initial;
                for (const key of Object.keys(object))
                    result[key] = object[key];
            }
        }
    }
    for (const key of Object.keys(values)) {
        const value = values[key];
        if (value !== undefined)
            result[key] = value;
    }
    return result;
}
export function queryString(entries) {
    const parts = [];
    for (const [key, value] of entries) {
        if (value === undefined)
            continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return parts.join('&');
}
