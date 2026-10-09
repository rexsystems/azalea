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
          Share anonymous usage data?
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          A daily ping with app version and OS, plus crash reports. No hostnames, emails, keys, or
          commands. Change this later in Settings → Privacy.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => onChoice(false)}>
            Do not share
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => onChoice(true)}>
            Share data
          </Button>
        </div>
      </div>
    </div>
  );
}
