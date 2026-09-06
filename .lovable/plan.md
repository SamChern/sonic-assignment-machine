# Light palette overhaul — colours only

Every screen keeps its exact layout, wording, tabs and behaviour. Only the colour values behind them change: the site becomes light-only, built on a restricted palette of teal, deep navy, turquoise, light blue and cool greys.

## Will this break anything?

Short answer: no functionality changes, but two things need care.

Safe, because the site is already token-driven:
- Buttons, cards, tabs, inputs, badges and charts all read named colour slots (primary, card, border, chart-1…5, category-*). Changing the slot values recolours everything at once.
- The wave and scope visuals read those same slots live at draw time, so they follow automatically.
- Almost no screen hardcodes a colour: only 6 files do, and they are all chart/legend palettes that will be switched to the tokens.
- No colour is stored in the database, used in scoring, or sent to the backend. Analyses, matching, ingestion, sign-in and emails are untouched.

Needs care (covered in the steps below):
1. **Going light-only is the real risk, not the hues.** Today the page is near-black with pale text. Flipping to light means every text/background pair has to be re-checked for readability — light text on a light card is the classic failure. The dark values are removed rather than left behind, so nothing can half-switch.
2. **The six meaning colours change.** You chose to recolour them. Because the new palette is all teal/blue family, Emotional, Cognitive, Social, Communication, Contextual and Artistic must stay clearly distinguishable from each other in charts, the network graph and the legend — spaced by lightness as well as hue, and re-checked on the light background.

Minor knock-ons, all handled: the phone/browser theme colour and install-screen colour, the toast theme, the glow/shadow tints, and the background mesh.

## Palette (light-only)

Proposed values; adjust any before or after approval.

| Slot | Value |
| --- | --- |
| Page background | very light cool grey `#F5F8F8` |
| Card / popover surface | white `#FFFFFF` |
| Text | near-black slate `#0F1C21` |
| Muted text | cool grey `#5B6B70` |
| Primary (rich teal) | `#0E8F84`, text on it white |
| Secondary / input fills | light cool grey `#E7EDEE` |
| Borders | `#D3DEDF` |
| Accent | turquoise `#14B8A6` |
| Destructive | `#C8352C` |
| Success | teal `#0E8F84` |
| "Gold" slot (renamed in value only) | deep navy `#123A6B` |
| Charts 1-5 | teal, deep navy, deep turquoise, light blue, pale teal |
| Categories | Emotional teal · Cognitive deep navy · Social turquoise · Communication light blue · Contextual medium teal · Artistic mid navy |

Gradients (brand, teal, subtle, app mesh, per-category) are rebuilt in the same family, light and low-contrast so text stays readable on top.

## Steps

1. Rewrite the colour tokens in `src/index.css` as a single light theme, including gradients, shadow tints and the app background mesh. Remove the duplicated `.dark` block so there is one source of truth.
2. Keep `tailwind.config.ts` mapping the same slot names (it already matches the structure you sent); add the `<alpha-value>` form so opacity utilities work on every colour.
3. Replace the hardcoded hex palettes with tokens in: `src/components/graph/adapters/aggregate.ts`, `src/components/SignalCohortPanel.tsx`, `src/components/FingerprintComparison.tsx`, plus the fallback hexes inside `Audioscope.tsx`, `AudioscopeCompare.tsx`, `SemanticScope.tsx`, `WaveInspect.tsx`. Delete the unused React starter colours in `src/App.css`.
4. Update `index.html` theme colour and `public/manifest.webmanifest` theme/background colours, and set the toast theme to light.
5. Sweep for any remaining light-on-light or dark-on-dark pairs (dialog overlays, legends, `NetworkVisualization`, badges over gradients) and fix them with tokens only.
6. Verify: typecheck, tests and build, then walk the home page, understand/library flow, workspace Predict, methodology, creator space and admin dashboard in the browser at desktop and phone widths, checking readability and that the six category colours remain tellable apart.

## Technical notes

- All values stay HSL triplets in `index.css`; no component gets a raw hex or a `text-white`/`bg-black` class.
- Canvas visuals convert tokens via their existing `readVar` helper, so their fallbacks are updated to light equivalents for the first frame before styles resolve.
- Category hue/lightness spacing is chosen for chart separation, and gradients keep their existing variable names so no component imports change.
