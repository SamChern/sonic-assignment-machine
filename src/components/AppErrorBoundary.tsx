import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Single app-wide error boundary.
 *
 * Before this existed, one render error anywhere (a null analysis, a missing
 * score array) unmounted the whole tree and left the user on a blank page with
 * no way back. Now the failure is contained, named and recoverable.
 */
class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("app error boundary caught:", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            This screen ran into a problem
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing was lost. Try again, or head back to the home page.
          </p>
          <p className="mt-3 break-words rounded-lg bg-muted/50 p-2 text-left text-xs text-muted-foreground">
            {error.message.slice(0, 300)}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={this.reset} className="min-h-11">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Go to home
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
