export function PageBanner({ icon: Icon, title, subtitle, actions }) {
  return (
    <header className="banner">
      <div className="banner__main">
        {Icon && <span className="banner__icon"><Icon size={22} /></span>}
        <div>
          <h1 className="banner__title">{title}</h1>
          {subtitle && <p className="banner__sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="banner__actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card__head">
          <h2 className="card__title">{Icon && <Icon size={17} />} {title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ value, label, icon: Icon, tone = 'indigo' }) {
  return (
    <div className={`stat stat--${tone}`}>
      <div>
        <div className="stat__value">{value}</div>
        <div className="stat__label">{label}</div>
      </div>
      {Icon && <Icon size={34} className="stat__icon" strokeWidth={1.5} />}
    </div>
  );
}

export const Badge = ({ tone = 'gray', children, className = '' }) => (
  <span className={`badge badge--${tone} ${className}`}>{children}</span>
);

export function Field({ label, children }) {
  return (
    <div className="field-view">
      <dt>{label}</dt>
      <dd>{children || '-'}</dd>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id} type="button" role="tab" aria-selected={active === id}
          className={`tabs__item ${active === id ? 'is-active' : ''}`} onClick={() => onChange(id)}
        >
          {Icon && <Icon size={15} />} {label}
        </button>
      ))}
    </div>
  );
}
