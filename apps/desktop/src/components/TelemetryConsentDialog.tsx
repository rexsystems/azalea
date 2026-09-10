import { Button } from "./ui/Button";

interface TelemetryConsentDialogProps {
  onChoice: (enabled: boolean) => void;
}

/** First-run style prompt: anonymous counts only, default stays off until Allow. */
export function TelemetryConsentDialog({ onChoice }: TelemetryConsentDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="telemetry-consent-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border p-5 shadow-lg"
        style={{ background: "var(--bg-panel)", borderColor: "var(--border)" }}
      >
        <h2
          id="telemetry-consent-title"
          className="text-lg font-semibold"
          style={{ color: "var(--text)" }}
        >
          Help improve Azalea?
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Optional anonymous usage counts and crash reports (app version, OS, short error text).
          No hostnames, emails, keys, or commands. You can change this anytime in Settings.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => onChoice(false)}>
            No thanks
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => onChoice(true)}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
