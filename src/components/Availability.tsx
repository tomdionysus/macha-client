import { availableToPlay, type Availability, type AvailabilityMembers, type MediaKind } from '@machafoundation/core';
import { availabilityText } from '../text/viewerText';

/** The availability codes that carry a marker; complete, absent and any code not named here carry none. */
export type AvailabilityMark = 'partial' | 'unavailable' | 'unknown';

const MARKS: readonly string[] = ['partial', 'unavailable', 'unknown'];

export function availabilityMark(availability: Availability | undefined): AvailabilityMark | undefined {
  return availability !== undefined && MARKS.includes(availability) ? availability as AvailabilityMark : undefined;
}

/**
 * Props for a title's open control: an unavailable title cannot be pressed or
 * focused by the remote, but stays hoverable for its marker's tooltip.
 */
export function openControlProps(item: { availability?: Availability }, open: () => void) {
  return !availableToPlay(item)
    ? { 'aria-disabled': true as const, tabIndex: -1, onClick: (event: { preventDefault: () => void }) => event.preventDefault() }
    : { 'data-tv-focusable': 'true', onClick: open };
}

function Icon({ mark }: { mark: AvailabilityMark }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (mark === 'partial') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 2.5 20h19L12 3.5Z" {...line} />
        <path d="M12 10v4.5M12 17.2v.1" {...line} />
      </svg>
    );
  }
  if (mark === 'unavailable') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" {...line} />
        <path d="M6 18 18 6" {...line} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" {...line} />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.3M12 16.8v.1" {...line} />
    </svg>
  );
}

/** The mark on a title not wholly held by a reachable node, with a tooltip; nothing for a complete or undescribed title. */
export function AvailabilityMarker({ availability, members, kind, className }: {
  availability: Availability | undefined;
  members?: AvailabilityMembers;
  kind?: MediaKind;
  className?: string;
}) {
  const mark = availabilityMark(availability);
  if (!mark) return null;
  const text = availabilityText(mark, kind, members);
  return (
    <span className={`availability-marker availability-${mark}${className ? ` ${className}` : ''}`} role="img" aria-label={text} title={text}>
      <Icon mark={mark} />
    </span>
  );
}

/** The marker's meaning as text, for an unplayable title's page: a remote has no tooltip. */
export function AvailabilityNote({ item }: { item: { availability?: Availability; availabilityMembers?: AvailabilityMembers; kind?: MediaKind } }) {
  if (!!availableToPlay(item)) return null;
  return <p className="availability-note">{availabilityText('unavailable', item.kind, item.availabilityMembers)}</p>;
}

/** A page title's marker, for `MediaPageTitle`'s `leading`. */
export function titleMarker(item: { availability?: Availability; availabilityMembers?: AvailabilityMembers; kind?: MediaKind }) {
  return <AvailabilityMarker availability={item.availability} members={item.availabilityMembers} kind={item.kind} className="availability-inline availability-title" />;
}
