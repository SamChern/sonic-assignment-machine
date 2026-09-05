import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles } from "lucide-react";

interface GetStartedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGetStarted: () => void;
}

/** The "how it works + enterprise upsell" dialog launched from the hero CTA. */
const GetStartedDialog = ({ open, onOpenChange, onGetStarted }: GetStartedDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Get started with the following steps</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <ol className="list-decimal list-inside space-y-3 text-foreground">
            <li>Upload a user's playlist, audio history or any other sonic identifiers</li>
            <li>Find the connective tissue between a user's sonic history.</li>
            <li>Category sonic history into 6 meta categories.</li>
            <li>Garner insights around sonic similarities and differences.</li>
          </ol>

          {/* Enterprise Section */}
          <div className="mt-4 p-4 rounded-lg border border-primary/30 bg-primary/5 relative overflow-hidden">
            <div className="absolute top-0 right-0">
              <Badge className="rounded-none rounded-bl-lg bg-primary text-primary-foreground">
                Enterprise
              </Badge>
            </div>
            <p className="text-sm text-foreground font-medium mb-2 pr-20">
              Compare sonic fingerprints across users to create a new path to enrich your data-driven marketing, including:
            </p>
            <ol className="list-[lower-alpha] list-inside ml-2 space-y-1 text-sm text-muted-foreground">
              <li>Identity resolution</li>
              <li>Multi-modal clustering</li>
              <li>Contextual targeting</li>
              <li>Predictive analyses</li>
            </ol>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <a
                href="mailto:hello@example.com?subject=SonicSIM%20Enterprise%20—%20Learn%20More"
                className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Learn More
              </a>
              <Link
                to="/workspace"
                className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Open enterprise workspace
              </Link>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={onGetStarted}>
            <Sparkles className="mr-2 h-4 w-4" />
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GetStartedDialog;
