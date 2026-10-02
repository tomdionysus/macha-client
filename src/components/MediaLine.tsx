/** How a media line's fields are joined. The fields and their labels are core's. */
export const MEDIA_LINE_SEPARATOR = ' · ';

/**
 * A file's technical summary as one line: core supplies the fields
 * (`technicalSummary(...).parts`) and this does the layout. It wraps only
 * between fields, so "926 kbps" or "2h 31m" never breaks across two lines on
 * a narrow column.
 */
export function MediaLine({ parts, className }: { parts: readonly string[]; className?: string }) {
  return (
    <p className={className}>
      {parts.map((field, index) => (
        <span key={index}>
          <span className="media-line-field">{field}</span>
          {index < parts.length - 1 ? MEDIA_LINE_SEPARATOR : null}
        </span>
      ))}
    </p>
  );
}
