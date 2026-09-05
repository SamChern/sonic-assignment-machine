export interface UserProfile {
  id: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface AudioSourceWithProfile {
  id: string;
  user_id: string;
  source_type: string;
  name: string;
  spotify_id: string | null;
  album_image: string | null;
  artists: string[] | null;
  preview_url: string | null;
  created_at: string;
  profile?: UserProfile | null;
}

export type EntityMode = "user" | "provider" | "signal";

export const PROVIDER_META: Record<string, { label: string; description: string }> = {
  spotify: { label: "Spotify", description: "Music streaming catalog" },
  file: { label: "File uploads", description: "Direct audio uploads" },
  intuizi: { label: "Intuizi", description: "Signal provider feed (CTV / apps)" },
  ctv: { label: "CTV feed", description: "Connected TV audio signals" },
};

export const providerMeta = (key: string) =>
  PROVIDER_META[key] || { label: key, description: "Signal source" };
