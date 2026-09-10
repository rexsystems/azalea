import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportCrash } from "../lib/telemetry";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Catches React render errors and optionally reports them (opt-in telemetry). */
export class CrashBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportCrash({
      kind: "react_boundary",
      message: error.message || "react_boundary",
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n"),
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center"
          style={{ background: "var(--bg)", color: "var(--text)" }}
        >
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
            Azalea hit an unexpected error. Reload the window to continue.
          </p>
          <button
            type="button"
            className="home-action-primary rounded-lg px-4 py-2 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
