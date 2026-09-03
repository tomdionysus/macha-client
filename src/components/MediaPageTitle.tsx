import { AsyncIconButton } from './AsyncIconButton';
import { RefreshIcon } from './ManageIcons';

interface Props {
  children: string;
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}

export function MediaPageTitle({ children, refreshing, onRefresh, className = '' }: Props) {
  return <div className={`media-page-title-row${className ? ` ${className}` : ''}`}>
    <h1>{children}</h1>
    <AsyncIconButton label={`Refresh ${children}`} busy={refreshing} onClick={onRefresh} icon={<RefreshIcon />} />
  </div>;
}
