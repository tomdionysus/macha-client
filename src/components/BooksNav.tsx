import { routes } from '@machafoundation/core';
import { SectionNav } from './SectionNav';

const items = [
  { to: routes.bookTitles, label: 'Titles' },
  { to: routes.bookAuthors, label: 'Authors' },
  { to: routes.bookSeriesList, label: 'Series' },
] as const;

export function BooksNav() {
  return <SectionNav ariaLabel="Books navigation" items={items} />;
}
