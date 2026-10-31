import type { ReactNode, SVGProps } from "react";

/**
 * Line icons for the New and Minimal interfaces: 24px grid, 1.6 stroke,
 * drawn at 16px. One family so the workbench never mixes icon weights.
 */
export interface WbIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
}

export type WbIcon = ((props: WbIconProps) => ReactNode) & { displayName?: string };

function make(name: string, body: ReactNode): WbIcon {
  function Icon({ size = 16, className, ...rest }: WbIconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden
        focusable={false}
        className={className ? `wb-i ${className}` : "wb-i"}
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `Wb${name}`;
  return Icon;
}

export const WbSearch = make(
  "Search",
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const WbPlus = make("Plus", <path d="M12 5v14M5 12h14" />);
export const WbClose = make("Close", <path d="M6 6l12 12M18 6 6 18" />);
export const WbChevronRight = make("ChevronRight", <path d="m9 6 6 6-6 6" />);
export const WbChevronLeft = make("ChevronLeft", <path d="m15 6-6 6 6 6" />);
export const WbChevronDown = make("ChevronDown", <path d="m6 9 6 6 6-6" />);
export const WbTerminal = make(
  "Terminal",
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </>,
);
export const WbFolder = make(
  "Folder",
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
);
export const WbFile = make(
  "File",
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>,
);
export const WbChat = make(
  "Chat",
  <>
    <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    <path d="M8 10h8M8 13h5" />
  </>,
);
export const WbForward = make("Forward", <path d="M4 9h14l-3-3M20 15H6l3 3" />);
export const WbSnippet = make("Snippet", <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 6l-2 12" />);
export const WbSplit = make(
  "Split",
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </>,
);
export const WbKey = make(
  "Key",
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
  </>,
);
export const WbGear = make(
  "Gear",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
  </>,
);
export const WbServer = make(
  "Server",
  <>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </>,
);
export const WbUpload = make("Upload", <path d="M12 19V5M6 11l6-6 6 6" />);
export const WbDownload = make("Download", <path d="M12 5v14M6 13l6 6 6-6" />);
export const WbRefresh = make("Refresh", <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />);
export const WbMic = make(
  "Mic",
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const WbSend = make("Send", <path d="M5 12h14M13 6l6 6-6 6" />);
export const WbCopy = make(
  "Copy",
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </>,
);
export const WbInsert = make("Insert", <path d="M4 12h12M12 8l4 4-4 4M20 5v14" />);
export const WbLock = make(
  "Lock",
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);
export const WbMinimize = make("Minimize", <path d="M6 12h12" />);
export const WbMaximize = make("Maximize", <rect x="6" y="6" width="12" height="12" rx="1" />);
export const WbImport = make("Import", <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />);
export const WbBatch = make(
  "Batch",
  <>
    <rect x="3" y="4" width="8" height="7" rx="1" />
    <rect x="13" y="4" width="8" height="7" rx="1" />
    <rect x="3" y="13" width="8" height="7" rx="1" />
    <rect x="13" y="13" width="8" height="7" rx="1" />
  </>,
);
export const WbCheck = make("Check", <path d="m5 12 5 5 9-10" />);
export const WbPalette = make(
  "Palette",
  <>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-1 .2-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="12" cy="7.5" r="1" />
    <circle cx="16.5" cy="11" r="1" />
  </>,
);
export const WbWarn = make(
  "Warn",
  <>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17h.01" />
  </>,
);
export const WbShield = make("Shield", <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />);
export const WbInfo = make(
  "Info",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);
export const WbCloud = make(
  "Cloud",
  <path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z" />,
);
export const WbWave = make("Wave", <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" />);
