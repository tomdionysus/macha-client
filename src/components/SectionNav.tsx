import { NavLink } from 'react-router-dom';

export interface SectionNavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface Props {
  ariaLabel: string;
  items: readonly SectionNavItem[];
}

export function SectionNav({ ariaLabel, items }: Props) {
  return (
    <nav className="section-subnav" aria-label={ariaLabel}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          data-tv-focusable="true"
          className={({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
