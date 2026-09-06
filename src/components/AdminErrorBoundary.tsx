import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface State {
  error: Error | null;
}

/**
 * Catches a crash inside any admin screen so a single failing tool does not
 * blank the whole app. Admins get the technical message (they need it) plus a
 * way back to the dashboard without a full reload.
 */
class AdminErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[admin] screen crashed", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return <>{this.props.children}</>;

    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Card className="space-y-4 p-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">This admin screen stopped working</h1>
            <p className="text-sm text-muted-foreground">
              The rest of the app is fine. Retry the screen, or go back to the dashboard.
            </p>
          </div>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={this.reset}>Retry</Button>
            <Button variant="outline" asChild onClick={this.reset}>
              <Link to="/admin">Back to dashboard</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}

export default AdminErrorBoundary;
