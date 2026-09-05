import { Disc3, Music4, Tag } from "lucide-react";

export type Kind = "label" | "album" | "track";

export interface CatalogItem {
  id: string;
  kind: Kind;
  title: string;
  artist: string | null;
  label_name: string | null;
  release_year: number | null;
  parent_id: string | null;
  audio_source_id: string | null;
  symbols: string[];
  notes: string | null;
  created_at: string;
  for_sale: boolean;
  price_cents: number | null;
  currency: string | null;
  listing_note: string | null;
}

export const KIND_META: Record<Kind, { label: string; icon: typeof Music4 }> = {
  label: { label: "Label", icon: Tag },
  album: { label: "Album", icon: Disc3 },
  track: { label: "Track", icon: Music4 },
};
