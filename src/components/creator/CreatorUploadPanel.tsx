import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import { friendlyError } from "@/lib/friendlyError";
import type { AnalyzeAudioResponse } from "@/lib/analyzeAudio";

const BUCKET = "user-audio";
const MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  /** Refresh the creator's library and results once a sound has been read. */
  onAdded: () => void | Promise<void>;
}

/**
 * A creator adds a real audio file to their own library and it is read by the
 * same pipeline Listeners use: the file lands in their private folder, a source
 * row is filed against their account, and `analyze-audio` scores and saves it.
 */
const CreatorUploadPanel = ({ onAdded }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`);
      return;
    }

    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Please sign in again.");

      const name = title.trim() || file.name;

      const { data: sourceRow, error: srcErr } = await supabase
        .from("audio_sources")
        .insert({ user_id: userId, name, source_type: "file" })
        .select("id")
        .single();
      if (srcErr || !sourceRow) throw new Error(srcErr?.message ?? "Could not add that sound.");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `${userId}/${sourceRow.id}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
      if (upErr) throw new Error(upErr.message);

      await supabase.from("audio_sources").update({ file_url: path }).eq("id", sourceRow.id);

      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      if (signErr || !signed?.signedUrl) {
        throw new Error(signErr?.message ?? "Could not open that file for reading.");
      }

      const { data, error } = await invokeWithTimeout<AnalyzeAudioResponse>("analyze-audio", {
        body: {
          sources: [
            { name, type: "file", file_url: signed.signedUrl, audio_source_id: sourceRow.id },
          ],
          user_id: userId,
          save_results: true,
        },
        timeoutMs: 180_000,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.sources?.[0]?.categories?.length) {
        throw new Error("The reading came back without scores.");
      }

      toast.success(`“${name}” is in your library and has been read.`);
      setFile(null);
      setTitle("");
      await onAdded();
    } catch (e) {
      toast.error(friendlyError(e, "We couldn't add that sound."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Add one of your own sounds</p>
        <p className="text-xs text-muted-foreground">
          Upload an audio file (up to 20 MB). It stays private to your account and is read on the
          six dimensions straight away.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="creator-upload-file">Audio file</Label>
          <Input
            id="creator-upload-file"
            type="file"
            accept="audio/*"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="creator-upload-title">Name (optional)</Label>
          <Input
            id="creator-upload-title"
            value={title}
            placeholder={file?.name ?? "What to call it"}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <Button onClick={submit} disabled={busy || !file}>
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Reading your sound…
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            Upload and read
          </>
        )}
      </Button>
    </Card>
  );
};

export default CreatorUploadPanel;
