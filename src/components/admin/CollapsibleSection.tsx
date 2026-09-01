import { ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * A lightweight click-to-expand shell for heavy admin modules. Collapsed by
 * default so /admin stays a glanceable overview.
 */
export const CollapsibleSection = ({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <Card className="border-border/60 bg-card/70 px-3 py-2 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-between px-1 text-xs font-semibold"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          {title}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-full justify-between px-1 text-xs font-semibold"
        aria-expanded
        onClick={() => setOpen(false)}
      >
        {title}
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      {children}
    </div>
  );
};

export default CollapsibleSection;
