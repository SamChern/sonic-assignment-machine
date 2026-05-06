export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      audio_sources: {
        Row: {
          album_image: string | null
          album_name: string | null
          artists: string[] | null
          created_at: string
          file_url: string | null
          id: string
          librosa_features: Json | null
          name: string
          preview_url: string | null
          source_type: string
          spotify_id: string | null
          spotify_url: string | null
          user_id: string
        }
        Insert: {
          album_image?: string | null
          album_name?: string | null
          artists?: string[] | null
          created_at?: string
          file_url?: string | null
          id?: string
          librosa_features?: Json | null
          name: string
          preview_url?: string | null
          source_type: string
          spotify_id?: string | null
          spotify_url?: string | null
          user_id: string
        }
        Update: {
          album_image?: string | null
          album_name?: string | null
          artists?: string[] | null
          created_at?: string
          file_url?: string | null
          id?: string
          librosa_features?: Json | null
          name?: string
          preview_url?: string | null
          source_type?: string
          spotify_id?: string | null
          spotify_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      integration_credentials: {
        Row: {
          created_at: string
          field_key: string
          field_value: string
          id: string
          integration_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          field_key: string
          field_value: string
          id?: string
          integration_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          field_key?: string
          field_value?: string
          id?: string
          integration_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      integration_test_history: {
        Row: {
          error_message: string | null
          id: string
          integration_id: string
          latency_ms: number | null
          response_sample: Json | null
          success: boolean
          tested_at: string
          tested_by: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          integration_id: string
          latency_ms?: number | null
          response_sample?: Json | null
          success: boolean
          tested_at?: string
          tested_by?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          integration_id?: string
          latency_ms?: number | null
          response_sample?: Json | null
          success?: boolean
          tested_at?: string
          tested_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      source_analyses: {
        Row: {
          artistic_desc: string | null
          artistic_score: number
          audio_source_id: string | null
          cognitive_desc: string | null
          cognitive_score: number
          communication_desc: string | null
          communication_score: number
          confidence: number
          contextual_desc: string | null
          contextual_score: number
          created_at: string
          emotional_desc: string | null
          emotional_score: number
          id: string
          social_desc: string | null
          social_score: number
          source_name: string
          user_id: string
        }
        Insert: {
          artistic_desc?: string | null
          artistic_score: number
          audio_source_id?: string | null
          cognitive_desc?: string | null
          cognitive_score: number
          communication_desc?: string | null
          communication_score: number
          confidence?: number
          contextual_desc?: string | null
          contextual_score: number
          created_at?: string
          emotional_desc?: string | null
          emotional_score: number
          id?: string
          social_desc?: string | null
          social_score: number
          source_name: string
          user_id: string
        }
        Update: {
          artistic_desc?: string | null
          artistic_score?: number
          audio_source_id?: string | null
          cognitive_desc?: string | null
          cognitive_score?: number
          communication_desc?: string | null
          communication_score?: number
          confidence?: number
          contextual_desc?: string | null
          contextual_score?: number
          created_at?: string
          emotional_desc?: string | null
          emotional_score?: number
          id?: string
          social_desc?: string | null
          social_score?: number
          source_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_analyses_audio_source_id_fkey"
            columns: ["audio_source_id"]
            isOneToOne: false
            referencedRelation: "audio_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_cache: {
        Row: {
          artistic_desc: string | null
          artistic_score: number
          cognitive_desc: string | null
          cognitive_score: number
          communication_desc: string | null
          communication_score: number
          contextual_desc: string | null
          contextual_score: number
          created_at: string
          emotional_desc: string | null
          emotional_score: number
          id: string
          social_desc: string | null
          social_score: number
          source_key: string
          source_name: string
          source_type: string
        }
        Insert: {
          artistic_desc?: string | null
          artistic_score: number
          cognitive_desc?: string | null
          cognitive_score: number
          communication_desc?: string | null
          communication_score: number
          contextual_desc?: string | null
          contextual_score: number
          created_at?: string
          emotional_desc?: string | null
          emotional_score: number
          id?: string
          social_desc?: string | null
          social_score: number
          source_key: string
          source_name: string
          source_type: string
        }
        Update: {
          artistic_desc?: string | null
          artistic_score?: number
          cognitive_desc?: string | null
          cognitive_score?: number
          communication_desc?: string | null
          communication_score?: number
          contextual_desc?: string | null
          contextual_score?: number
          created_at?: string
          emotional_desc?: string | null
          emotional_score?: number
          id?: string
          social_desc?: string | null
          social_score?: number
          source_key?: string
          source_name?: string
          source_type?: string
        }
        Relationships: []
      }
      user_fingerprints: {
        Row: {
          artistic_avg: number
          artistic_avg_recent: number
          cognitive_avg: number
          cognitive_avg_recent: number
          communication_avg: number
          communication_avg_recent: number
          contextual_avg: number
          contextual_avg_recent: number
          created_at: string
          emotional_avg: number
          emotional_avg_recent: number
          fingerprint_confidence: number
          id: string
          recent_sources_analyzed: number
          social_avg: number
          social_avg_recent: number
          total_sources_analyzed: number
          updated_at: string
          user_id: string
        }
        Insert: {
          artistic_avg?: number
          artistic_avg_recent?: number
          cognitive_avg?: number
          cognitive_avg_recent?: number
          communication_avg?: number
          communication_avg_recent?: number
          contextual_avg?: number
          contextual_avg_recent?: number
          created_at?: string
          emotional_avg?: number
          emotional_avg_recent?: number
          fingerprint_confidence?: number
          id?: string
          recent_sources_analyzed?: number
          social_avg?: number
          social_avg_recent?: number
          total_sources_analyzed?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          artistic_avg?: number
          artistic_avg_recent?: number
          cognitive_avg?: number
          cognitive_avg_recent?: number
          communication_avg?: number
          communication_avg_recent?: number
          contextual_avg?: number
          contextual_avg_recent?: number
          created_at?: string
          emotional_avg?: number
          emotional_avg_recent?: number
          fingerprint_confidence?: number
          id?: string
          recent_sources_analyzed?: number
          social_avg?: number
          social_avg_recent?: number
          total_sources_analyzed?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_score_to_percentile: {
        Args: { pop_mean: number; pop_stddev: number; raw_score: number }
        Returns: number
      }
      recalculate_all_fingerprints: { Args: never; Returns: number }
      recalculate_user_fingerprint: {
        Args: { p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
