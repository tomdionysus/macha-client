import type { ReactNode } from 'react';

interface IconProps { className?: string }

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">{children}</svg>;
}

export function UpIcon(props: IconProps) {
  return <Svg {...props}><path d="m5 14 7-7 7 7M12 7v11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

export function RefreshIcon(props: IconProps) {
  return <Svg {...props}><path d="M19 7v5h-5M5 17v-5h5M18.2 10A7 7 0 0 0 6.8 6.8L5 9m14 6-1.8 2.2A7 7 0 0 1 5.8 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

export function OpenIcon(props: IconProps) {
  return <Svg {...props}><path d="M14 5h5v5M19 5l-8 8M17 13v5H6V7h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

export function FolderIcon(props: IconProps) {
  return <Svg {...props}><path d="M3.5 6.5h6l2 2h9v9h-17v-11Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></Svg>;
}

export function SettingsIcon(props: IconProps) {
  // A toothed gear, not a disc with rays: radiating straight lines read as
  // brightness. The outline is the tooth profile itself, so the teeth survive
  // at 18px where separate spokes would blur into a sun.
  return <Svg {...props}>
    <path
      d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58Z"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </Svg>;
}

export function FileIcon(props: IconProps) {
  return <Svg {...props}><path d="M6 3.5h8l4 4v13H6v-17Zm8 0v4h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></Svg>;
}
