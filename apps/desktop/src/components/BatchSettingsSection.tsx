import { useEffect, useState } from "react";
import { useBatchSettings } from "../hooks/useBatchSettings";
import { MAX_BATCH_TIMEOUT_MINUTES, validBatchTimeoutMinutes } from "../lib/batchSettings";
import { Input } from "./ui/Input";
import { SettingToggle } from "./ui/SettingToggle";

export function BatchSettingsSection() {
  const { settings, update, error } = useBatchSettings();
  const [minutes, setMinutes] = useState(String(settings.timeoutMinutes));
  const [durationError, setDurationError] = useState<string | null>(null);
  useEffect(() => {
    setMinutes(String(settings.timeoutMinutes));
  }, [settings.timeoutMinutes]);
  const saveDuration = () => {
    const value = Number(minutes);
    if (!validBatchTimeoutMinutes(value)) {
      setDurationError(`Enter a whole number from 1 to ${MAX_BATCH_TIMEOUT_MINUTES} minutes.`);
      return;
    }
    setDurationError(null);
    update({ timeoutMinutes: value });
  };

  return (
    <div className="batch-command-controls space-y-3 [--text-muted:var(--text-secondary)] [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-[var(--accent)]">
      <SettingToggle
        label="Batch command timeout"
        description="Limit how long each host can run. Turn off to wait until the command finishes or you stop the batch. Changes apply to new runs."
        checked={settings.timeoutEnabled}
        onChange={(timeoutEnabled) => {
          setMinutes(String(settings.timeoutMinutes));
          setDurationError(null);
          update({ timeoutEnabled });
        }}
      />
      <div className="max-w-xs">
        <Input
          id="batch-timeout-minutes"
          label="Timeout per host (minutes)"
          type="number"
          min={1}
          max={MAX_BATCH_TIMEOUT_MINUTES}
          step={1}
          disabled={!settings.timeoutEnabled}
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
            setDurationError(null);
          }}
          onBlur={saveDuration}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-invalid={Boolean(durationError)}
          aria-describedby={durationError ? "batch-timeout-error" : undefined}
          className="disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        />
      </div>
      {durationError && (
        <p
          id="batch-timeout-error"
          role="alert"
          className="text-sm"
          style={{ color: "var(--text)" }}
        >
          {durationError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
