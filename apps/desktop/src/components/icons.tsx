import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { CSSProperties } from "react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftRightIcon,
  ArrowUp01Icon,
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
  Upload04Icon,
  UsbIcon,
  UserIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";

export type AppIconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
  color?: string;
  style?: CSSProperties;
};

function makeIcon(icon: IconSvgElement, displayName: string) {
  function Icon({
    size = 16,
    strokeWidth = 1.75,
    className,
    color = "currentColor",
    style,
  }: AppIconProps) {
    return (
      <HugeiconsIcon
        icon={icon}
        size={size}
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

export type AppIcon = ReturnType<typeof makeIcon>;

export const ArrowLeft = makeIcon(ArrowLeft01Icon, "ArrowLeft");
export const ArrowLeftRight = makeIcon(ArrowLeftRightIcon, "ArrowLeftRight");
export const ArrowUp = makeIcon(ArrowUp01Icon, "ArrowUp");
export const Check = makeIcon(CheckmarkCircle02Icon, "Check");
export const ChevronDown = makeIcon(ArrowDown01Icon, "ChevronDown");
export const ChevronUp = makeIcon(ArrowUp01Icon, "ChevronUp");
export const Columns2 = makeIcon(LayoutTwoColumnIcon, "Columns2");
export const Copy = makeIcon(ClipboardCopyIcon, "Copy");
export const Download = makeIcon(Download01Icon, "Download");
export const EthernetPort = makeIcon(UsbIcon, "EthernetPort");
export const ExternalLink = makeIcon(ExternalLinkIcon, "ExternalLink");
export const File = makeIcon(File01Icon, "File");
export const FileCode = makeIcon(FileCodeIcon, "FileCode");
export const FileKey = makeIcon(FolderKeyIcon, "FileKey");
export const FileKey2 = makeIcon(DownloadCircle01Icon, "FileKey2");
export const FileText = makeIcon(FileTextIcon, "FileText");
export const Fingerprint = makeIcon(FingerPrintScanIcon, "Fingerprint");
export const Folder = makeIcon(Folder01Icon, "Folder");
export const FolderTree = makeIcon(FolderTreeIcon, "FolderTree");
export const FolderX = makeIcon(FolderOffIcon, "FolderX");
export const Globe = makeIcon(Globe02Icon, "Globe");
export const HardDriveUpload = makeIcon(CloudUploadIcon, "HardDriveUpload");
export const Home = makeIcon(Home01Icon, "Home");
export const KeyRound = makeIcon(Key02Icon, "KeyRound");
export const Loader2 = makeIcon(Loading03Icon, "Loader2");
export const Lock = makeIcon(SquareLock02Icon, "Lock");
export const LogOut = makeIcon(Logout01Icon, "LogOut");
export const Minus = makeIcon(MinusSignIcon, "Minus");
export const Network = makeIcon(NetworkIcon, "Network");
export const Pencil = makeIcon(Edit02Icon, "Pencil");
export const Play = makeIcon(PlayIcon, "Play");
export const Plus = makeIcon(Add01Icon, "Plus");
export const RefreshCw = makeIcon(Refresh01Icon, "RefreshCw");
export const Save = makeIcon(FloppyDiskIcon, "Save");
export const Search = makeIcon(Search01Icon, "Search");
export const Server = makeIcon(ServerStackIcon, "Server");
export const Settings = makeIcon(Settings01Icon, "Settings");
export const Square = makeIcon(SquareIcon, "Square");
export const SquareTerminal = makeIcon(SquareTerminalIcon, "SquareTerminal");
export const Tag = makeIcon(Tag01Icon, "Tag");
export const TerminalSquare = makeIcon(ComputerTerminalIcon, "TerminalSquare");
export const Trash2 = makeIcon(Delete03Icon, "Trash2");
export const Upload = makeIcon(Upload04Icon, "Upload");
export const User = makeIcon(UserIcon, "User");
export const X = makeIcon(CancelCircleIcon, "X");
export const Zap = makeIcon(ZapIcon, "Zap");
