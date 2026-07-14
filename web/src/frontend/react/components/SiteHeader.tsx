import type { MouseEvent, ReactNode } from "react";

export type SiteSection = "home" | "leaderboard" | "pets" | "achievements" | "season" | "guide";
export type BackTarget = { href: string; label: string };

const PRIMARY: { id: SiteSection; label: string; href: string }[] = [
  { id: "home", label: "Home", href: "/" },
  { id: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
  { id: "pets", label: "Collection", href: "/pets" },
  { id: "achievements", label: "Achievements", href: "/achievements" },
];
const MORE: { id: SiteSection; label: string; href: string }[] = [
  { id: "season", label: "Season", href: "/season" },
  { id: "guide", label: "Setup guide", href: "/guide" },
];

export const Logomark = ({ size = 24 }: { size?: number }) => (
  <svg className="logo" viewBox="0 0 300 300" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M66.4,274.3c68.4,46.3,161.5,28.4,207.8-40,46.3-68.4,28.4-161.5-40-207.8C165.8-19.9,72.7-2,26.4,66.4-19.9,134.9-2,227.9,66.4,274.3ZM48,116.7c-17.1,52.6-11.4,105.2,11.3,139.7C18,217.4,7.3,150.3,36.9,92.3,55.9,55.2,87.6,29.4,122.5,18.3c-31.9,18.4-59.9,53.5-74.5,98.3ZM175.3,283.1c36-10.5,68.9-36.8,88.3-74.8,29.4-57.5,19.1-123.9-21.3-163.1,21.8,34.5,27,86.3,10.2,138-15,46.1-44.2,82-77.3,99.8ZM183.6,266.2c24.3-20.8,44.4-55.6,53.3-97.4,14.1-66.1-4.4-127.6-41.8-148.1,19.9,26.7,29.9,78.6,23.7,136.7-4.7,44.4-18,83.3-35.2,108.9ZM63.7,131.8c-14.2,66.6,4.7,128.5,42.7,148.6-20.4-26.4-30.8-78.9-24.5-137.7,4.7-43.7,17.6-82,34.3-107.6-24,20.9-43.7,55.4-52.5,96.7ZM199.8,149.6c1.1,67.9-20.2,123.3-47.6,123.7-27.4.4-50.4-54.3-51.5-122.2-1.1-67.9,20.2-123.3,47.6-123.7,27.4-.4,50.4,54.3,51.5,122.2Z" />
  </svg>
);

const SmartBack = ({ target, mobile = false }: { target: BackTarget; mobile?: boolean }) => {
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      if (referrer?.origin === window.location.origin && referrer.href !== window.location.href) {
        event.preventDefault();
        window.history.back();
      }
    } catch { /* malformed referrer: use the contextual href */ }
  };
  return <a className={mobile ? "mobileBack" : "headerBack"} href={target.href} aria-label={target.label} title={target.label} onClick={goBack}>← Back</a>;
};

export const SiteHeader = ({ current, back, trailing }: { current?: SiteSection; back?: BackTarget; trailing?: ReactNode }) => {
  const moreActive = current === "season" || current === "guide";
  return (
    <header className="topbar siteHeader">
      <a className="brand" href="/"><Logomark /><span>Renown</span></a>
      <nav className="nav primaryNav" aria-label="Primary navigation">
        {PRIMARY.map((item) => <a key={item.id} className={current === item.id ? "on" : ""} href={item.href}>{item.label}</a>)}
        <details className={`moreMenu${moreActive ? " isActive" : ""}`}>
          <summary>More <span aria-hidden>⌄</span></summary>
          <div>{MORE.map((item) => <a key={item.id} className={current === item.id ? "on" : ""} href={item.href}>{item.label}</a>)}</div>
        </details>
      </nav>
      <div className="authbox">{back && <SmartBack target={back} />}{trailing}</div>
      <details className="mobileNav">
        <summary aria-label="Open navigation"><span aria-hidden>☰</span></summary>
        <nav aria-label="Mobile navigation">
          {back && <SmartBack target={back} mobile />}
          {[...PRIMARY, ...MORE].map((item) => <a key={item.id} className={current === item.id ? "on" : ""} href={item.href}>{item.label}</a>)}
        </nav>
      </details>
    </header>
  );
};
