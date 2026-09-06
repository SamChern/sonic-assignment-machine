import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PendingWrite } from "./types";

export const ConfirmWriteDialog = ({
  pending,
  onOpenChange,
  onConfirm,
}: {
  pending: PendingWrite | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) => {
  return (
    <AlertDialog open={!!pending} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending?.destructive ? "Destructive Intuizi action" : "Confirm Intuizi write"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.label} Every call is recorded in the Intuizi run ledger.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <pre className="max-h-40 overflow-auto rounded bg-muted/30 p-2 text-[10px]">
          {JSON.stringify(pending?.args ?? {}, null, 2)}
        </pre>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Run {pending?.tool}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
