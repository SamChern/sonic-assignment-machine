import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Globe, Library, Mail } from "lucide-react";
import type { CreatorApplication, CreatorApplicationStatus } from "@/hooks/useCreatorApplications";

export const CREATOR_STATUSES: CreatorApplicationStatus[] = [
  "new",
  "reviewing",
  "approved",
  "waitlisted",
  "declined",
];

export const creatorStatusTone = (status: string) => {
  switch (status) {
    case "approved":
      return "border-emerald-500/40 text-emerald-400";
    case "reviewing":
      return "border-primary/40 text-primary";
    case "waitlisted":
      return "border-secondary/40 text-foreground";
    case "declined":
      return "border-destructive/40 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
};

interface Props {
  applications: CreatorApplication[];
  busy: boolean;
  onUpdate: (
    id: string,
    patch: Partial<Pick<CreatorApplication, "status" | "admin_notes">>,
  ) => Promise<{ ok: boolean; message: string }>;
}

/** Admin queue: review an application, decide, keep notes. */
const CreatorApplicationQueue = ({ applications, busy, onUpdate }: Props) => {
  const [notes, setNotes] = useState<Record<string, string>>({});

  const apply = async (
    application: CreatorApplication,
    patch: Partial<Pick<CreatorApplication, "status" | "admin_notes">>,
  ) => {
    const result = await onUpdate(application.id, patch);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };

  if (applications.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">No applications yet.</Card>;
  }

  return (
    <div className="space-y-3">
      {applications.map((application) => {
        const draft = notes[application.id] ?? application.admin_notes ?? "";
        return (
          <Card key={application.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {application.org_name ?? application.contact_name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {application.contact_name} · applied{" "}
                  {new Date(application.created_at).toLocaleString()}
                </p>
              </div>
              <Badge variant="outline" className={creatorStatusTone(application.status)}>
                {application.status}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {application.contact_email}
              </span>
              {application.website && (
                <span className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  {application.website}
                </span>
              )}
              {application.catalogue_size && (
                <span className="flex items-center gap-1.5">
                  <Library className="h-3.5 w-3.5" aria-hidden="true" />
                  {application.catalogue_size}
                </span>
              )}
            </div>

            {application.use_case && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                {application.use_case}
              </p>
            )}

            <div className="mt-4 max-w-xs">
              <Label htmlFor={`creator-status-${application.id}`}>Status</Label>
              <Select
                value={application.status}
                onValueChange={(value) =>
                  void apply(application, { status: value as CreatorApplicationStatus })
                }
              >
                <SelectTrigger id={`creator-status-${application.id}`} className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREATOR_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4">
              <Label htmlFor={`creator-notes-${application.id}`}>Internal notes</Label>
              <Textarea
                id={`creator-notes-${application.id}`}
                rows={2}
                value={draft}
                onChange={(event) =>
                  setNotes((prev) => ({ ...prev, [application.id]: event.target.value }))
                }
                className="mt-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() => void apply(application, { admin_notes: draft })}
              >
                Save notes
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default CreatorApplicationQueue;
