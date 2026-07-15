import { useEffect, useRef, useState } from "react";
import { isSoundOn, setSoundOn } from "../../audio";
import { generate } from "../../../shared/procgen.ts";
import { spriteToSvg } from "../../../shared/petSvg.ts";

type SessionUser = { email?: string; first_name?: string };
type HeaderAccount = {
  billing?: { tier?: string };
  github?: { login?: string; avatarSeed?: string | null } | null;
};
type ThemeChoice = "light" | "dark";
const THEME_KEY = "renown:theme";

const PetAvatar = ({ seed }: { seed: string }) => {
  const { svg, width, height } = spriteToSvg(generate(seed), { box: 28 });
  return <span dangerouslySetInnerHTML={{ __html: `<svg width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="display:block">${svg}</svg>` }} />;
};

export const HeaderAccountMenu = () => {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [session, setSession] = useState<{ user: SessionUser; account: HeaderAccount } | null | undefined>(undefined);
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    const initial: ThemeChoice = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    setSound(isSoundOn());

    const controller = new AbortController();
    void fetch("/oauth2/status", { credentials: "include", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then(async (status: { user?: SessionUser } | null) => {
        if (!status?.user) { setSession(null); return; }
        const response = await fetch("/api/account/", { credentials: "include", signal: controller.signal });
        if (!response.ok) { setSession(null); return; }
        setSession({ user: status.user, account: await response.json() as HeaderAccount });
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setSession(null); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") menuRef.current?.removeAttribute("open"); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);

  const chooseTheme = (next: ThemeChoice) => {
    setTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
  };
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundOn(next);
  };

  if (session === undefined) return <span className="headerAccountSlot" aria-hidden />;
  if (!session) return <a className="btn solid sm headerLogin" href="/?view=account">Log in</a>;

  const { user, account } = session;
  const login = account.github?.login;
  const label = login ? `@${login}` : user.first_name || user.email || "Account";
  return (
    <details className="accountMenu" ref={menuRef}>
      <summary aria-label="Open account menu">
        <span className="accountAvatar" aria-hidden>{account.github?.avatarSeed ? <PetAvatar seed={account.github.avatarSeed} /> : label.slice(0, 1).toUpperCase()}</span>
        <span className="accountMenuName">{label}</span>
        <span className="accountChevron" aria-hidden>⌄</span>
      </summary>
      <div className="accountMenuPanel">
        <div className="accountMenuIdentity"><strong>{label}</strong><span>{user.email ?? `${account.billing?.tier ?? "free"} plan`}</span></div>
        {login && <a href={`/profile/${encodeURIComponent(login)}`}><span aria-hidden>◉</span><span>Profile</span></a>}
        <a href="/?view=account"><span aria-hidden>⚙</span><span>Account &amp; plans</span></a>
        {login && <a href={`/quests/${encodeURIComponent(login)}`}><span aria-hidden>◆</span><span>Quests</span></a>}
        {login && <a href={`/rivals/${encodeURIComponent(login)}`}><span aria-hidden>↗</span><span>Rivals</span></a>}
        <div className="accountMenuDivider" />
        <div className="themeRow"><span>Appearance</span><div role="group" aria-label="Color theme"><button className={theme === "light" ? "on" : ""} onClick={() => chooseTheme("light")}>Light</button><button className={theme === "dark" ? "on" : ""} onClick={() => chooseTheme("dark")}>Dark</button></div></div>
        <button onClick={toggleSound}><span aria-hidden>{sound ? "🔊" : "🔇"}</span><span>{sound ? "Sound on" : "Sound off"}</span></button>
        <div className="accountMenuDivider" />
        <button className="accountLogout" onClick={() => { void fetch("/oauth2/signout", { method: "DELETE", credentials: "include" }).finally(() => { window.location.href = "/"; }); }}><span aria-hidden>↪</span><span>Log out</span></button>
      </div>
    </details>
  );
};
