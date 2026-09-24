import { ALPHABET_INDEX, type AlphabetIndexKey } from '@machafoundation/core';
import { alphabetIndexKeyDescription, alphabetIndexKeyText } from '../text/viewerText';

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
            aria-label={alphabetIndexKeyDescription(key)}
            onClick={() => onSelect(key)}
          >
            {alphabetIndexKeyText(key)}
          </button>
        );
      })}
    </nav>
  );
}
