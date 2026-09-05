import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  /** Human name of the panel, used in the failure message. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: number;
}

/**
 * Panel-level recovery. One broken card (a missing score array, a failed shape
 * from the backend) used to take down the whole page through the app-wide
 * boundary. This keeps the rest of the page alive and lets the person retry
 * just this card — remounting its subtree so data refetches.
 */
class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`panel error (${this.props.label}):`, error, info.componentStack);
  }

  private retry = () => {
    this.setState((s) => ({ error: null, key: s.key + 1 }));
  };

  render() {
    const { error, key } = this.state;
    if (!error) return <div key={key}>{this.props.children}</div>;

    return (
      <Card className="border-destructive/40 bg-card/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{this.props.label} couldn’t load</p>
            <p className="truncate text-xs text-muted-foreground">
              {error.message.slice(0, 160)}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={this.retry}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Reload
          </Button>
        </div>
      </Card>
    );
  }
}

export default PanelErrorBoundary;
export { PanelErrorBoundary };
