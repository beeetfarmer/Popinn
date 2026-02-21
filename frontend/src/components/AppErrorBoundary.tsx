import React from "react";

interface State {
  hasError: boolean;
  message: string;
}

export default class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  State
> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "Unexpected application error";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Keep a console breadcrumb for debugging when browser devtools is open.
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border border-destructive/40 bg-card p-5">
          <h1 className="text-lg font-semibold text-foreground">App crashed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {this.state.message || "Unknown runtime error"}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
