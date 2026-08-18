export const ALPHABET_INDEX = [
    '#',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];
const LEADING_ARTICLE = /^(?:the|an|a)\s+/i;
const COMBINING_MARKS = /\p{M}/gu;
const TITLE_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const ALPHABET_ORDER = new Map(ALPHABET_INDEX.map((key, index) => [key, index]));
export function indexedTitle(title) {
    const trimmed = title.trim();
    const withoutArticle = trimmed.replace(LEADING_ARTICLE, '').trimStart();
    return withoutArticle.length > 0 ? withoutArticle : trimmed;
}
function foldedInitial(title) {
    return indexedTitle(title)
        .normalize('NFKD')
        .replace(COMBINING_MARKS, '')
        .slice(0, 1)
        .toUpperCase();
}
export function alphabetIndexKey(title) {
    const initial = foldedInitial(title);
    return /^[A-Z]$/.test(initial) ? initial : '#';
}
export function compareIndexedTitles(a, b) {
    const bucket = (ALPHABET_ORDER.get(alphabetIndexKey(a)) ?? 0) - (ALPHABET_ORDER.get(alphabetIndexKey(b)) ?? 0);
    if (bucket !== 0)
        return bucket;
    const indexed = TITLE_COLLATOR.compare(indexedTitle(a), indexedTitle(b));
    return indexed !== 0 ? indexed : TITLE_COLLATOR.compare(a, b);
}
export function sortMediaByIndexedTitle(items) {
    return [...items].sort((a, b) => compareIndexedTitles(a.title, b.title));
}
export function availableAlphabetKeys(items) {
    return new Set(items.map((item) => alphabetIndexKey(item.title)));
}
