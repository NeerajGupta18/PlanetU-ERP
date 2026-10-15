import { NavLink, useLocation } from 'react-router-dom';
import { onPage } from '../../hooks/useNav.js';

/**
 * Tabs across the top of pages that share one menu item (for example Assignments, Quizzes and Learning under
 * "Coursework"), so the user can move between them without going back to the sidebar.
 */
export default function SectionTabs({ links }) {
  const { pathname } = useLocation();
  const item = links.find((i) => i.sections && i.sections.some((s) => onPage(pathname, s.to)));
  if (!item) return null;
  return (
    <nav className="section-tabs" aria-label={item.text}>
      {item.sections.map((s) => (
        <NavLink key={s.to} to={s.to} className={() => `section-tabs__item ${onPage(pathname, s.to) ? 'is-active' : ''}`}>{s.text}</NavLink>
      ))}
    </nav>
  );
}
