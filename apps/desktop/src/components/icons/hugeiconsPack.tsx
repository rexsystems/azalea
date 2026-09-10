import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftRightIcon,
  ArrowUp01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  ClipboardCopyIcon,
  CloudUploadIcon,
  ComputerTerminalIcon,
  Delete03Icon,
  Download01Icon,
  DownloadCircle01Icon,
  Edit02Icon,
  ExternalLinkIcon,
  File01Icon,
  FileCodeIcon,
  FileTextIcon,
  FingerPrintScanIcon,
  FloppyDiskIcon,
  Folder01Icon,
  FolderKeyIcon,
  FolderOffIcon,
  FolderTreeIcon,
  Globe02Icon,
  Home01Icon,
  Key02Icon,
  LayoutTwoColumnIcon,
  Loading03Icon,
  Logout01Icon,
  MinusSignIcon,
  NetworkIcon,
  PlayIcon,
  Refresh01Icon,
  Search01Icon,
  ServerStackIcon,
  Settings01Icon,
  SquareIcon,
  SquareLock02Icon,
  SquareTerminalIcon,
  Tag01Icon,
  Tick01Icon,
  Upload04Icon,
  UsbIcon,
  UserIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import type { AppIconProps } from "./types";

function makeHuge(icon: IconSvgElement, displayName: string) {
  function Icon({
    size = 16,
    strokeWidth = 1.75,
    className,
    color = "currentColor",
    style,
  }: AppIconProps) {
    const resolved = Math.max(size, 15);
    return (
      <HugeiconsIcon
        icon={icon}
        size={resolved}
        strokeWidth={strokeWidth}
        className={className}
        color={color}
        style={style}
      />
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const hugeiconsPack = {
  AlertTriangle: makeHuge(Alert02Icon, "AlertTriangle"),
  ArrowLeft: makeHuge(ArrowLeft01Icon, "ArrowLeft"),
  ArrowLeftRight: makeHuge(ArrowLeftRightIcon, "ArrowLeftRight"),
  ArrowUp: makeHuge(ArrowUp01Icon, "ArrowUp"),
  Check: makeHuge(CheckmarkCircle02Icon, "Check"),
  ChevronDown: makeHuge(ArrowDown01Icon, "ChevronDown"),
  ChevronUp: makeHuge(ArrowUp01Icon, "ChevronUp"),
  Columns2: makeHuge(LayoutTwoColumnIcon, "Columns2"),
  Copy: makeHuge(ClipboardCopyIcon, "Copy"),
  Download: makeHuge(Download01Icon, "Download"),
  EthernetPort: makeHuge(UsbIcon, "EthernetPort"),
  ExternalLink: makeHuge(ExternalLinkIcon, "ExternalLink"),
  File: makeHuge(File01Icon, "File"),
  FileCode: makeHuge(FileCodeIcon, "FileCode"),
  FileKey: makeHuge(FolderKeyIcon, "FileKey"),
  FileKey2: makeHuge(DownloadCircle01Icon, "FileKey2"),
  FileText: makeHuge(FileTextIcon, "FileText"),
  Fingerprint: makeHuge(FingerPrintScanIcon, "Fingerprint"),
  Folder: makeHuge(Folder01Icon, "Folder"),
  FolderTree: makeHuge(FolderTreeIcon, "FolderTree"),
  FolderX: makeHuge(FolderOffIcon, "FolderX"),
  Globe: makeHuge(Globe02Icon, "Globe"),
  HardDriveUpload: makeHuge(CloudUploadIcon, "HardDriveUpload"),
  Home: makeHuge(Home01Icon, "Home"),
  KeyRound: makeHuge(Key02Icon, "KeyRound"),
  Loader2: makeHuge(Loading03Icon, "Loader2"),
  Lock: makeHuge(SquareLock02Icon, "Lock"),
  LogOut: makeHuge(Logout01Icon, "LogOut"),
  Minus: makeHuge(MinusSignIcon, "Minus"),
  Network: makeHuge(NetworkIcon, "Network"),
  Pencil: makeHuge(Edit02Icon, "Pencil"),
  Play: makeHuge(PlayIcon, "Play"),
  Plus: makeHuge(Add01Icon, "Plus"),
  RefreshCw: makeHuge(Refresh01Icon, "RefreshCw"),
  Save: makeHuge(FloppyDiskIcon, "Save"),
  Search: makeHuge(Search01Icon, "Search"),
  Server: makeHuge(ServerStackIcon, "Server"),
  Settings: makeHuge(Settings01Icon, "Settings"),
  Square: makeHuge(SquareIcon, "Square"),
  SquareTerminal: makeHuge(SquareTerminalIcon, "SquareTerminal"),
  Tag: makeHuge(Tag01Icon, "Tag"),
  Tick: makeHuge(Tick01Icon, "Tick"),
  TerminalSquare: makeHuge(ComputerTerminalIcon, "TerminalSquare"),
  Trash2: makeHuge(Delete03Icon, "Trash2"),
  Upload: makeHuge(Upload04Icon, "Upload"),
  User: makeHuge(UserIcon, "User"),
  X: makeHuge(CancelCircleIcon, "X"),
  WindowClose: makeHuge(Cancel01Icon, "WindowClose"),
  Zap: makeHuge(ZapIcon, "Zap"),
} as const;

export type IconName = keyof typeof hugeiconsPack;
