import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as voice from "../lib/voice";
import { Button } from "./ui/Button";
import { SettingToggle } from "./ui/SettingToggle";
import { Select } from "./ui/Select";
import { isMobileRuntime } from "../hooks/useIsMobile";

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
  return (
    <div className="space-y-4">
      {(error || status.replyError) && (
        <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
          {error ?? status.replyError}
        </p>
      )}
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
            {status.phase === "downloading"
              ? `Downloading ${status.downloadPercent}%…`
              : "Download speech model"}
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
          description="Off by default. Uses your system-default microphone to listen locally for Hey Azalea. Audio stays on this computer."
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
          description="Closing the window keeps the assistant running while enabled. Quit Azalea from the tray to stop it completely."
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
          description="Speak command results using your system's speech output."
          checked={status.preferences.voiceReplies}
          onChange={(voiceReplies) => save({ voiceReplies })}
        />
        <SettingToggle
          disabled={controlsDisabled}
          label="Wake saved servers by voice"
          description="Uses Wake-on-LAN for hosts with a configured MAC address in the active account."
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
        Select the language you speak for short commands. If a saved name is
        misheard, repeat it; ambiguous names never wake a server.
      </p>
      {status.microphone && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Microphone: {status.microphone}
        </p>
      )}
      {!status.speechAvailable && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Install espeak-ng for Linux voice replies. Recognition and Wake-on-LAN
          remain available.
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
        <p>
          These built-in commands do not run terminal commands or use a cloud AI
          provider.
        </p>
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
