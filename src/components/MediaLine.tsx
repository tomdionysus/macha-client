/** How a media line's fields are joined. The fields and their labels are core's. */
export const MEDIA_LINE_SEPARATOR = ' · ';

/** A file's technical summary on one line, from core's `technicalSummary(...).parts`. Wraps only between fields. */
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
