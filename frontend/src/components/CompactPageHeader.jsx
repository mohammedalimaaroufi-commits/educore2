import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function CompactPageHeader({
  backTo,
  backLabel,
  backIcon = 'arrowLeft',
  eyebrow,
  title,
  subtitle,
  children,
  className = '',
  style,
}) {
  return (
    <header className={`compact-page-header ${className}`.trim()} style={style}>
      {backTo && (
        <Link
          to={backTo}
          className="compact-page-header__back"
          aria-label={backLabel}
          title={backLabel}
        >
          <Icon name={backIcon} className="w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
        </Link>
      )}
      <div className="compact-page-header__copy">
        {eyebrow && <span className="compact-page-header__eyebrow">{eyebrow}</span>}
        <h1 className="compact-page-header__title">{title}</h1>
        {subtitle && <p className="compact-page-header__subtitle">{subtitle}</p>}
      </div>
      {children && <div className="compact-page-header__aside">{children}</div>}
    </header>
  );
}
