import { useEffect, useRef } from "react";

/**
 * Fades/blurs the sticky hero logo and reveals the compact header logo as the
 * user scrolls, purely via CSS custom properties (no re-renders).
 */
export function useHeaderScrollEffect() {
  const logoRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const fadeEnd = 280;
      const progress = Math.min(1, Math.max(0, scrollY / fadeEnd));
      if (logoRef.current) {
        logoRef.current.style.setProperty('--logo-opacity', String(1 - progress));
        logoRef.current.style.setProperty('--logo-overlay-opacity', String(progress));
        logoRef.current.style.setProperty('--logo-blur', `${progress * 3}px`);
        logoRef.current.style.setProperty('--logo-scale', String(1 - progress * 0.04));
      }
      if (headerRef.current) {
        headerRef.current.style.setProperty('--header-bg-opacity', String(progress * 0.85));
        headerRef.current.style.setProperty('--header-border-opacity', String(progress * 0.6));
        headerRef.current.style.setProperty('--header-logo-opacity', String(progress));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return { logoRef, headerRef };
}
