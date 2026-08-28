import { Check } from "lucide-react";
import emotionIcon from "@/assets/emotion-sam.png";
import socialIcon from "@/assets/social-sam.png";
import contextIcon from "@/assets/context-sam.png";
import cognitionIcon from "@/assets/cognition-sam.png";
import communicationIcon from "@/assets/communication-sam.png";
import artisticIcon from "@/assets/artistic-sam.png";
import { CATEGORY_COLORS } from "./types";

const CATEGORY_ICONS: Record<string, string> = {
  Emotional: emotionIcon,
  Social: socialIcon,
  Cognitive: cognitionIcon,
  Communication: communicationIcon,
  Contextual: contextIcon,
  Artistic: artisticIcon,
};

interface CategoryLegendProps {
  selectedCategories: Set<string>;
  setSelectedCategories: (updater: (prev: Set<string>) => Set<string>) => void;
}

/** Bottom-right category legend with click-to-filter selection (masked icon per category). */
export const CategoryLegend = ({ selectedCategories, setSelectedCategories }: CategoryLegendProps) => {
  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-md border border-primary/20 rounded-lg p-3 shadow-lg z-20">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-foreground">Category Legend</div>
        {selectedCategories.size > 0 && (
          <button
            onClick={() => setSelectedCategories(() => new Set())}
            className="text-[10px] px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors duration-200"
          >
            Clear All
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {Object.entries(CATEGORY_COLORS).map(([category, color]) => {
          const isSelected = selectedCategories.has(category);
          const isAnySelected = selectedCategories.size > 0;
          const icon = CATEGORY_ICONS[category];

          return (
            <div
              key={category}
              className="flex items-center gap-1.5 group cursor-pointer relative"
              style={{
                padding: '2px 4px',
                borderRadius: '4px',
                backgroundColor: isSelected ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                border: isSelected ? '1px solid hsl(var(--primary) / 0.3)' : '1px solid transparent',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: isSelected ? 'scale(1.02)' : 'scale(1)',
              }}
              onClick={() => toggleCategory(category)}
            >
              {icon ? (
                <div
                  className="h-3 w-3 transition-all duration-200 group-hover:scale-140"
                  style={{
                    backgroundColor: color,
                    WebkitMaskImage: `url(${icon})`,
                    WebkitMaskSize: '90% 90%',
                    WebkitMaskPosition: 'center',
                    WebkitMaskRepeat: 'no-repeat',
                    maskImage: `url(${icon})`,
                    maskSize: '90% 90%',
                    maskPosition: 'center',
                    maskRepeat: 'no-repeat',
                    border: 'none',
                    outline: '0',
                    display: 'block',
                    filter: 'drop-shadow(0 0 0px transparent)',
                  }}
                />
              ) : (
                <div
                  className="h-2.5 w-2.5 rounded-full transition-all duration-200 group-hover:scale-140"
                  style={{ backgroundColor: color, filter: 'drop-shadow(0 0 0px transparent)' }}
                />
              )}
              <span
                className="text-xs flex-1"
                style={{
                  color: isAnySelected && !isSelected ? 'hsl(var(--muted-foreground) / 0.4)' : 'hsl(var(--muted-foreground))',
                  fontWeight: isSelected ? 600 : 400,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                {category}
              </span>
              <div
                className="overflow-hidden"
                style={{
                  width: isSelected ? '12px' : '0px',
                  opacity: isSelected ? 1 : 0,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                <Check className="h-3 w-3 text-primary" strokeWidth={3} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
