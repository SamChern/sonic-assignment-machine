import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadDMSans } from "@remotion/google-fonts/DMSans";

export const display = loadSpaceGrotesk("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
}).fontFamily;

export const body = loadDMSans("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
}).fontFamily;

/** Mirrors the app's tokens: near-black teal-ink surfaces, green-teal accent. */
export const C = {
  ink: "#050A0A",
  ink2: "#0A1413",
  panel: "#0E1A19",
  line: "#1E3330",
  fg: "#EAF6F4",
  muted: "#8FA5A2",
  teal: "#5ECFC0",
  tealSoft: "#9BE7DC",
  deep: "#2C7F76",
};

/** The six semantic categories, in canonical order, with the app's colours. */
export const CATS = [
  { name: "Emotional", short: "Emo", color: "hsl(0, 70%, 60%)" },
  { name: "Cognitive", short: "Cog", color: "hsl(210, 70%, 60%)" },
  { name: "Social", short: "Soc", color: "hsl(120, 50%, 50%)" },
  { name: "Communication", short: "Comm", color: "hsl(45, 80%, 55%)" },
  { name: "Contextual", short: "Ctx", color: "hsl(280, 60%, 60%)" },
  { name: "Artistic", short: "Art", color: "hsl(330, 70%, 60%)" },
];
