import type { KeyboardEvent, ReactNode, RefObject } from "react";
import type { FileEntry } from "@azalea/shared";
import { InspectorActions } from "./Inspector";
import {
  WbChevronRight,
  WbClose,
  WbDownload,
  WbFile,
  WbFolder,
  WbRefresh,
  WbSearch,
  WbUpload,
} from "./wbIcons";
import { formatSize } from "../../lib/fileSize";
import { formatSince } from "../../lib/relativeTime";

interface UploadProgress {
  filename: string;
  bytesDone: number;
  bytesTotal: number;
  startedAt: number;
}

interface WorkbenchFilesProps {
  panelRef: RefObject<HTMLDivElement | null>;
  overlays: ReactNode;
  contextMenu: ReactNode;
  path: string | null;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  filter: string;
  onFilterChange: (value: string) => void;
  selected: string | null;
  onSelect: (name: string) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onUpload: () => void;
  busy: boolean;
  pathEditing: boolean;
  onEditPath: () => void;
  pathInput: ReactNode;
  follow: boolean;
  onFollowChange: (on: boolean) => void;
  followAvailable: boolean;
  upload: UploadProgress | null;
  onCancelUpload: () => void;
  transfer: string | null;
  doneCount: number;
  notice: string | null;
}

/** Unix seconds, whether the server sent seconds or milliseconds. */
function mtimeSeconds(mtime: number | null): number | null {
  if (mtime == null || mtime <= 0) return null;
  return mtime < 1_000_000_000_000 ? mtime : Math.floor(mtime / 1000);
}

/** Cumulative paths for a breadcrumb: "/a/b" gives "/", "/a", "/a/b". */
function pathCrumbs(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ label: "/", path: "/" }];
  parts.forEach((part, index) => {
    crumbs.push({ label: part, path: `/${parts.slice(0, index + 1).join("/")}` });
  });
  return crumbs;
}

function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

function folderName(path: string | null): string {
  if (!path || path === "/") return "/";
  return `${path.replace(/\/+$/, "").split("/").pop()}/`;
}

/** Moves focus between table rows with the arrow keys, Home and End. */
function moveRowFocus(e: KeyboardEvent<HTMLTableRowElement>) {
  const row = e.currentTarget;
  let next: Element | null = null;
  if (e.key === "ArrowDown") next = row.nextElementSibling;
  else if (e.key === "ArrowUp") next = row.previousElementSibling;
  else if (e.key === "Home") next = row.parentElement?.firstElementChild ?? null;
  else if (e.key === "End") next = row.parentElement?.lastElementChild ?? null;
  if (next instanceof HTMLTableRowElement) {
    e.preventDefault();
    next.focus();
    next.click();
  }
}

/**
 * SFTP browser laid out for the workbench inspector: breadcrumb, filter,
 * the file table, and a transfers block.
 */
export function WorkbenchFiles(props: WorkbenchFilesProps) {
  const { path, entries, selected, upload } = props;
  const atRoot = !path || path === "/";
  const running = upload || props.transfer ? 1 : 0;
  const percent =
    upload && upload.bytesTotal > 0
      ? Math.min(100, Math.round((upload.bytesDone / upload.bytesTotal) * 100))
      : null;
  const elapsed = upload ? (Date.now() - upload.startedAt) / 1000 : 0;
  const rate = upload && elapsed > 0.5 ? upload.bytesDone / elapsed : null;
  const focusName = selected && entries.some((e) => e.name === selected) ? selected : null;

  return (
    <div ref={props.panelRef} className="wb-files">
      {props.overlays}
      <InspectorActions>
        <button
          type="button"
          className="wb-ib"
          onClick={props.onUpload}
          disabled={!path || props.busy}
          aria-label="Upload files"
          title="Upload files here"
        >
          <WbUpload />
        </button>
        <button
          type="button"
          className="wb-ib"
          onClick={props.onRefresh}
          data-busy={props.loading || undefined}
          aria-label="Refresh"
          title="Refresh"
        >
          <WbRefresh />
        </button>
      </InspectorActions>

      <div className="wb-crumbs">
        {props.pathEditing ? (
          props.pathInput
        ) : (
          <nav aria-label="Current folder" className="wb-crumb-list">
            {path &&
              pathCrumbs(path).map((crumb, index, all) => {
                const last = index === all.length - 1;
                return (
                  <span key={crumb.path} className="wb-crumb">
                    {index > 0 && <WbChevronRight />}
                    <button
                      type="button"
                      className="wb-mono"
                      aria-current={last ? "location" : undefined}
                      title={last ? "Edit path" : `Open ${crumb.path}`}
                      onClick={() => (last ? props.onEditPath() : props.onNavigate(crumb.path))}
                    >
                      {crumb.label}
                    </button>
                  </span>
                );
              })}
          </nav>
        )}
        <label
          className="wb-switch"
          title={
            props.followAvailable
              ? "Open the folder your shell is in"
              : "Waiting for the shell to report its folder"
          }
        >
          <input
            type="checkbox"
            role="switch"
            checked={props.follow}
            onChange={(e) => props.onFollowChange(e.target.checked)}
          />
          <span className="wb-switch-track" aria-hidden="true" />
          Follow terminal
        </label>
      </div>

      <div className="wb-files-filter">
        <label className="wb-input">
          <WbSearch />
          <input
            value={props.filter}
            onChange={(e) => props.onFilterChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && props.filter) {
                e.preventDefault();
                props.onFilterChange("");
              }
            }}
            placeholder={`Filter in ${folderName(path)}`}
            aria-label="Filter files"
            spellCheck={false}
          />
          {props.filter && (
            <button
              type="button"
              className="wb-input-clear"
              onClick={() => props.onFilterChange("")}
              aria-label="Clear filter"
            >
              <WbClose />
            </button>
          )}
        </label>
      </div>

      <div className="wb-files-scroll">
        {props.error && (
          <p className="wb-files-note" role="alert" data-tone="danger">
            {props.error}
          </p>
        )}
        <table className="wb-ftable">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className="wb-r wb-fcol-size">
                Size
              </th>
              <th scope="col" className="wb-r wb-fcol-modified">
                Modified
              </th>
            </tr>
          </thead>
          <tbody>
            {!atRoot && path && (
              <tr
                tabIndex={-1}
                onDoubleClick={() => props.onNavigate(parentOf(path))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Backspace") {
                    e.preventDefault();
                    props.onNavigate(parentOf(path));
                  } else moveRowFocus(e);
                }}
                title="Parent folder"
              >
                <td>
                  <span className="wb-fname" data-dir="true">
                    <WbFolder />
                    <span>..</span>
                  </span>
                </td>
                <td />
                <td />
              </tr>
            )}
            {entries.map((entry, index) => {
              const isSelected = selected === entry.name;
              const tabbable = focusName ? isSelected : index === 0;
              return (
                <tr
                  key={entry.name}
                  tabIndex={tabbable ? 0 : -1}
                  aria-selected={isSelected}
                  data-selected={isSelected || undefined}
                  onClick={() => props.onSelect(entry.name)}
                  onDoubleClick={() => props.onOpen(entry)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      props.onOpen(entry);
                    } else if (e.key === "Backspace" && !atRoot && path) {
                      e.preventDefault();
                      props.onNavigate(parentOf(path));
                    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                      e.preventDefault();
                      const box = e.currentTarget.getBoundingClientRect();
                      props.onContextMenu(entry, box.left + 24, box.bottom);
                    } else moveRowFocus(e);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    props.onContextMenu(entry, e.clientX, e.clientY);
                  }}
                >
                  <td>
                    <span className="wb-fname" data-dir={entry.is_dir || undefined}>
                      {entry.is_dir ? <WbFolder /> : <WbFile />}
                      <span>{entry.name}</span>
                    </span>
                  </td>
                  <td className="wb-r wb-mono">{entry.is_dir ? "" : formatSize(entry.size)}</td>
                  <td className="wb-r">{formatSince(mtimeSeconds(entry.mtime)) ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!props.error && entries.length === 0 && (
          <p className="wb-files-note">
            {props.loading ? "Loading…" : props.filter.trim() ? "No matches" : "Empty folder"}
          </p>
        )}
      </div>

      {running > 0 || props.doneCount > 0 ? (
        <div className="wb-transfers" aria-live="polite">
          <div className="wb-transfers-head">
            <span className="wb-label">Transfers</span>
            <span className="wb-muted">
              {[
                running ? `${running} running` : null,
                props.doneCount ? `${props.doneCount} done` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {(upload || props.transfer) && (
            <div className="wb-transfer">
              {upload ? <WbUpload /> : <WbDownload />}
              <div className="wb-transfer-body">
                <div className="wb-transfer-line">
                  {upload ? (
                    <span className="wb-mono">{upload.filename}</span>
                  ) : (
                    <span>{props.transfer}</span>
                  )}
                  {upload && upload.bytesTotal > 0 && (
                    <span className="wb-mono wb-muted">
                      {formatSize(upload.bytesDone)} of {formatSize(upload.bytesTotal)}
                      {rate ? ` · ${formatSize(Math.round(rate))}/s` : ""}
                    </span>
                  )}
                </div>
                <div className="wb-progress" data-indeterminate={percent == null || undefined}>
                  <span style={{ width: percent == null ? undefined : `${percent}%` }} />
                </div>
              </div>
              {upload && (
                <button
                  type="button"
                  className="wb-ib"
                  onClick={props.onCancelUpload}
                  aria-label={`Cancel upload of ${upload.filename}`}
                  title="Cancel upload"
                >
                  <WbClose />
                </button>
              )}
            </div>
          )}
          {!upload && !props.transfer && props.notice && (
            <p className="wb-files-note">{props.notice}</p>
          )}
        </div>
      ) : (
        props.notice && <p className="wb-files-status">{props.notice}</p>
      )}
      {props.contextMenu}
    </div>
  );
}
