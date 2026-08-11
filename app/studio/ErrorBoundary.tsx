"use client";

/**
 * The last screen before a blank page.
 *
 * A render-phase throw anywhere below this boundary — a storage write that
 * fails during a state updater, a malformed record reaching a panel — would
 * otherwise unmount the whole studio and leave the tab white with the
 * converted model still in memory but unreachable. React only offers a class
 * component for this, so this is one.
 *
 * The fallback is written for whoever is holding the file, not for a stack
 * trace reader: what happened, that nothing was uploaded, and one button back
 * into a working studio.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

type ErrorBoundaryProps = { children: ReactNode };

type ErrorBoundaryState = { failed: boolean; detail: string };

/** One line, never the stack — enough to recognise a repeat, not a dump. */
function summarise(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.split("\n", 1)[0].slice(0, 200);
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, detail: "" };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { failed: true, detail: summarise(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Nothing is reported anywhere; the console is the only place this can go.
    console.error("Reviter stopped rendering.", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty">
        <div className="empty-grid">
          <div>
            <p className="empty-eyebrow">Something went wrong</p>
            <h1>The studio stopped unexpectedly.</h1>
            <p className="empty-lede">
              Something on this screen failed and the session could not continue. Nothing
              left this machine — the file was only ever read in this browser. Reloading
              starts the studio again, and models you have already opened are waiting in
              Recents.
            </p>
            <button
              type="button"
              className="rv-button rv-button-primary"
              onClick={() => window.location.reload()}
            >
              <RotateCcw size={16} aria-hidden />
              Reload the studio
            </button>
            <p className="empty-formats">
              If it happens again, freeing up this browser&apos;s storage for the site often
              settles it.
            </p>
            {this.state.detail && (
              <p className="empty-error" role="alert">{this.state.detail}</p>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
