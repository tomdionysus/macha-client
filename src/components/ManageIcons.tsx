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

export function FileIcon(props: IconProps) {
  return <Svg {...props}><path d="M6 3.5h8l4 4v13H6v-17Zm8 0v4h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></Svg>;
}
