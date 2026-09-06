import { useEffect, useState } from "react";

/**
 * Counter that bumps whenever the light/dark class on <html> actually changes.
 *
 * Canvas visuals read their colours from CSS variables once, when they set up
 * their draw loop. Watching the class directly (rather than the theme state)
 * guarantees the repaint happens after the new variables are in place.
 */
export function useThemeTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    let last = root.className;
    const observer = new MutationObserver(() => {
      if (root.className !== last) {
        last = root.className;
        setTick((t) => t + 1);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return tick;
}
