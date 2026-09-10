import type { SVGProps } from "react";
import {
  AiScan,
  ArrowLeft as PxArrowLeft,
  ArrowUp as PxArrowUp,
  ArrowsHorizontal,
  Cancel,
  Check as PxCheck,
  ChevronDown as PxChevronDown,
  ChevronUp as PxChevronUp,
  Close,
  CloudServer,
  Copy as PxCopy,
  Download as PxDownload,
  ExternalLink as PxExternalLink,
  File as PxFile,
  FileText as PxFileText,
  Folder as PxFolder,
  Gear,
  Globe as PxGlobe,
  CircleQuestion,
  Home as PxHome,
  Key as PxKey,
  Label,
  Layout,
  Lock as PxLock,
  Logout,
  Minus as PxMinus,
  Pencil as PxPencil,
  Play as PxPlay,
  Plus as PxPlus,
  Refresh,
  Save as PxSave,
  Script,
  Search as PxSearch,
  Server as PxServer,
  Spinner,
  Square as PxSquare,
  Terminal as PxTerminal,
  Trash as PxTrash,
  Tree,
  Upload as PxUpload,
  Usb,
  User as PxUser,
  WarningDiamond,
  Zap as PxZap,
} from "pixelarticons/react";
import type { IconName } from "./hugeiconsPack";
import type { AppIconProps } from "./types";

type PxComponent = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

/** Keep pixels crisp; never smaller than 24 in UI chrome. */
function snapPixelSize(size: number): number {
  if (size <= 28) return 24;
  if (size <= 54) return 48;
  return Math.round(size / 24) * 24 || 24;
}

function makePixel(PxIcon: PxComponent, displayName: string) {
  function Icon({
    size = 16,
    strokeWidth: _strokeWidth,
    className,
    color = "currentColor",
    style,
  }: AppIconProps) {
    void _strokeWidth;
    const px = snapPixelSize(size);
    return (
      <PxIcon
        width={px}
        height={px}
        className={className}
        color={color}
        style={{
          imageRendering: "pixelated",
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const pixelartPack: Record<IconName, (props: AppIconProps) => React.JSX.Element> = {
  AlertTriangle: makePixel(WarningDiamond, "AlertTriangle"),
  ArrowLeft: makePixel(PxArrowLeft, "ArrowLeft"),
  ArrowLeftRight: makePixel(ArrowsHorizontal, "ArrowLeftRight"),
  ArrowUp: makePixel(PxArrowUp, "ArrowUp"),
  Check: makePixel(PxCheck, "Check"),
  ChevronDown: makePixel(PxChevronDown, "ChevronDown"),
  ChevronUp: makePixel(PxChevronUp, "ChevronUp"),
  Columns2: makePixel(Layout, "Columns2"),
  Copy: makePixel(PxCopy, "Copy"),
  Download: makePixel(PxDownload, "Download"),
  EthernetPort: makePixel(Usb, "EthernetPort"),
  ExternalLink: makePixel(PxExternalLink, "ExternalLink"),
  File: makePixel(PxFile, "File"),
  FileCode: makePixel(Script, "FileCode"),
  FileKey: makePixel(PxLock, "FileKey"),
  FileKey2: makePixel(PxKey, "FileKey2"),
  FileText: makePixel(PxFileText, "FileText"),
  Fingerprint: makePixel(AiScan, "Fingerprint"),
  Folder: makePixel(PxFolder, "Folder"),
  FolderTree: makePixel(Tree, "FolderTree"),
  FolderX: makePixel(Cancel, "FolderX"),
  Globe: makePixel(PxGlobe, "Globe"),
  HardDriveUpload: makePixel(CloudServer, "HardDriveUpload"),
  HelpCircle: makePixel(CircleQuestion, "HelpCircle"),
  Home: makePixel(PxHome, "Home"),
  KeyRound: makePixel(PxKey, "KeyRound"),
  Loader2: makePixel(Spinner, "Loader2"),
  Lock: makePixel(PxLock, "Lock"),
  LogOut: makePixel(Logout, "LogOut"),
  Minus: makePixel(PxMinus, "Minus"),
  Network: makePixel(PxServer, "Network"),
  Pencil: makePixel(PxPencil, "Pencil"),
  Play: makePixel(PxPlay, "Play"),
  Plus: makePixel(PxPlus, "Plus"),
  RefreshCw: makePixel(Refresh, "RefreshCw"),
  Save: makePixel(PxSave, "Save"),
  Search: makePixel(PxSearch, "Search"),
  Server: makePixel(PxServer, "Server"),
  Settings: makePixel(Gear, "Settings"),
  Square: makePixel(PxSquare, "Square"),
  SquareTerminal: makePixel(PxTerminal, "SquareTerminal"),
  Tag: makePixel(Label, "Tag"),
  Tick: makePixel(PxCheck, "Tick"),
  TerminalSquare: makePixel(PxTerminal, "TerminalSquare"),
  Trash2: makePixel(PxTrash, "Trash2"),
  Upload: makePixel(PxUpload, "Upload"),
  User: makePixel(PxUser, "User"),
  X: makePixel(Close, "X"),
  WindowClose: makePixel(Close, "WindowClose"),
  Zap: makePixel(PxZap, "Zap"),
};
