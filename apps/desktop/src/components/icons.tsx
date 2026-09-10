import type { JSX } from "react";
import type { AppIconProps } from "./icons/types";
import { hugeiconsPack, type IconName } from "./icons/hugeiconsPack";
import { pixelartPack } from "./icons/pixelartPack";
import { useIconPack } from "./IconPackProvider";

export type { AppIconProps };
export type AppIcon = (props: AppIconProps) => JSX.Element;

function makePackIcon(name: IconName, displayName: string): AppIcon {
  function Icon(props: AppIconProps) {
    const { iconPack } = useIconPack();
    const Impl = iconPack === "pixelart" ? pixelartPack[name] : hugeiconsPack[name];
    return <Impl {...props} />;
  }
  Icon.displayName = displayName;
  return Icon;
}

export const AlertTriangle = makePackIcon("AlertTriangle", "AlertTriangle");
export const ArrowLeft = makePackIcon("ArrowLeft", "ArrowLeft");
export const ArrowLeftRight = makePackIcon("ArrowLeftRight", "ArrowLeftRight");
export const ArrowUp = makePackIcon("ArrowUp", "ArrowUp");
export const Check = makePackIcon("Check", "Check");
export const ChevronDown = makePackIcon("ChevronDown", "ChevronDown");
export const ChevronUp = makePackIcon("ChevronUp", "ChevronUp");
export const Columns2 = makePackIcon("Columns2", "Columns2");
export const Copy = makePackIcon("Copy", "Copy");
export const Download = makePackIcon("Download", "Download");
export const EthernetPort = makePackIcon("EthernetPort", "EthernetPort");
export const ExternalLink = makePackIcon("ExternalLink", "ExternalLink");
export const File = makePackIcon("File", "File");
export const FileCode = makePackIcon("FileCode", "FileCode");
export const FileKey = makePackIcon("FileKey", "FileKey");
export const FileKey2 = makePackIcon("FileKey2", "FileKey2");
export const FileText = makePackIcon("FileText", "FileText");
export const Fingerprint = makePackIcon("Fingerprint", "Fingerprint");
export const Folder = makePackIcon("Folder", "Folder");
export const FolderTree = makePackIcon("FolderTree", "FolderTree");
export const FolderX = makePackIcon("FolderX", "FolderX");
export const Globe = makePackIcon("Globe", "Globe");
export const HardDriveUpload = makePackIcon("HardDriveUpload", "HardDriveUpload");
export const Home = makePackIcon("Home", "Home");
export const KeyRound = makePackIcon("KeyRound", "KeyRound");
export const Loader2 = makePackIcon("Loader2", "Loader2");
export const Lock = makePackIcon("Lock", "Lock");
export const LogOut = makePackIcon("LogOut", "LogOut");
export const Minus = makePackIcon("Minus", "Minus");
export const Network = makePackIcon("Network", "Network");
export const Pencil = makePackIcon("Pencil", "Pencil");
export const Play = makePackIcon("Play", "Play");
export const Plus = makePackIcon("Plus", "Plus");
export const RefreshCw = makePackIcon("RefreshCw", "RefreshCw");
export const Save = makePackIcon("Save", "Save");
export const Search = makePackIcon("Search", "Search");
export const Server = makePackIcon("Server", "Server");
export const Settings = makePackIcon("Settings", "Settings");
export const Square = makePackIcon("Square", "Square");
export const SquareTerminal = makePackIcon("SquareTerminal", "SquareTerminal");
export const Tag = makePackIcon("Tag", "Tag");
export const Tick = makePackIcon("Tick", "Tick");
export const TerminalSquare = makePackIcon("TerminalSquare", "TerminalSquare");
export const Trash2 = makePackIcon("Trash2", "Trash2");
export const Upload = makePackIcon("Upload", "Upload");
export const User = makePackIcon("User", "User");
export const X = makePackIcon("X", "X");
/** Plain X for window chrome (no circle). */
export const WindowClose = makePackIcon("WindowClose", "WindowClose");
export const Zap = makePackIcon("Zap", "Zap");
