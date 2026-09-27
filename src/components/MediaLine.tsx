import { MEDIA_LINE_SEPARATOR } from '../text/mediaLines';

/**
 * A media line that wraps only between its fields: "926 kbps" or "2h 31m"
 * never breaks across two lines on a narrow column, which the phone found in
 * its player and every client now does alike.
 */
export function MediaLine({ line, className }: { line: string; className?: string }) {
  const fields = line.split(MEDIA_LINE_SEPARATOR);
  return (
    <p className={className}>
      {fields.map((field, index) => (
        <span key={index}>
          <span className="media-line-field">{field}</span>
          {index < fields.length - 1 ? MEDIA_LINE_SEPARATOR : null}
        </span>
      ))}
    </p>
  );
}
