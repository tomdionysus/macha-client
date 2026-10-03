import type { ReactNode } from 'react';
import { AsyncIconButton } from './AsyncIconButton';
import { RefreshIcon } from './ManageIcons';

interface Props {
  children: string;
  /** Shown before the title inside the heading, such as its availability marker. */
  leading?: ReactNode;
  refreshing?: boolean;
  /** Absent when the page puts its refresh control elsewhere, as Search does. */
  onRefresh?: () => void;
  className?: string;
}

export function MediaPageTitle({ children, leading, refreshing = false, onRefresh, className = '' }: Props) {
  return <div className={`media-page-title-row${className ? ` ${className}` : ''}`}>
    <h1>{leading}{children}</h1>
    {onRefresh && <AsyncIconButton label={`Refresh ${children}`} busy={refreshing} onClick={onRefresh} icon={<RefreshIcon />} />}
  </div>;
}
