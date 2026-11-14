"use client";
import { Button, Toast } from "@heroui/react";
import { useEffect, useState } from "react";
import { AutoIcon, MoonIcon, SunIcon } from "./icons";
type Theme = "light" | "dark" | "auto";
const KEY = "dots-theme";
const systemTheme = (): "light" | "dark" => (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const resolveTheme = (theme: Theme): "light" | "dark" => (theme === "auto" ? systemTheme() : theme);
function apply(theme: Theme) {
  const root = document.documentElement, actual = resolveTheme(theme);
  root.classList.toggle("dark", actual === "dark");
  root.dataset.theme = actual;
  root.dataset.themePreference = theme;
  root.style.colorScheme = actual;
}
const cycle: Record<Theme, Theme> = { light: "dark", dark: "auto", auto: "light" };
const label: Record<Theme, string> = { light: "Light theme. Switch to the dark theme.", dark: "Dark theme. Switch to the system theme.", auto: "System theme. Switch to the light theme." };
/** Runs before hydration so the saved or system theme never flashes. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"&&t!=="auto")t="auto";var d=t==="auto"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;var r=document.documentElement;r.classList.toggle("dark",d==="dark");r.dataset.theme=d;r.dataset.themePreference=t;r.style.colorScheme=d}catch(e){}})()`;
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    setTheme(stored === "light" || stored === "dark" ? stored : "auto");
  }, []);
  // While the system theme is selected, follow the operating system live.
  useEffect(() => {
    if (theme !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => apply("auto");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const current = theme ?? "auto", next = cycle[current];
  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      aria-label={label[current]}
      onPress={() => {
        apply(next);
        setTheme(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {}
      }}
    >
      {current === "dark" ? <SunIcon /> : current === "light" ? <MoonIcon /> : <AutoIcon />}
    </Button>
  );
}
export const TOAST_EVENT = "dots-toast";
/** The toast region is mounted on the first notification, so an empty live region never sits in the page. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const arm = () => setArmed(true);
    window.addEventListener(TOAST_EVENT, arm);
    return () => window.removeEventListener(TOAST_EVENT, arm);
  }, []);
  return (
    <>
      {children}
      {armed && <Toast.Provider placement="bottom end" aria-label="Notifications" />}
    </>
  );
}

