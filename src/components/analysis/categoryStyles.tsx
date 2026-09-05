import { Brain, Heart, Users, MessageSquare, MapPin, Music } from "lucide-react";

export interface CategoryScore {
  name: string;
  score: number;
  description: string;
}

// Category color mapping
export const categoryColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  emotional: {
    bg: "bg-category-emotional/10",
    border: "border-category-emotional/30 hover:border-category-emotional/60",
    text: "text-category-emotional",
    glow: "hover:shadow-[0_0_30px_hsl(220_90%_56%/0.3)]",
  },
  cognitive: {
    bg: "bg-category-cognitive/10",
    border: "border-category-cognitive/30 hover:border-category-cognitive/60",
    text: "text-category-cognitive",
    glow: "hover:shadow-[0_0_30px_hsl(142_70%_45%/0.3)]",
  },
  social: {
    bg: "bg-category-social/10",
    border: "border-category-social/30 hover:border-category-social/60",
    text: "text-category-social",
    glow: "hover:shadow-[0_0_30px_hsl(174_72%_40%/0.3)]",
  },
  communication: {
    bg: "bg-category-communication/10",
    border: "border-category-communication/30 hover:border-category-communication/60",
    text: "text-category-communication",
    glow: "hover:shadow-[0_0_30px_hsl(84_80%_44%/0.3)]",
  },
  contextual: {
    bg: "bg-category-contextual/10",
    border: "border-category-contextual/30 hover:border-category-contextual/60",
    text: "text-category-contextual",
    glow: "hover:shadow-[0_0_30px_hsl(200_90%_50%/0.3)]",
  },
  artistic: {
    bg: "bg-category-artistic/10",
    border: "border-category-artistic/30 hover:border-category-artistic/60",
    text: "text-category-artistic",
    glow: "hover:shadow-[0_0_30px_hsl(168_76%_42%/0.3)]",
  },
};

export const getCategoryStyles = (categoryName: string) => {
  return categoryColors[categoryName.toLowerCase()] || categoryColors.emotional;
};

// Icon mapping helper
export const getCategoryIcon = (categoryName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    emotional: <Heart className="h-4 w-4" />,
    cognitive: <Brain className="h-4 w-4" />,
    social: <Users className="h-4 w-4" />,
    communication: <MessageSquare className="h-4 w-4" />,
    contextual: <MapPin className="h-4 w-4" />,
    artistic: <Music className="h-4 w-4" />,
  };

  return iconMap[categoryName.toLowerCase()] || <Brain className="h-4 w-4" />;
};
