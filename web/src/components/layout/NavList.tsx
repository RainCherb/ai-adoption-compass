import { ROUTES, type RouteId, hrefFor } from "../../lib/routes";
import { Icon } from "../ui/Icon";

interface NavListProps {
  route: RouteId;
  onNavigate?: () => void;
}

export function NavList({ route, onNavigate }: NavListProps) {
  return (
    <ul className="nav-list">
      {ROUTES.map((item) => (
        <li key={item.id}>
          <a
            className="nav-link"
            href={hrefFor(item.id)}
            aria-current={item.id === route ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
