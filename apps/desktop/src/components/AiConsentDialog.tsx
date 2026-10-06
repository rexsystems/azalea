import { Button } from "./ui/Button";

interface AiConsentDialogProps {
  onChoice: (enabled: boolean) => void;
}

/** First-run prompt: AI stays off until Allow. Declining hides all AI chrome except Settings. */
export function AiConsentDialog({ onChoice }: AiConsentDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="ai-consent-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border p-5 shadow-lg"
        style={{ background: "var(--bg-panel)", borderColor: "var(--border)" }}
      >
        <h2
          id="ai-consent-title"
          className="text-lg font-semibold"
          style={{ color: "var(--text)" }}
        >
          Enable AI?
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          If you choose No, AI stays off and will not appear. You can turn it on later in Settings.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => onChoice(false)}>
            No
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => onChoice(true)}>
            Enable
          </Button>
        </div>
      </div>
    </div>
  );
}
