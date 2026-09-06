import { Link } from "react-router-dom";
import { Check, Building2, Palette, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Open-web access levels. Shown only to visitors who are not signed in — the
 * signed-in consumer, creator, enterprise and admin surfaces are unchanged.
 * Structure mirrors a three-column plan chooser: name, blurb, price, action,
 * then the included list underneath each column.
 */

type Plan = {
  id: string;
  name: string;
  icon: typeof Headphones;
  blurb: string;
  price: string;
  priceNote?: string;
  cta: { label: string; to?: string; href?: string; variant?: "default" | "outline" };
  highlight?: boolean;
  headline: string[];
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: "listener",
    name: "Listener",
    icon: Headphones,
    blurb: "For anyone who wants to hear what their own sound says about them.",
    price: "Free",
    priceNote: "email sign-in, no card",
    cta: { label: "Create your account", to: "/auth", variant: "outline" },
    headline: ["Up to 3 trial analyses", "Email address + terms consent"],
    features: [
      "Listen: upload a file, search a streaming service or pick from the shared library",
      "Understand: your six-category scores and how your sounds connect",
      "Library: keep your analyses and build a personal sonic signature",
      "You agree to share your analysis data with the SonicSIM commons",
    ],
  },
  {
    id: "creator",
    name: "Creator",
    icon: Palette,
    blurb: "For artists and sound designers who want their work measured and credited.",
    price: "Creator access",
    priceNote: "by application",
    cta: { label: "Apply for creator access", to: "/creator" },
    highlight: true,
    headline: ["Everything in Listener", "Rights and licence records"],
    features: [
      "Unlimited analyses across your own catalogue",
      "Originality and divergence against the wider market",
      "Lineage: what your work sounds close to, and what it doesn't",
      "Add work to the Sonic Commons with your licence terms and payout details",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    icon: Building2,
    blurb: "For teams using sound to understand and reach real audiences.",
    price: "Platform fee",
    priceNote: "volume based, talk to us",
    cta: {
      label: "Book a demo",
      href: "mailto:hello@sonicsimai.com?subject=SonicSIM%20Enterprise%20—%20Book%20a%20demo",
    },
    headline: ["Everything in Creator", "Shared team workspace"],
    features: [
      "Audience cohorts built from sonic behaviour, not guesses",
      "Predicted reach and match strength before you spend",
      "Connected data sources and audience activations",
      "Access controls, audit history and support",
    ],
  },
];

export const AccessPlans = () => {
  return (
    <section aria-labelledby="access-plans-heading" className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
      <div className="mb-6">
        <h2
          id="access-plans-heading"
          className="text-xl font-bold tracking-tight text-foreground sm:text-2xl"
        >
          Choose your access level
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Start free as a Listener. Move up when you want your own catalogue or your team&apos;s
          audiences measured.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <div key={plan.id} className="flex flex-col">
              <Card
                className={`p-6 ${
                  plan.highlight ? "border-primary/40 shadow-elegant" : "border-border/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                </div>
                <p className="mt-2 min-h-[3rem] text-sm text-muted-foreground">{plan.blurb}</p>

                <p className="mt-4 text-3xl font-bold text-foreground">{plan.price}</p>
                {plan.priceNote && (
                  <p className="mt-1 text-xs text-muted-foreground">{plan.priceNote}</p>
                )}

                <div className="mt-6">
                  {plan.to ?? plan.cta.to ? (
                    <Button
                      asChild
                      variant={plan.cta.variant ?? "default"}
                      className={`w-full min-h-11 ${plan.highlight ? "gradient-primary shadow-elegant" : ""}`}
                    >
                      <Link to={plan.cta.to!}>{plan.cta.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      asChild
                      variant={plan.cta.variant ?? "default"}
                      className="w-full min-h-11"
                    >
                      <a href={plan.cta.href}>{plan.cta.label}</a>
                    </Button>
                  )}
                </div>
              </Card>

              <div className="mt-4 space-y-2 rounded-xl bg-secondary/10 p-4">
                {plan.headline.map((item) => (
                  <p key={item} className="text-sm font-medium text-foreground">
                    {item}
                  </p>
                ))}
              </div>

              <ul className="mt-4 space-y-2 border-t border-border/60 pt-4">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default AccessPlans;
