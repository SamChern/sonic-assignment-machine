import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Copy, Loader2, Save, Megaphone } from "lucide-react";

interface Settings {
  google_tag_id: string;
  google_ads_conversion_id: string;
  google_ads_conversion_label: string;
  meta_pixel_id: string;
  tiktok_pixel_id: string;
}

const EMPTY: Settings = {
  google_tag_id: "",
  google_ads_conversion_id: "",
  google_ads_conversion_label: "",
  meta_pixel_id: "",
  tiktok_pixel_id: "",
};

const Snippet = ({ title, code, note }: { title: string; code: string; note?: string }) => (
  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs font-semibold">{title}</p>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={() => {
          void navigator.clipboard.writeText(code);
          toast({ title: "Copied to clipboard" });
        }}
      >
        <Copy className="mr-1 h-4 w-4" />
        Copy
      </Button>
    </div>
    {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    <pre className="mt-2 overflow-x-auto rounded-lg border border-border/50 bg-background/60 p-3 text-[11px]">
      {code}
    </pre>
  </div>
);

/**
 * Per-organization ad-platform tag IDs plus the copy-paste snippets that match
 * the standard Google Ads / GTM, Meta and TikTok conversion setups. Only public
 * tag identifiers are stored — never API keys or access tokens.
 */
const AdPlatformPixels = ({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) => {
  const [values, setValues] = useState<Settings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("org_tracking_settings")
      .select(
        "google_tag_id, google_ads_conversion_id, google_ads_conversion_label, meta_pixel_id, tiktok_pixel_id",
      )
      .eq("organization_id", organizationId)
      .maybeSingle();
    setValues({
      google_tag_id: data?.google_tag_id ?? "",
      google_ads_conversion_id: data?.google_ads_conversion_id ?? "",
      google_ads_conversion_label: data?.google_ads_conversion_label ?? "",
      meta_pixel_id: data?.meta_pixel_id ?? "",
      tiktok_pixel_id: data?.tiktok_pixel_id ?? "",
    });
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    const { error } = await supabase.from("org_tracking_settings").upsert(
      {
        organization_id: organizationId,
        ...values,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Tracking IDs saved" });
  }, [organizationId, values]);

  const set = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const snippets = useMemo(() => {
    const out: { title: string; code: string; note?: string }[] = [];
    if (values.google_tag_id.trim()) {
      const id = values.google_tag_id.trim();
      out.push({
        title: "Google tag (base) — every page",
        note: "Step 2 equivalent: install once site-wide, or add as the native Google Tag in GTM on All Pages.",
        code: `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${id}');
</script>`,
      });
    }
    if (values.google_ads_conversion_id.trim() && values.google_ads_conversion_label.trim()) {
      out.push({
        title: "Google Ads conversion event",
        note: "Step 3 equivalent: fire on the success moment (thank-you page, form submit, purchase).",
        code: `gtag('event', 'conversion', {
  send_to: '${values.google_ads_conversion_id.trim()}/${values.google_ads_conversion_label.trim()}',
  value: 1.0,
  currency: 'USD'
});`,
      });
    }
    if (values.meta_pixel_id.trim()) {
      const id = values.meta_pixel_id.trim();
      out.push({
        title: "Meta pixel",
        code: `<script>
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${id}');
  fbq('track', 'PageView');
</script>`,
      });
    }
    if (values.tiktok_pixel_id.trim()) {
      const id = values.tiktok_pixel_id.trim();
      out.push({
        title: "TikTok pixel",
        code: `<script>
  !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
  ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
  ttq.setAndDefer=function(e,n){e[n]=function(){e.push([n].concat(Array.prototype.slice.call(arguments,0)))}};
  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
  ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";
  ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;
  var o=d.createElement("script");o.async=!0;o.src=n+"?sdkid="+e+"&lib="+t;
  var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
  ttq.load('${id}');ttq.page();
  }(window,document,'ttq');
</script>`,
      });
    }
    return out;
  }, [values]);

  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Megaphone className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Ad platform pixels</h2>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Store your public tag identifiers here and SonicSIM generates the exact snippets to install
        directly or through a tag manager. Conversion IDs and labels come from Google Ads under
        Goals → Conversions → Summary → New conversion action; the pixel IDs come from your Meta
        Events Manager and TikTok Events Manager. No API keys are stored.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Google tag ID</Label>
          <Input
            value={values.google_tag_id}
            onChange={set("google_tag_id")}
            placeholder="GT-XXXXXXX or AW-XXXXXXXXX"
            disabled={!canWrite}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Google Ads conversion ID</Label>
          <Input
            value={values.google_ads_conversion_id}
            onChange={set("google_ads_conversion_id")}
            placeholder="AW-XXXXXXXXX"
            disabled={!canWrite}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Google Ads conversion label</Label>
          <Input
            value={values.google_ads_conversion_label}
            onChange={set("google_ads_conversion_label")}
            placeholder="abcDEfgHIjk-LMnop"
            disabled={!canWrite}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Meta pixel ID</Label>
          <Input
            value={values.meta_pixel_id}
            onChange={set("meta_pixel_id")}
            placeholder="1234567890"
            disabled={!canWrite}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">TikTok pixel ID</Label>
          <Input
            value={values.tiktok_pixel_id}
            onChange={set("tiktok_pixel_id")}
            placeholder="CXXXXXXXXXXXXXXXXXXX"
            disabled={!canWrite}
          />
        </div>
      </div>

      <Button size="sm" className="mt-3" onClick={save} disabled={saving || !canWrite}>
        {saving ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-1 h-4 w-4" />
        )}
        Save tracking IDs
      </Button>

      {snippets.length ? (
        <div className="mt-4 space-y-3">
          {snippets.map((s) => (
            <Snippet key={s.title} {...s} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Add at least one identifier above to generate install snippets.
        </p>
      )}

      <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 p-3 text-[11px] text-muted-foreground">
        <p className="font-semibold text-foreground">Validate before publishing</p>
        <p className="mt-1">
          In Google Tag Manager use Preview / Tag Assistant and confirm the conversion tag moves
          from “Tags Not Fired” to “Tags Fired”, then Submit and Publish the container. Meta and
          TikTok both provide a browser test-events view for the same check.
        </p>
      </div>
    </Card>
  );
};

export default AdPlatformPixels;
