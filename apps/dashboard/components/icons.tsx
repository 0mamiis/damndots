import type { SVGProps } from "react";
type Props = SVGProps<SVGSVGElement>;
function Icon({ children, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}
export const HomeIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v9.5h13V10" />
  </Icon>
);
export const DotIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    <circle cx="12" cy="12" r="8.5" />
  </Icon>
);
export const TaskIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />
  </Icon>
);
export const DownloadIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 4v11m0 0-4-4m4 4 4-4" />
    <path d="M5 19h14" />
  </Icon>
);
export const MemoryIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="4" y="5" width="16" height="14" rx="2.5" />
    <path d="M8 9h8M8 13h5" />
  </Icon>
);
export const ClockIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const ComputerIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="11" rx="2" />
    <path d="M9 19.5h6M12 15.5v4" />
  </Icon>
);
export const PlugIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M9 4v5M15 4v5" />
    <path d="M6.5 9h11v2.5a5.5 5.5 0 0 1-11 0z" />
    <path d="M12 17v3.5" />
  </Icon>
);
export const ShieldIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);
export const MicIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Icon>
);
export const GearIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
  </Icon>
);
export const SunIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Icon>
);
export const MoonIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />
  </Icon>
);
export const MenuIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const RefreshIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M20 6v5h-5M4 18v-5h5" />
    <path d="M18.4 11A7 7 0 0 0 6 7.5L4 10m2 3a7 7 0 0 0 12.4 3.5L20 14" />
  </Icon>
);
export const LogoutIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
    <path d="M14 8l4 4-4 4M18 12H9.5" />
  </Icon>
);
export const PlusIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const ChevronIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);
export const FileIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M7 3.5h6.5L18 8v12.5H7z" />
    <path d="M13 3.5V8h5" />
  </Icon>
);
export const SendIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 12 20 4l-6 16-2.5-6.5z" />
  </Icon>
);
export const PaperclipIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m19 11-7 7a4.5 4.5 0 0 1-6.4-6.4l7.5-7.5a3 3 0 0 1 4.2 4.2l-7.5 7.5a1.5 1.5 0 0 1-2.1-2.1L14 8" />
  </Icon>
);
