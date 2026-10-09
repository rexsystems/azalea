import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as voice from "../lib/voice";
import { Button } from "./ui/Button";
import { SettingToggle } from "./ui/SettingToggle";
import { Select } from "./ui/Select";
import { isMobileRuntime } from "../hooks/useIsMobile";

const ACTIVE_PHASES = new Set([
  "listening",
  "recognizing",
  "thinking",
  "speaking",
  "starting",
]);

export function VoiceSettingsSection() {
  const [status, setStatus] = useState<voice.VoiceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isMobileRuntime()) {
      setError("The voice assistant is available in desktop builds.");
      return;
    }
    let cancelled = false;
    void voice
      .voiceStatus()
      .then((status) => {
        if (!cancelled) setStatus(status);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    const subscription = listen<voice.VoiceStatus>(
      "azalea-voice-status",
      ({ payload }) => {
        if (!cancelled) setStatus(payload);
      },
    );
    return () => {
      cancelled = true;
      void subscription.then((remove) => remove());
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: Partial<voice.VoicePreferences>) => {
    if (status && !busy)
      void run(async () =>
        setStatus(
          await voice.saveVoicePreferences({ ...status.preferences, ...patch }),
        ),
      );
  };
  if (!status)
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {error ?? "Loading voice settings…"}
      </p>
    );
  const controlsDisabled = busy || status.phase === "downloading";
  const statusActive = ACTIVE_PHASES.has(status.phase);
  return (
    <div className="space-y-4">
      {(error || status.replyError) && (
        <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
          {error ?? status.replyError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span
          className={`voice-status-dot${statusActive ? " is-active" : ""}`}
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background:
              status.phase === "error"
                ? "var(--danger)"
                : statusActive
                  ? "var(--text)"
                  : "var(--text-muted)",
            opacity: statusActive ? 1 : 0.45,
          }}
        />
        <p
          className="text-sm"
          role="status"
          style={{
            color:
              status.phase === "error" ? "var(--danger)" : "var(--text-muted)",
          }}
        >
          {status.message}
        </p>
      </div>
      {!status.modelReady && (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Download the local multilingual recognition model (~60 MB) once. No
            API key is needed.
          </p>
          <Button
            disabled={controlsDisabled}
            onClick={() =>
              void run(async () => setStatus(await voice.downloadVoiceModel()))
            }
          >
            {status.phase === "downloading" && status.downloadPercent > 0
              ? `Downloading speech ${status.downloadPercent}%…`
              : "Download speech model"}
          </Button>
        </div>
      )}
      {!status.ttsReady && (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Optional: download Piper for spoken replies (~90 MB with runtime).
            System speech is the fallback.
          </p>
          <Button
            disabled={controlsDisabled}
            onClick={() =>
              void run(async () => setStatus(await voice.downloadVoiceTts()))
            }
          >
            {status.phase === "downloading" && status.ttsDownloadPercent > 0
              ? `Downloading Piper ${status.ttsDownloadPercent}%…`
              : "Download Piper voice"}
          </Button>
        </div>
      )}
      <div
        className={
          controlsDisabled ? "pointer-events-none opacity-60" : undefined
        }
      >
        <SettingToggle
          disabled={controlsDisabled}
          label="Enable voice assistant"
          description="Off by default. Listens on the system microphone for Hey Azalea. Audio stays on this computer."
          checked={status.preferences.enabled}
          onChange={(enabled) => {
            if (enabled && !status.modelReady)
              setError("Download the speech model first.");
            else save({ enabled });
          }}
        />
      </div>
      <div
        className={`space-y-3 ${controlsDisabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <SettingToggle
          disabled={controlsDisabled}
          label="Keep Azalea in the system tray"
          description="Closing the window keeps the assistant running. Quit Azalea from the tray to stop it."
          checked={status.preferences.keepInTray}
          onChange={(keepInTray) => save({ keepInTray })}
        />
        {!status.trayAvailable && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            The system tray is unavailable in this desktop session. Closing the
            window will quit Azalea.
          </p>
        )}
        <SettingToggle
          disabled={controlsDisabled}
          label="Voice replies"
          description="Speaks results with Piper when downloaded, otherwise system speech."
          checked={status.preferences.voiceReplies}
          onChange={(voiceReplies) => save({ voiceReplies })}
        />
        <SettingToggle
          disabled={controlsDisabled}
          label="Wake saved servers by voice"
          description="Sends Wake-on-LAN to hosts that have a MAC address in the active account."
          checked={status.preferences.allowWakeOnLan}
          onChange={(allowWakeOnLan) => save({ allowWakeOnLan })}
        />
      </div>
      <Select
        label="Recognition language"
        value={status.preferences.language}
        disabled={controlsDisabled}
        options={[
          { value: "auto", label: "Automatic" },
          { value: "en", label: "English" },
          { value: "ro", label: "Română (experimental)" },
        ]}
        onChange={(language) =>
          save({ language: language as voice.VoicePreferences["language"] })
        }
      />
      <Select
        label="Microphone sensitivity"
        value={String(status.preferences.sensitivity)}
        disabled={controlsDisabled}
        options={[
          { value: "0.006", label: "Quiet speech" },
          { value: "0.012", label: "Normal" },
          { value: "0.025", label: "Noisy room" },
        ]}
        onChange={(sensitivity) => save({ sensitivity: Number(sensitivity) })}
      />
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Pick the language you speak for short commands. If a saved name is
        misheard, repeat it. Ambiguous names never wake a server.
      </p>
      {status.microphone && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Microphone: {status.microphone}
        </p>
      )}
      {!status.speechAvailable && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Download Piper for voice replies, or install espeak-ng on Linux.
          Recognition and Wake-on-LAN remain available.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={controlsDisabled || !status.speechAvailable}
          onClick={() => void run(voice.testVoiceReply)}
        >
          Test voice reply
        </Button>
        <Button
          variant="secondary"
          disabled={controlsDisabled || !status.preferences.enabled}
          onClick={() =>
            void run(async () => setStatus(await voice.restartVoice()))
          }
        >
          Restart listening
        </Button>
      </div>
      <div className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
        <p>“Hey Azalea, wake up server [saved host name]”</p>
        <p>“Hei Azalea, pornește serverul [numele salvat]”</p>
        <p>“Hey Azalea, open Azalea” · “Hey Azalea, status”</p>
        <p>“Hey Azalea, ask ai [question]” (uses Settings → AI when configured)</p>
      </div>
      {status.lastCommand && (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <p style={{ color: "var(--text-muted)" }}>{status.lastCommand}</p>
          <p className="mt-1">{status.lastReply}</p>
        </div>
      )}
    </div>
  );
}
