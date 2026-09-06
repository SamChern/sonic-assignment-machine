# Light palette + light/dark toggle — colours only

Every screen keeps its exact layout, wording, tabs and behaviour. Only colours change: the new light palette (teal, deep navy, turquoise, light blue, cool greys) becomes the light theme, your existing dark palette stays exactly as it is as the dark theme, and people can switch between them.

## Will this break anything?

Short answer: no functionality changes, but two things need care.

Safe, because the site is already token-driven:
- Buttons, cards, tabs, inputs, badges and charts all read named colour slots (primary, card, border, chart-1…5, category-*). Changing the slot values recolours everything at once.
- The wave and scope visuals read those same slots live at draw time, so they follow both themes automatically.
- Almost no screen hardcodes a colour: only 6 files do, and they are all chart/legend palettes that will be switched to tokens — which is also what makes them theme-aware.
- No colour is stored in the database, used in scoring, or sent to the backend. Analyses, matching, ingestion, sign-in and emails are untouched.

Needs care (covered in the steps below):
1. **Light mode is the real work, not the hues.** Today everything is designed against a near-black page. Each text/background pair has to be re-checked on white, since pale text on a pale card is the classic failure.
2. **The six meaning colours change in light mode.** You chose to recolour them to the new family, so Emotional, Cognitive, Social, Communication, Contextual and Artistic must stay clearly tellable apart in charts, the network graph and the legend — spaced by lightness as well as hue. The dark theme keeps its current six unchanged.
3. **Visual fallbacks.** The canvas visuals use a hardcoded colour for the very first frame before styles resolve; those get theme-aware values so a light page never flashes a dark scope.

## The toggle

- Light is the default for new visitors; the choice is remembered on the device and follows the system setting until someone picks explicitly.
- A small sun/moon control in the top bar on desktop and in the same header on phones — no new page or menu.
- Both themes carry the full token set, so nothing can half-switch.

## Light palette

Proposed values; adjust any before or after approval. The dark values stay exactly as they are today.

| Slot | Light value |
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
| "Gold" slot | deep navy `#123A6B` |
| Charts 1-5 | teal, deep navy, deep turquoise, light blue, pale teal |
| Categories | Emotional teal · Cognitive deep navy · Social turquoise · Communication light blue · Contextual medium teal · Artistic mid navy |

Gradients (brand, teal, subtle, app mesh, per-category) get light-theme versions in the same family, kept low-contrast so text stays readable on top.

## Steps

1. In `src/index.css`, make `:root` the light theme with the palette above (colours, gradients, shadow tints, app background mesh) and keep the current values in `.dark` untouched, filling in any slot the light set adds.
2. Keep `tailwind.config.ts` mapping the same slot names (it already matches the structure you sent) and add the `<alpha-value>` form so opacity utilities work on every colour.
3. Add a theme provider and a header toggle: class-based switching on the page root, remembered per device, system default, no flash on first paint. Point the toast theme at the active theme instead of a fixed one.
4. Replace hardcoded hex palettes with tokens in `src/components/graph/adapters/aggregate.ts`, `src/components/SignalCohortPanel.tsx`, `src/components/FingerprintComparison.tsx`, and update the fallback hexes in `Audioscope.tsx`, `AudioscopeCompare.tsx`, `SemanticScope.tsx`, `WaveInspect.tsx` to follow the active theme. Delete the unused React starter colours in `src/App.css`.
5. Make the browser/phone chrome colour follow the theme (`index.html` meta plus `public/manifest.webmanifest`).
6. Sweep for light-on-light or dark-on-dark pairs in both themes (dialog overlays, legends, `NetworkVisualization`, badges over gradients) and fix them with tokens only.
7. Verify: typecheck, tests and build, then walk home, the understand/library flow, workspace Predict, methodology, creator space and admin dashboard in the browser — in both themes, at desktop and phone widths — checking readability and that the six category colours stay tellable apart.

## Technical notes

- All values stay HSL triplets in `index.css`; no component gets a raw hex or a `text-white`/`bg-black` class.
- Theme switching is class-based (`.dark` on the root) so the existing dark block keeps working untouched; `next-themes` is already a dependency via the toast component.
- Canvas visuals keep their `readVar` helper and redraw on theme change so a switch repaints the scope immediately.
- Gradient variable names are unchanged, so no component imports change.
