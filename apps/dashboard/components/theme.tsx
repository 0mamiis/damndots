"use client";
import { Button, Toast } from "@heroui/react";
import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./icons";
type Theme = "light" | "dark";
const KEY = "dots-theme";
function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
/** Runs before hydration so the saved or system theme never flashes. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.dataset.theme=t;r.style.colorScheme=t}catch(e){}})()`;
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      aria-label={next === "dark" ? "Koyu temaya geç" : "Açık temaya geç"}
      onPress={() => {
        apply(next);
        setTheme(next);
        try {
          localStorage.setItem(KEY, next);
        } catch {}
      }}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
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
      {armed && <Toast.Provider placement="bottom end" aria-label="Bildirimler" />}
    </>
  );
}
