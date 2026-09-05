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
import { SavedAnalysis, relative } from "@/lib/semanticAnalysis";

interface DeleteAnalysisDialogProps {
  pendingDelete: SavedAnalysis | null;
  setPendingDelete: (a: SavedAnalysis | null) => void;
  deleting: boolean;
  deleteSaved: () => void;
}

export const DeleteAnalysisDialog = ({
  pendingDelete,
  setPendingDelete,
  deleting,
  deleteSaved,
}: DeleteAnalysisDialogProps) => {
  return (
    <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this saved analysis?</AlertDialogTitle>
          <AlertDialogDescription>
            “{pendingDelete?.source_name}” ({relative(pendingDelete?.created_at ?? "")}) will be
            permanently removed from SonicSIM Analysis Results. The underlying audio source stays
            intact and can be re-scored later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              deleteSaved();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteAnalysisDialog;
