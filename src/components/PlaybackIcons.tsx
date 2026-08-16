interface IconProps {
  className?: string;
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M8 5.2v13.6L19 12 8 5.2Z" fill="currentColor" />
    </svg>
  );
}

export function RestartIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M7.1 7.2H3.7V3.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 7.1A8.2 8.2 0 1 1 3.9 17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M10 8.2v7.6l6-3.8-6-3.8Z" fill="currentColor" />
    </svg>
  );
}
