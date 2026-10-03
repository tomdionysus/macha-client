import type { Availability, AvailabilityMembers, MediaKind } from '@machafoundation/core';
import { availabilityText } from '../text/viewerText';

/** The availability codes that carry a marker; complete, absent and any code not named here carry none. */
export type AvailabilityMark = 'partial' | 'unavailable' | 'unknown';

const MARKS: readonly string[] = ['partial', 'unavailable', 'unknown'];

export function availabilityMark(availability: Availability | undefined): AvailabilityMark | undefined {
  return availability !== undefined && MARKS.includes(availability) ? availability as AvailabilityMark : undefined;
}

/** Only a title none of whose pieces any reachable node holds may not be played or selected. */
export function isUnavailable(item: { availability?: Availability } | undefined): boolean {
  return item?.availability === 'unavailable';
}

/**
 * The props that make a title's open control selectable, or not: an
 * unavailable title stays in place, greyed out by its card's own class, but
 * cannot be pressed or reached by the remote. It stays hoverable, so its
 * marker's tooltip still says why.
 */
export function openControlProps(item: { availability?: Availability }, open: () => void) {
  return isUnavailable(item)
    ? { 'aria-disabled': true as const, tabIndex: -1, onClick: (event: { preventDefault: () => void }) => event.preventDefault() }
    : { 'data-tv-focusable': 'true', onClick: open };
}

function Icon({ mark }: { mark: AvailabilityMark }) {
  if (mark === 'partial') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5 1.5 21h21L12 2.5Z" fill="currentColor" />
        <path d="M12 9v5.5M12 17.2v.3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (mark === 'unavailable') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path d="M5.6 18.4 18.4 5.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.6M12 17.4v.2" stroke="#1b1500" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/**
 * The mark at the top left of a title that is not wholly held by a
 * reachable node: a red triangle for partial, a red crossed circle for
 * unavailable, a yellow question mark for unknown, with a tooltip saying
 * what it means. Nothing for a complete title, or one the server has not
 * described.
 */
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

/**
 * The marker's meaning, written out, for a page whose title cannot be
 * played: a remote has no tooltip, and the missing Play needs a reason.
 */
export function AvailabilityNote({ item }: { item: { availability?: Availability; availabilityMembers?: AvailabilityMembers; kind?: MediaKind } }) {
  if (!isUnavailable(item)) return null;
  return <p className="availability-note">{availabilityText('unavailable', item.kind, item.availabilityMembers)}</p>;
}

/** A page title's marker, for `MediaPageTitle`'s `leading`. */
export function titleMarker(item: { availability?: Availability; availabilityMembers?: AvailabilityMembers; kind?: MediaKind }) {
  return <AvailabilityMarker availability={item.availability} members={item.availabilityMembers} kind={item.kind} className="availability-inline availability-title" />;
}
