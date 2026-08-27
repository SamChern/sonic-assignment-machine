/**
 * Keyboard shortcuts for Audioscope playback.
 *
 * Attached at the document level while a panel is mounted so keyboard and
 * screen-reader users can drive playback without tabbing to the buttons:
 *
 *   S  — toggle Static (freeze / resume)
 *   K  — toggle Play / Pause
 *   [ / ]  — move focus between mounted audioscope panes (single + compare)
 *
 * Typing in inputs, textareas, selects, or contenteditable regions is never
 * hijacked, and any modifier combination (Ctrl/Cmd/Alt) is left to the browser.
 */
import { useEffect, type RefObject } from "react";

/** Marker attribute placed on each pane's focus anchor (its Static button). */
export const PANE_ANCHOR_ATTR = "data-audioscope-pane";

const isTypingTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node || typeof node.closest !== "function") return false;
  if (node.isContentEditable) return true;
  return Boolean(node.closest("input, textarea, select, [contenteditable='true']"));
};

const paneAnchors = (): HTMLElement[] => {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLElement>(`[${PANE_ANCHOR_ATTR}]`)).filter(
    (el) =>
      el === document.activeElement ||
      (!el.hasAttribute("hidden") && !el.closest("[hidden], [aria-hidden='true']")),
  );
};

const cycleFocus = (direction: 1 | -1) => {
  const panes = paneAnchors();
  if (panes.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const current = panes.findIndex((el) => el === active || el.contains(active));
  const next = panes[(((current === -1 ? 0 : current + direction) % panes.length) + panes.length) % panes.length];
  next?.focus();
};

/**
 * Jump focus to the motion controls (the Static toggle) of the pane the user is
 * in — or, when focus sits outside every pane, the first pane on the page.
 * Exported so notices and links can reuse the exact same behaviour as `M`.
 */
export const focusMotionControls = (container?: HTMLElement | null): boolean => {
  const panes = paneAnchors();
  if (panes.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  const inPane = panes.find((el) => el === active || el.contains(active));
  const scoped = container ? panes.find((el) => container.contains(el)) : undefined;
  const target = inPane ?? scoped ?? panes[0];
  target?.focus();
  return Boolean(target);
};

export type AudioscopeShortcutHandlers = {
  /** The panel root — shortcuts only fire while focus is inside it. */
  containerRef: RefObject<HTMLElement>;
  onToggleStatic: () => void;
  onTogglePlay: () => void;
  /** Set false to detach (e.g. panel has nothing to visualize). */
  enabled?: boolean;
};


/**
 * A panel owns the keystroke when focus sits inside it, or when nothing is
 * focused at all and it is the only audioscope pane on the page.
 */
const ownsKeystroke = (container: HTMLElement | null): boolean => {
  if (!container || typeof document === "undefined") return false;
  const active = document.activeElement;
  if (active && active !== document.body && container.contains(active)) return true;
  if (active && active !== document.body) return false;
  const panes = document.querySelectorAll(`[${PANE_ANCHOR_ATTR}]`);
  return panes.length <= 1 && container.contains(panes[0] ?? container);
};

export const useAudioscopeShortcuts = ({
  containerRef,
  onToggleStatic,
  onTogglePlay,
  enabled = true,
}: AudioscopeShortcutHandlers) => {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      // M works from anywhere on the page, even when focus is outside a pane:
      // it takes the user straight to the motion controls.
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        e.stopImmediatePropagation();
        focusMotionControls(containerRef.current);
        return;
      }
      if (!ownsKeystroke(containerRef.current)) return;
      // Only the owning pane handles the key — stop sibling panes from acting
      // on the same keystroke after focus has moved.
      e.stopImmediatePropagation();

      switch (e.key.toLowerCase()) {
        case "s":
          e.preventDefault();
          onToggleStatic();
          break;
        case "k":
          e.preventDefault();
          onTogglePlay();
          break;
        case "]":
          e.preventDefault();
          cycleFocus(1);
          break;
        case "[":
          e.preventDefault();
          cycleFocus(-1);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, containerRef, onToggleStatic, onTogglePlay]);
};

/** Shared help text so both panels describe the same keys. */
export const SHORTCUT_HINT = "Keys: S static · K play/pause · [ / ] switch panes";
