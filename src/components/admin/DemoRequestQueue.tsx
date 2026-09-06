import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { CalendarClock, Mail, Phone, Users } from "lucide-react";
import type { DemoRequest, DemoRequestStatus } from "@/hooks/useDemoRequests";

export const STATUSES: DemoRequestStatus[] = [
  "new",
  "contacted",
  "scheduled",
  "completed",
  "declined",
];

export const statusTone = (status: DemoRequestStatus) => {
  switch (status) {
    case "scheduled":
      return "border-primary/40 text-primary";
    case "completed":
      return "border-emerald-500/40 text-emerald-400";
    case "declined":
      return "border-destructive/40 text-destructive";
    case "contacted":
      return "border-secondary/40 text-foreground";
    default:
      return "border-border text-muted-foreground";
  }
};

interface Props {
  requests: DemoRequest[];
  busy: boolean;
  onUpdate: (
    id: string,
    patch: Partial<Pick<DemoRequest, "status" | "scheduled_at" | "admin_notes">>,
  ) => Promise<{ ok: boolean; message: string }>;
}

/** Admin queue: move a request along, set a time, keep notes. */
export const DemoRequestQueue = ({ requests, busy, onUpdate }: Props) => {
  const [drafts, setDrafts] = useState<Record<string, { when: string; notes: string }>>({});

  const draftFor = (request: DemoRequest) =>
    drafts[request.id] ?? {
      when: request.scheduled_at ? request.scheduled_at.slice(0, 16) : "",
      notes: request.admin_notes ?? "",
    };

  const apply = async (
    request: DemoRequest,
    patch: Partial<Pick<DemoRequest, "status" | "scheduled_at" | "admin_notes">>,
  ) => {
    const result = await onUpdate(request.id, patch);
    if (result.ok) toast.success("Request updated.");
    else toast.error(result.message);
  };

  if (requests.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">No demo requests yet.</Card>
    );
  }

  return (
    <div className="space-y-4">
      {requests.map((request) => {
        const draft = draftFor(request);
        return (
          <Card key={request.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {request.company_name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {request.contact_name} · asked {new Date(request.created_at).toLocaleString()}
                </p>
              </div>
              <Badge variant="outline" className={statusTone(request.status)}>
                {request.status}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {request.contact_email}
              </span>
              {request.contact_phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {request.contact_phone}
                </span>
              )}
              {request.team_size && (
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {request.team_size} people
                </span>
              )}
              {request.preferred_timing && (
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  {request.preferred_timing}
                </span>
              )}
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{request.use_case}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={`status-${request.id}`}>Status</Label>
                <Select
                  value={request.status}
                  onValueChange={(value) =>
                    apply(request, { status: value as DemoRequestStatus })
                  }
                >
                  <SelectTrigger id={`status-${request.id}`} className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`when-${request.id}`}>Demo time</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id={`when-${request.id}`}
                    type="datetime-local"
                    value={draft.when}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [request.id]: { ...draft, when: event.target.value },
                      }))
                    }
                  />
                  <Button
                    variant="outline"
                    disabled={busy || !draft.when}
                    onClick={() =>
                      apply(request, {
                        scheduled_at: new Date(draft.when).toISOString(),
                        status: "scheduled",
                      })
                    }
                  >
                    Set
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Label htmlFor={`notes-${request.id}`}>Internal notes</Label>
              <Textarea
                id={`notes-${request.id}`}
                rows={2}
                value={draft.notes}
                onChange={(event) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [request.id]: { ...draft, notes: event.target.value },
                  }))
                }
                className="mt-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() => apply(request, { admin_notes: draft.notes })}
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

export default DemoRequestQueue;
