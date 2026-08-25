import type { FooterItem } from "../../application/runtimeConfig";
import { englishUi } from "../../shared/localization/locale";

export interface AppFooterProps {
  items: readonly FooterItem[];
  identity?: string;
}

export function AppFooter({ items, identity = "" }: AppFooterProps): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <footer className="wb-footer" aria-label={englishUi.common.footer.navigationLabel}>
      {identity !== "" && (
        <span className="wb-footer__identity" aria-hidden="true">
          {identity}
        </span>
      )}
      <nav>
        <ul>
          {items.map((item) => {
            return (
              <li key={item.kind + ":" + item.url}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </footer>
  );
}
