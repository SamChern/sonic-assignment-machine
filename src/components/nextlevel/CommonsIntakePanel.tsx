import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import { friendlyError } from "@/lib/friendlyError";
import type { AnalyzeAudioResponse } from "@/lib/analyzeAudio";

const BUCKET = "user-audio";
const MAX_BYTES = 20 * 1024 * 1024;

interface Props {
  onAdded: () => void | Promise<void>;
}

/**
 * Real audio into the Commons: upload a sound, record who owns it and under
 * which licence, score it with the live pipeline, and file it as a pool item
 * with a matching licence record. Nothing enters the pool without both.
 */
export function CommonsIntakePanel({ onAdded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [rightsHolder, setRightsHolder] = useState("");
  const [license, setLicense] = useState("CC BY 4.0");
  const [termsUrl, setTermsUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setTitle("");
    setRightsHolder("");
    setTermsUrl("");
    setAttribution("");
  };

  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`);
      return;
    }
    if (!rightsHolder.trim() || !license.trim()) {
      toast.error("A rights holder and a licence are both required.");
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
      if (srcErr || !sourceRow) throw new Error(srcErr?.message ?? "Could not create the source");

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
        throw new Error(signErr?.message ?? "Could not sign the file");
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
        throw new Error("The analysis came back without scores");
      }

      const { data: item, error: itemErr } = await supabase
        .from("commons_pool_items")
        .insert({
          title: name,
          rights_holder: rightsHolder.trim(),
          audio_source_id: sourceRow.id,
          status: "proposed",
          created_by: userId,
        })
        .select("id")
        .single();
      if (itemErr || !item) throw new Error(itemErr?.message ?? "Could not file the work");

      const { error: ledgerErr } = await supabase.from("commons_license_ledger").insert({
        pool_item_id: item.id,
        license: license.trim(),
        rights_holder: rightsHolder.trim(),
        terms_url: termsUrl.trim() || null,
        attribution: attribution.trim() || rightsHolder.trim(),
        verified_by: userId,
        verified_at: new Date().toISOString(),
      });
      if (ledgerErr) throw new Error(ledgerErr.message);

      toast.success("Scored from the audio and filed with its licence.");
      reset();
      await onAdded();
    } catch (e) {
      toast.error(friendlyError(e, "We couldn't add that sound to the pool."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium">Add a real sound to the pool</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="commons-file">Audio file (up to 20 MB)</Label>
          <Input
            id="commons-file"
            type="file"
            accept="audio/*"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commons-title">Title</Label>
          <Input
            id="commons-title"
            value={title}
            placeholder={file?.name ?? "Name of the work"}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commons-holder">Rights holder</Label>
          <Input
            id="commons-holder"
            value={rightsHolder}
            placeholder="Who owns this sound"
            onChange={(e) => setRightsHolder(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commons-license">Licence</Label>
          <Input
            id="commons-license"
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commons-terms">Link to the terms (optional)</Label>
          <Input
            id="commons-terms"
            value={termsUrl}
            placeholder="https://"
            onChange={(e) => setTermsUrl(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="commons-credit">Credit line (optional)</Label>
          <Input
            id="commons-credit"
            value={attribution}
            placeholder="How the maker should be credited"
            onChange={(e) => setAttribution(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <Button onClick={submit} disabled={busy || !file}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        Score and file this sound
      </Button>
      <p className="text-xs text-muted-foreground">
        The six scores come from the audio itself, and the licence is recorded at the same moment, so
        a work can only be included once its terms are on file.
      </p>
    </div>
  );
}
