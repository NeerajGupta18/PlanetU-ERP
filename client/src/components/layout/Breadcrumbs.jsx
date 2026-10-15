import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_HOME } from '../../config/menu.config.js';

/** Home > Group > Page (> Details). Hidden on the dashboard itself. */
export default function Breadcrumbs({ flat }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const home = ROLE_HOME[user.role];
  if (pathname === home) return null;

  const item = [...flat].sort((a, b) => b.to.length - a.to.length).find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  if (!item) return null;
  const deeper = pathname !== item.to;

  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to={home} aria-label="Home"><Home size={13} /></Link>
      {item.group && <><ChevronRight size={12} /><span>{item.group}</span></>}
      {item.parent && <><ChevronRight size={12} /><Link to={item.parentTo}>{item.parent}</Link></>}
      <ChevronRight size={12} />
      {deeper ? <Link to={item.to}>{item.text}</Link> : <strong aria-current="page">{item.text}</strong>}
      {deeper && <><ChevronRight size={12} /><strong aria-current="page">Details</strong></>}
    </nav>
  );
}
