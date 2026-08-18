import { ALPHABET_INDEX, type AlphabetIndexKey } from '../titleIndex';

interface Props {
  availableKeys: Set<AlphabetIndexKey>;
  onSelect: (key: AlphabetIndexKey) => void;
}

export function AlphabetIndex({ availableKeys, onSelect }: Props) {
  return (
    <nav className="alphabet-index" aria-label="Alphabetical index">
      {ALPHABET_INDEX.map((key) => {
        const available = availableKeys.has(key);
        return (
          <button
            key={key}
            type="button"
            className="alphabet-index-button"
            disabled={!available}
            data-tv-focusable={available ? 'true' : undefined}
            aria-label={key === '#' ? 'Titles beginning with a number or symbol' : `Titles beginning with ${key}`}
            onClick={() => onSelect(key)}
          >
            {key}
          </button>
        );
      })}
    </nav>
  );
}
