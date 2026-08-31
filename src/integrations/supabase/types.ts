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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_guide_entries: {
        Row: {
          archived: boolean
          body: string
          category: string
          created_at: string
          id: string
          kind: string
          related_functions: string[]
          related_routes: string[]
          slug: string
          sort_order: number
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          verify_note: string | null
          version: string | null
        }
        Insert: {
          archived?: boolean
          body?: string
          category?: string
          created_at?: string
          id?: string
          kind?: string
          related_functions?: string[]
          related_routes?: string[]
          slug: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          verify_note?: string | null
          version?: string | null
        }
        Update: {
          archived?: boolean
          body?: string
          category?: string
          created_at?: string
          id?: string
          kind?: string
          related_functions?: string[]
          related_routes?: string[]
          slug?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          verify_note?: string | null
          version?: string | null
        }
        Relationships: []
      }
      analysis_jobs: {
        Row: {
          attempts: number
          audio_source_id: string | null
          cache_key: string
          created_at: string
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          params: Json
          priority: number
          started_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          audio_source_id?: string | null
          cache_key: string
          created_at?: string
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          params?: Json
          priority?: number
          started_at?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          audio_source_id?: string | null
          cache_key?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          params?: Json
          priority?: number
          started_at?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audio_profile_embeddings: {
        Row: {
          cache_key: string
          created_at: string
          dims: number
          embedding: string
          hit_count: number
          last_used_at: string
          model: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          dims?: number
          embedding: string
          hit_count?: number
          last_used_at?: string
          model: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          dims?: number
          embedding?: string
          hit_count?: number
          last_used_at?: string
          model?: string
        }
        Relationships: []
      }
      audio_source_tags: {
        Row: {
          audio_source_id: string
          created_at: string
          id: string
          node_id: string
          weight: number
        }
        Insert: {
          audio_source_id: string
          created_at?: string
          id?: string
          node_id: string
          weight?: number
        }
        Update: {
          audio_source_id?: string
          created_at?: string
          id?: string
          node_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "audio_source_tags_audio_source_id_fkey"
            columns: ["audio_source_id"]
            isOneToOne: false
            referencedRelation: "audio_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_source_tags_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_sources: {
        Row: {
          album_image: string | null
          album_name: string | null
          analysis_error: string | null
          analysis_status: string
          artists: string[] | null
          created_at: string
          ctv_metadata: Json | null
          file_url: string | null
          id: string
          librosa_features: Json | null
          name: string
          organization_id: string | null
          preview_url: string | null
          profile_embedding: string | null
          source_type: string
          spotify_id: string | null
          spotify_url: string | null
          user_id: string
        }
        Insert: {
          album_image?: string | null
          album_name?: string | null
          analysis_error?: string | null
          analysis_status?: string
          artists?: string[] | null
          created_at?: string
          ctv_metadata?: Json | null
          file_url?: string | null
          id?: string
          librosa_features?: Json | null
          name: string
          organization_id?: string | null
          preview_url?: string | null
          profile_embedding?: string | null
          source_type: string
          spotify_id?: string | null
          spotify_url?: string | null
          user_id: string
        }
        Update: {
          album_image?: string | null
          album_name?: string | null
          analysis_error?: string | null
          analysis_status?: string
          artists?: string[] | null
          created_at?: string
          ctv_metadata?: Json | null
          file_url?: string | null
          id?: string
          librosa_features?: Json | null
          name?: string
          organization_id?: string | null
          preview_url?: string | null
          profile_embedding?: string | null
          source_type?: string
          spotify_id?: string | null
          spotify_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      category_calibration: {
        Row: {
          bias: number
          category: string
          id: string
          m2: number
          mean_score: number
          n: number
          taxonomy_node_id: string
          updated_at: string
        }
        Insert: {
          bias?: number
          category: string
          id?: string
          m2?: number
          mean_score?: number
          n?: number
          taxonomy_node_id: string
          updated_at?: string
        }
        Update: {
          bias?: number
          category?: string
          id?: string
          m2?: number
          mean_score?: number
          n?: number
          taxonomy_node_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_calibration_taxonomy_node_id_fkey"
            columns: ["taxonomy_node_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      category_feedback: {
        Row: {
          category: string
          corrected_score: number | null
          created_at: string
          delta: number | null
          id: string
          note: string | null
          rater_user_id: string | null
          source_analysis_id: string
        }
        Insert: {
          category: string
          corrected_score?: number | null
          created_at?: string
          delta?: number | null
          id?: string
          note?: string | null
          rater_user_id?: string | null
          source_analysis_id: string
        }
        Update: {
          category?: string
          corrected_score?: number | null
          created_at?: string
          delta?: number | null
          id?: string
          note?: string | null
          rater_user_id?: string | null
          source_analysis_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_feedback_source_analysis_id_fkey"
            columns: ["source_analysis_id"]
            isOneToOne: false
            referencedRelation: "source_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      category_outcome_priors: {
        Row: {
          category: string
          ci_high: number | null
          ci_low: number | null
          cohort_slug: string | null
          created_at: string
          exposed_n: number
          holdout_n: number
          id: string
          kpi: string
          lift: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          category: string
          ci_high?: number | null
          ci_low?: number | null
          cohort_slug?: string | null
          created_at?: string
          exposed_n?: number
          holdout_n?: number
          id?: string
          kpi: string
          lift?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          ci_high?: number | null
          ci_low?: number | null
          cohort_slug?: string | null
          created_at?: string
          exposed_n?: number
          holdout_n?: number
          id?: string
          kpi?: string
          lift?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_outcome_priors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      control_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          key: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          key: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          key?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: []
      }
      control_registry: {
        Row: {
          bounds: Json | null
          category: string
          created_at: string
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          value_type: string
        }
        Insert: {
          bounds?: Json | null
          category?: string
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          value_type: string
        }
        Update: {
          bounds?: Json | null
          category?: string
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          value_type?: string
        }
        Relationships: []
      }
      creator_works: {
        Row: {
          analysis_error: string | null
          analysis_status: string
          archetype_slug: string | null
          audio_source_id: string | null
          corpus_opt_in: boolean
          created_at: string
          divergence: number | null
          embedding_hash: string | null
          fingerprint: Json
          id: string
          machine_use_terms: string
          registered_at: string | null
          resonance: number | null
          rights_attested: boolean
          six_axis: Json
          storage_path: string | null
          title: string
          updated_at: string
          user_id: string
          withdrawn_at: string | null
        }
        Insert: {
          analysis_error?: string | null
          analysis_status?: string
          archetype_slug?: string | null
          audio_source_id?: string | null
          corpus_opt_in?: boolean
          created_at?: string
          divergence?: number | null
          embedding_hash?: string | null
          fingerprint?: Json
          id?: string
          machine_use_terms?: string
          registered_at?: string | null
          resonance?: number | null
          rights_attested?: boolean
          six_axis?: Json
          storage_path?: string | null
          title: string
          updated_at?: string
          user_id: string
          withdrawn_at?: string | null
        }
        Update: {
          analysis_error?: string | null
          analysis_status?: string
          archetype_slug?: string | null
          audio_source_id?: string | null
          corpus_opt_in?: boolean
          created_at?: string
          divergence?: number | null
          embedding_hash?: string | null
          fingerprint?: Json
          id?: string
          machine_use_terms?: string
          registered_at?: string | null
          resonance?: number | null
          rights_attested?: boolean
          six_axis?: Json
          storage_path?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_works_archetype_slug_fkey"
            columns: ["archetype_slug"]
            isOneToOne: false
            referencedRelation: "sonic_archetypes"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "creator_works_audio_source_id_fkey"
            columns: ["audio_source_id"]
            isOneToOne: false
            referencedRelation: "audio_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ctv_ingest_batches: {
        Row: {
          created_at: string
          error_message: string | null
          failed_rows: number
          feed_name: string
          file_uri: string | null
          id: string
          ingested_by: string | null
          row_details: Json
          status: string
          success_rows: number
          total_rows: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          failed_rows?: number
          feed_name: string
          file_uri?: string | null
          id?: string
          ingested_by?: string | null
          row_details?: Json
          status?: string
          success_rows?: number
          total_rows?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          failed_rows?: number
          feed_name?: string
          file_uri?: string | null
          id?: string
          ingested_by?: string | null
          row_details?: Json
          status?: string
          success_rows?: number
          total_rows?: number
          updated_at?: string
        }
        Relationships: []
      }
      dataset_connections: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          credential_ref: string | null
          id: string
          last_error: string | null
          last_tested_at: string | null
          name: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credential_ref?: string | null
          id?: string
          last_error?: string | null
          last_tested_at?: string | null
          name: string
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credential_ref?: string | null
          id?: string
          last_error?: string | null
          last_tested_at?: string | null
          name?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataset_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      embedding_bridges: {
        Row: {
          activated_at: string | null
          created_at: string
          eval_agreement: number | null
          from_dim: number
          id: string
          is_active: boolean
          kind: string
          license_ledger: Json
          manifest: Json
          name: string
          to_dim: number
          version: string
          weights_url: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          eval_agreement?: number | null
          from_dim: number
          id?: string
          is_active?: boolean
          kind?: string
          license_ledger?: Json
          manifest?: Json
          name: string
          to_dim: number
          version?: string
          weights_url?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          eval_agreement?: number | null
          from_dim?: number
          id?: string
          is_active?: boolean
          kind?: string
          license_ledger?: Json
          manifest?: Json
          name?: string
          to_dim?: number
          version?: string
          weights_url?: string | null
        }
        Relationships: []
      }
      embedding_cache: {
        Row: {
          created_at: string
          embedding: string
          model: string
          text_hash: string
        }
        Insert: {
          created_at?: string
          embedding: string
          model?: string
          text_hash: string
        }
        Update: {
          created_at?: string
          embedding?: string
          model?: string
          text_hash?: string
        }
        Relationships: []
      }
      enterprise_datasets: {
        Row: {
          artistic_avg: number | null
          cognitive_avg: number | null
          communication_avg: number | null
          contextual_avg: number | null
          created_at: string
          created_by: string | null
          description: string | null
          emotional_avg: number | null
          id: string
          name: string
          organization_id: string
          row_count: number
          scored_count: number
          shared: boolean
          social_avg: number | null
          source_kind: string
          status: string
          updated_at: string
        }
        Insert: {
          artistic_avg?: number | null
          cognitive_avg?: number | null
          communication_avg?: number | null
          contextual_avg?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          emotional_avg?: number | null
          id?: string
          name: string
          organization_id: string
          row_count?: number
          scored_count?: number
          shared?: boolean
          social_avg?: number | null
          source_kind?: string
          status?: string
          updated_at?: string
        }
        Update: {
          artistic_avg?: number | null
          cognitive_avg?: number | null
          communication_avg?: number | null
          contextual_avg?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          emotional_avg?: number | null
          id?: string
          name?: string
          organization_id?: string
          row_count?: number
          scored_count?: number
          shared?: boolean
          social_avg?: number | null
          source_kind?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_datasets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enterprise_records: {
        Row: {
          analysis_error: string | null
          analysis_status: string
          artistic_score: number | null
          attributes: Json
          audio_url: string | null
          cognitive_score: number | null
          communication_score: number | null
          contextual_score: number | null
          created_at: string
          dataset_id: string
          emotional_score: number | null
          external_user_id: string | null
          id: string
          kpi: Json
          organization_id: string
          score_confidence: number | null
          social_score: number | null
          source_name: string | null
          updated_at: string
        }
        Insert: {
          analysis_error?: string | null
          analysis_status?: string
          artistic_score?: number | null
          attributes?: Json
          audio_url?: string | null
          cognitive_score?: number | null
          communication_score?: number | null
          contextual_score?: number | null
          created_at?: string
          dataset_id: string
          emotional_score?: number | null
          external_user_id?: string | null
          id?: string
          kpi?: Json
          organization_id: string
          score_confidence?: number | null
          social_score?: number | null
          source_name?: string | null
          updated_at?: string
        }
        Update: {
          analysis_error?: string | null
          analysis_status?: string
          artistic_score?: number | null
          attributes?: Json
          audio_url?: string | null
          cognitive_score?: number | null
          communication_score?: number | null
          contextual_score?: number | null
          created_at?: string
          dataset_id?: string
          emotional_score?: number | null
          external_user_id?: string | null
          id?: string
          kpi?: Json
          organization_id?: string
          score_confidence?: number | null
          social_score?: number | null
          source_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "enterprise_datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      grounding_assets: {
        Row: {
          attribution: string
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          embedded_at: string | null
          id: string
          license: string
          source_url: string | null
          status: string
          storage_path: string | null
          taxonomy_code: string
          taxonomy_node_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          attribution: string
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          embedded_at?: string | null
          id?: string
          license: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          taxonomy_code: string
          taxonomy_node_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          attribution?: string
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          embedded_at?: string | null
          id?: string
          license?: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          taxonomy_code?: string
          taxonomy_node_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grounding_assets_taxonomy_node_id_fkey"
            columns: ["taxonomy_node_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      grounding_queue: {
        Row: {
          asset_id: string | null
          attribution: string
          created_at: string
          id: string
          license: string
          notes: string | null
          origin: string
          proposed_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_url: string | null
          status: string
          storage_path: string | null
          taxonomy_code: string
          title: string | null
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          attribution: string
          created_at?: string
          id?: string
          license: string
          notes?: string | null
          origin?: string
          proposed_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          status?: string
          storage_path?: string | null
          taxonomy_code: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          attribution?: string
          created_at?: string
          id?: string
          license?: string
          notes?: string | null
          origin?: string
          proposed_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_url?: string | null
          status?: string
          storage_path?: string | null
          taxonomy_code?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grounding_queue_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "grounding_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_rollup_chunks: {
        Row: {
          created_at: string
          object_key: string
          part_key: string
          rows: number
          source_offset: number
        }
        Insert: {
          created_at?: string
          object_key: string
          part_key?: string
          rows?: number
          source_offset: number
        }
        Update: {
          created_at?: string
          object_key?: string
          part_key?: string
          rows?: number
          source_offset?: number
        }
        Relationships: []
      }
      ingest_rollups: {
        Row: {
          created_at: string
          day: string | null
          object_key: string
          report_type: string | null
          subject_key: string
          taxonomy_code: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          day?: string | null
          object_key: string
          report_type?: string | null
          subject_key: string
          taxonomy_code: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          day?: string | null
          object_key?: string
          report_type?: string | null
          subject_key?: string
          taxonomy_code?: string
          updated_at?: string
          weight?: number
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
      intuizi_identifiers: {
        Row: {
          apps_signals: Json
          audio_source_id: string | null
          created_at: string
          ctv_signals: Json
          demographics_signals: Json
          id: string
          last_seen_at: string | null
          observation_count: number
          origin_signals: Json
          primary_identifier: string
          tag_codes: string[]
          updated_at: string
          visitation_signals: Json
        }
        Insert: {
          apps_signals?: Json
          audio_source_id?: string | null
          created_at?: string
          ctv_signals?: Json
          demographics_signals?: Json
          id?: string
          last_seen_at?: string | null
          observation_count?: number
          origin_signals?: Json
          primary_identifier: string
          tag_codes?: string[]
          updated_at?: string
          visitation_signals?: Json
        }
        Update: {
          apps_signals?: Json
          audio_source_id?: string | null
          created_at?: string
          ctv_signals?: Json
          demographics_signals?: Json
          id?: string
          last_seen_at?: string | null
          observation_count?: number
          origin_signals?: Json
          primary_identifier?: string
          tag_codes?: string[]
          updated_at?: string
          visitation_signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "intuizi_identifiers_audio_source_id_fkey"
            columns: ["audio_source_id"]
            isOneToOne: false
            referencedRelation: "audio_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      intuizi_ingest_files: {
        Row: {
          created_at: string
          cursor_offset: number
          discovered_at: string
          dispatch_attempts: number
          enqueued_at: string | null
          error_message: string | null
          etag: string | null
          failed_rows: number
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          object_key: string
          partition_date: string | null
          processed_rows: number
          promoted_subjects: number
          promotion_cursor: string | null
          queue_message_id: string | null
          report_type: string
          retryable_stops: number
          row_group_cursor: number
          row_groups_total: number | null
          rows_offset: number
          size_bytes: number | null
          started_at: string | null
          status: string
          total_rows: number
          trace_id: string | null
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          cursor_offset?: number
          discovered_at?: string
          dispatch_attempts?: number
          enqueued_at?: string | null
          error_message?: string | null
          etag?: string | null
          failed_rows?: number
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          object_key: string
          partition_date?: string | null
          processed_rows?: number
          promoted_subjects?: number
          promotion_cursor?: string | null
          queue_message_id?: string | null
          report_type: string
          retryable_stops?: number
          row_group_cursor?: number
          row_groups_total?: number | null
          rows_offset?: number
          size_bytes?: number | null
          started_at?: string | null
          status?: string
          total_rows?: number
          trace_id?: string | null
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          cursor_offset?: number
          discovered_at?: string
          dispatch_attempts?: number
          enqueued_at?: string | null
          error_message?: string | null
          etag?: string | null
          failed_rows?: number
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          object_key?: string
          partition_date?: string | null
          processed_rows?: number
          promoted_subjects?: number
          promotion_cursor?: string | null
          queue_message_id?: string | null
          report_type?: string
          retryable_stops?: number
          row_group_cursor?: number
          row_groups_total?: number | null
          rows_offset?: number
          size_bytes?: number | null
          started_at?: string | null
          status?: string
          total_rows?: number
          trace_id?: string | null
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      intuizi_ingest_state: {
        Row: {
          consecutive_rate_limits: number
          created_at: string
          id: string
          last_error: string | null
          last_run_at: string | null
          last_run_summary: Json
          lease_owner: string | null
          lease_until: string | null
          parked_until: string | null
          pause_reason: string | null
          paused: boolean
          paused_at: string | null
          updated_at: string
        }
        Insert: {
          consecutive_rate_limits?: number
          created_at?: string
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          last_run_summary?: Json
          lease_owner?: string | null
          lease_until?: string | null
          parked_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_rate_limits?: number
          created_at?: string
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          last_run_summary?: Json
          lease_owner?: string | null
          lease_until?: string | null
          parked_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      intuizi_mcp_runs: {
        Row: {
          arguments: Json
          created_at: string
          delivered_keys: Json
          error: string | null
          id: string
          idempotency_key: string | null
          resource_id: string | null
          resource_type: string | null
          run_by: string | null
          status: string
          tool_name: string
          updated_at: string
        }
        Insert: {
          arguments?: Json
          created_at?: string
          delivered_keys?: Json
          error?: string | null
          id?: string
          idempotency_key?: string | null
          resource_id?: string | null
          resource_type?: string | null
          run_by?: string | null
          status?: string
          tool_name: string
          updated_at?: string
        }
        Update: {
          arguments?: Json
          created_at?: string
          delivered_keys?: Json
          error?: string | null
          id?: string
          idempotency_key?: string | null
          resource_id?: string | null
          resource_type?: string | null
          run_by?: string | null
          status?: string
          tool_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      intuizi_score_queue: {
        Row: {
          activation_id: string | null
          attempts: number
          confidence: number
          created_at: string
          dead_lettered_at: string | null
          failure_kind: string | null
          finished_at: string | null
          id: string
          identifier: string
          label: string | null
          last_error: string | null
          last_stage: string | null
          max_attempts: number
          next_attempt_at: string
          object_key: string
          owner_id: string | null
          report_type: string
          signals: Json
          started_at: string | null
          status: string
          step_scale: number
          tags: Json
          trace_id: string | null
          updated_at: string
        }
        Insert: {
          activation_id?: string | null
          attempts?: number
          confidence?: number
          created_at?: string
          dead_lettered_at?: string | null
          failure_kind?: string | null
          finished_at?: string | null
          id?: string
          identifier: string
          label?: string | null
          last_error?: string | null
          last_stage?: string | null
          max_attempts?: number
          next_attempt_at?: string
          object_key: string
          owner_id?: string | null
          report_type: string
          signals?: Json
          started_at?: string | null
          status?: string
          step_scale?: number
          tags?: Json
          trace_id?: string | null
          updated_at?: string
        }
        Update: {
          activation_id?: string | null
          attempts?: number
          confidence?: number
          created_at?: string
          dead_lettered_at?: string | null
          failure_kind?: string | null
          finished_at?: string | null
          id?: string
          identifier?: string
          label?: string | null
          last_error?: string | null
          last_stage?: string | null
          max_attempts?: number
          next_attempt_at?: string
          object_key?: string
          owner_id?: string | null
          report_type?: string
          signals?: Json
          started_at?: string | null
          status?: string
          step_scale?: number
          tags?: Json
          trace_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      job_worker_state: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          last_kick_at: string | null
          lease_owner: string | null
          lease_until: string | null
          pause_reason: string | null
          paused: boolean
          paused_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_kick_at?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_kick_at?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      librosa_cache: {
        Row: {
          cache_key: string
          created_at: string
          error_message: string | null
          features: Json | null
          hit_count: number
          last_hit_at: string | null
          params: Json
          ready_at: string | null
          started_at: string
          status: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          error_message?: string | null
          features?: Json | null
          hit_count?: number
          last_hit_at?: string | null
          params?: Json
          ready_at?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          error_message?: string | null
          features?: Json | null
          hit_count?: number
          last_hit_at?: string | null
          params?: Json
          ready_at?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      librosa_call_log: {
        Row: {
          audio_source_id: string | null
          cache_hit: boolean
          cache_key: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          outcome: string
        }
        Insert: {
          audio_source_id?: string | null
          cache_hit?: boolean
          cache_key?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          outcome: string
        }
        Update: {
          audio_source_id?: string | null
          cache_hit?: boolean
          cache_key?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          outcome?: string
        }
        Relationships: []
      }
      org_category_profiles: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          version: number
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_category_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_intuizi_activations: {
        Row: {
          activation_id: string
          created_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          label: string | null
          last_export_at: string | null
          last_export_object_key: string | null
          last_export_row_count: number | null
          last_synced_at: string | null
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          activation_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          last_export_at?: string | null
          last_export_object_key?: string | null
          last_export_row_count?: number | null
          last_synced_at?: string | null
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          activation_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          last_export_at?: string | null
          last_export_object_key?: string | null
          last_export_row_count?: number | null
          last_synced_at?: string | null
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_intuizi_activations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_intuizi_sync_runs: {
        Row: {
          activation_id: string
          coverage_pct: number | null
          created_at: string
          dataset_id: string | null
          details: Json
          error: string | null
          finished_at: string | null
          id: string
          organization_id: string
          profiles_found: number
          rows_failed: number
          rows_scored: number
          rows_synced: number
          started_at: string
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activation_id: string
          coverage_pct?: number | null
          created_at?: string
          dataset_id?: string | null
          details?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          profiles_found?: number
          rows_failed?: number
          rows_scored?: number
          rows_synced?: number
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          activation_id?: string
          coverage_pct?: number | null
          created_at?: string
          dataset_id?: string | null
          details?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          profiles_found?: number
          rows_failed?: number
          rows_scored?: number
          rows_synced?: number
          started_at?: string
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_intuizi_sync_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_tracking_settings: {
        Row: {
          created_at: string
          google_ads_conversion_id: string | null
          google_ads_conversion_label: string | null
          google_tag_id: string | null
          id: string
          meta_pixel_id: string | null
          notes: string | null
          organization_id: string
          tiktok_pixel_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          google_ads_conversion_id?: string | null
          google_ads_conversion_label?: string | null
          google_tag_id?: string | null
          id?: string
          meta_pixel_id?: string | null
          notes?: string | null
          organization_id: string
          tiktok_pixel_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          google_ads_conversion_id?: string | null
          google_ads_conversion_label?: string | null
          google_tag_id?: string | null
          id?: string
          meta_pixel_id?: string | null
          notes?: string | null
          organization_id?: string
          tiktok_pixel_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_tracking_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          plan: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          plan?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          plan?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      originality_ledger: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          work_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          work_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "originality_ledger_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "creator_works"
            referencedColumns: ["id"]
          },
        ]
      }
      pack_inclusions: {
        Row: {
          analyses_influenced: number
          included_at: string
          pack_version: string
          weight: number
          work_id: string
        }
        Insert: {
          analyses_influenced?: number
          included_at?: string
          pack_version: string
          weight?: number
          work_id: string
        }
        Update: {
          analyses_influenced?: number
          included_at?: string
          pack_version?: string
          weight?: number
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pack_inclusions_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "creator_works"
            referencedColumns: ["id"]
          },
        ]
      }
      pixel_events: {
        Row: {
          consent: Json
          created_at: string
          event_name: string
          external_user_id: string | null
          gclid: string | null
          id: string
          kpi_metric: string | null
          kpi_value: number | null
          occurred_at: string
          organization_id: string
          page_url: string | null
          props: Json
          referrer: string | null
          tag_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          consent?: Json
          created_at?: string
          event_name: string
          external_user_id?: string | null
          gclid?: string | null
          id?: string
          kpi_metric?: string | null
          kpi_value?: number | null
          occurred_at?: string
          organization_id: string
          page_url?: string | null
          props?: Json
          referrer?: string | null
          tag_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          consent?: Json
          created_at?: string
          event_name?: string
          external_user_id?: string | null
          gclid?: string | null
          id?: string
          kpi_metric?: string | null
          kpi_value?: number | null
          occurred_at?: string
          organization_id?: string
          page_url?: string | null
          props?: Json
          referrer?: string | null
          tag_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pixel_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pixel_tags: {
        Row: {
          active: boolean
          allowed_origins: string[]
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          tag_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_origins?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id: string
          tag_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_origins?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          tag_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pixel_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      playbooks: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          kind: string
          last_run_at: string | null
          last_run_summary: Json
          name: string
          organization_id: string
          run_count: number
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string
          last_run_at?: string | null
          last_run_summary?: Json
          name: string
          organization_id: string
          run_count?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string
          last_run_at?: string | null
          last_run_summary?: Json
          name?: string
          organization_id?: string
          run_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playbooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_runs: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          kind: string
          kpi: string | null
          organization_id: string
          params: Json
          result: Json | null
          status: string
          updated_at: string
          weights: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind: string
          kpi?: string | null
          organization_id: string
          params?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          weights?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind?: string
          kpi?: string | null
          organization_id?: string
          params?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "prediction_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          persona: string | null
          ui_prefs: Json
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          persona?: string | null
          ui_prefs?: Json
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          persona?: string | null
          ui_prefs?: Json
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      resolution_queue: {
        Row: {
          attempts: number
          context: Json
          created_at: string
          first_seen_at: string
          id: string
          last_error: string | null
          last_seen_at: string
          resolved_node_id: string | null
          sightings: number
          status: string
          symbol: string
          symbol_type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          context?: Json
          created_at?: string
          first_seen_at?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string
          resolved_node_id?: string | null
          sightings?: number
          status?: string
          symbol: string
          symbol_type?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          context?: Json
          created_at?: string
          first_seen_at?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string
          resolved_node_id?: string | null
          sightings?: number
          status?: string
          symbol?: string
          symbol_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resolution_queue_resolved_node_id_fkey"
            columns: ["resolved_node_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      resolver_steps: {
        Row: {
          created_at: string
          detail: Json
          duration_ms: number | null
          id: string
          queue_id: string | null
          run_id: string
          status: string
          step: string
          symbol: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          queue_id?: string | null
          run_id: string
          status?: string
          step: string
          symbol: string
        }
        Update: {
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          id?: string
          queue_id?: string | null
          run_id?: string
          status?: string
          step?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "resolver_steps_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "resolution_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_runs: {
        Row: {
          analyses_deleted: number
          cohort_members_deleted: number
          created_at: string
          cutoff: string
          details: Json
          embeddings_deleted: number
          error: string | null
          finished_at: string | null
          id: string
          identifiers_deleted: number
          kind: string
          queue_rows_deleted: number
          retention_days: number
          sources_deleted: number
          started_at: string
          status: string
          subjects_matched: number
          tags_deleted: number
          updated_at: string
        }
        Insert: {
          analyses_deleted?: number
          cohort_members_deleted?: number
          created_at?: string
          cutoff: string
          details?: Json
          embeddings_deleted?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          identifiers_deleted?: number
          kind?: string
          queue_rows_deleted?: number
          retention_days?: number
          sources_deleted?: number
          started_at?: string
          status?: string
          subjects_matched?: number
          tags_deleted?: number
          updated_at?: string
        }
        Update: {
          analyses_deleted?: number
          cohort_members_deleted?: number
          created_at?: string
          cutoff?: string
          details?: Json
          embeddings_deleted?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          identifiers_deleted?: number
          kind?: string
          queue_rows_deleted?: number
          retention_days?: number
          sources_deleted?: number
          started_at?: string
          status?: string
          subjects_matched?: number
          tags_deleted?: number
          updated_at?: string
        }
        Relationships: []
      }
      semantic_call_log: {
        Row: {
          action: string
          cache_hit: boolean
          created_at: string
          dims: number | null
          duration_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          outcome: string
          service: string
          subject_ref: string | null
        }
        Insert: {
          action: string
          cache_hit?: boolean
          created_at?: string
          dims?: number | null
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          outcome: string
          service?: string
          subject_ref?: string | null
        }
        Update: {
          action?: string
          cache_hit?: boolean
          created_at?: string
          dims?: number | null
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          outcome?: string
          service?: string
          subject_ref?: string | null
        }
        Relationships: []
      }
      semantic_normalization: {
        Row: {
          created_at: string
          enabled: boolean
          gains: Json
          id: string
          notes: string | null
          redistribute: boolean
          scope: string
          speech_bias: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          gains?: Json
          id?: string
          notes?: string | null
          redistribute?: boolean
          scope: string
          speech_bias?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          gains?: Json
          id?: string
          notes?: string | null
          redistribute?: boolean
          scope?: string
          speech_bias?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      share_cards: {
        Row: {
          archetype_slug: string | null
          created_at: string
          grounding_level: string
          id: string
          narration: string | null
          source_analysis_id: string | null
          source_name: string
          tags: Json
          token: string
          updated_at: string
          user_id: string | null
          vector: Json
          view_count: number
        }
        Insert: {
          archetype_slug?: string | null
          created_at?: string
          grounding_level?: string
          id?: string
          narration?: string | null
          source_analysis_id?: string | null
          source_name: string
          tags?: Json
          token: string
          updated_at?: string
          user_id?: string | null
          vector: Json
          view_count?: number
        }
        Update: {
          archetype_slug?: string | null
          created_at?: string
          grounding_level?: string
          id?: string
          narration?: string | null
          source_analysis_id?: string | null
          source_name?: string
          tags?: Json
          token?: string
          updated_at?: string
          user_id?: string | null
          vector?: Json
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "share_cards_archetype_slug_fkey"
            columns: ["archetype_slug"]
            isOneToOne: false
            referencedRelation: "sonic_archetypes"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "share_cards_source_analysis_id_fkey"
            columns: ["source_analysis_id"]
            isOneToOne: false
            referencedRelation: "source_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      sonic_archetypes: {
        Row: {
          anchors: string[]
          centroid: Json
          created_at: string
          dominant_axes: string[]
          meaning: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          anchors?: string[]
          centroid: Json
          created_at?: string
          dominant_axes: string[]
          meaning: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          anchors?: string[]
          centroid?: Json
          created_at?: string
          dominant_axes?: string[]
          meaning?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      sonic_cohort_exports: {
        Row: {
          activation_id: string | null
          bytes: number
          cohort_id: string | null
          cohort_slug: string
          created_at: string
          dt: string
          error: string | null
          id: string
          object_key: string | null
          organization_id: string | null
          row_count: number
          started_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activation_id?: string | null
          bytes?: number
          cohort_id?: string | null
          cohort_slug: string
          created_at?: string
          dt?: string
          error?: string | null
          id?: string
          object_key?: string | null
          organization_id?: string | null
          row_count?: number
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          activation_id?: string | null
          bytes?: number
          cohort_id?: string | null
          cohort_slug?: string
          created_at?: string
          dt?: string
          error?: string | null
          id?: string
          object_key?: string | null
          organization_id?: string | null
          row_count?: number
          started_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sonic_cohort_exports_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "sonic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sonic_cohort_exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sonic_cohort_members: {
        Row: {
          added_at: string
          cohort_id: string
          holdout: boolean
          similarity: number | null
          subject_key: string
        }
        Insert: {
          added_at?: string
          cohort_id: string
          holdout?: boolean
          similarity?: number | null
          subject_key: string
        }
        Update: {
          added_at?: string
          cohort_id?: string
          holdout?: boolean
          similarity?: number | null
          subject_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sonic_cohort_members_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "sonic_cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
      sonic_cohorts: {
        Row: {
          centroid: string | null
          created_at: string
          description: string | null
          export_eligible: boolean | null
          id: string
          member_count: number
          name: string
          narrative: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          centroid?: string | null
          created_at?: string
          description?: string | null
          export_eligible?: boolean | null
          id?: string
          member_count?: number
          name: string
          narrative?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          centroid?: string | null
          created_at?: string
          description?: string | null
          export_eligible?: boolean | null
          id?: string
          member_count?: number
          name?: string
          narrative?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      sonic_signatures: {
        Row: {
          archetype_slug: string | null
          audio_bytes: number | null
          audio_path: string | null
          created_at: string
          distance: number | null
          params: Json
          subject_hash: string
          subject_ref: string | null
          tags: string[]
          updated_at: string
          vector: Json
        }
        Insert: {
          archetype_slug?: string | null
          audio_bytes?: number | null
          audio_path?: string | null
          created_at?: string
          distance?: number | null
          params?: Json
          subject_hash: string
          subject_ref?: string | null
          tags?: string[]
          updated_at?: string
          vector: Json
        }
        Update: {
          archetype_slug?: string | null
          audio_bytes?: number | null
          audio_path?: string | null
          created_at?: string
          distance?: number | null
          params?: Json
          subject_hash?: string
          subject_ref?: string | null
          tags?: string[]
          updated_at?: string
          vector?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sonic_signatures_archetype_slug_fkey"
            columns: ["archetype_slug"]
            isOneToOne: false
            referencedRelation: "sonic_archetypes"
            referencedColumns: ["slug"]
          },
        ]
      }
      source_analyses: {
        Row: {
          artistic_desc: string | null
          artistic_score: number
          audio_source_id: string | null
          category: string | null
          cognitive_desc: string | null
          cognitive_score: number
          communication_desc: string | null
          communication_score: number
          confidence: number
          context_neighbors: Json | null
          contextual_desc: string | null
          contextual_score: number
          created_at: string
          emotional_desc: string | null
          emotional_score: number
          grounding_level: string
          id: string
          musical_scores: Json | null
          normalization: Json | null
          organization_id: string | null
          raw_scores: Json | null
          social_desc: string | null
          social_score: number
          source_name: string
          user_id: string
        }
        Insert: {
          artistic_desc?: string | null
          artistic_score: number
          audio_source_id?: string | null
          category?: string | null
          cognitive_desc?: string | null
          cognitive_score: number
          communication_desc?: string | null
          communication_score: number
          confidence?: number
          context_neighbors?: Json | null
          contextual_desc?: string | null
          contextual_score: number
          created_at?: string
          emotional_desc?: string | null
          emotional_score: number
          grounding_level?: string
          id?: string
          musical_scores?: Json | null
          normalization?: Json | null
          organization_id?: string | null
          raw_scores?: Json | null
          social_desc?: string | null
          social_score: number
          source_name: string
          user_id: string
        }
        Update: {
          artistic_desc?: string | null
          artistic_score?: number
          audio_source_id?: string | null
          category?: string | null
          cognitive_desc?: string | null
          cognitive_score?: number
          communication_desc?: string | null
          communication_score?: number
          confidence?: number
          context_neighbors?: Json | null
          contextual_desc?: string | null
          contextual_score?: number
          created_at?: string
          emotional_desc?: string | null
          emotional_score?: number
          grounding_level?: string
          id?: string
          musical_scores?: Json | null
          normalization?: Json | null
          organization_id?: string | null
          raw_scores?: Json | null
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
          {
            foreignKeyName: "source_analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          feature_hash: string | null
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
          feature_hash?: string | null
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
          feature_hash?: string | null
          id?: string
          social_desc?: string | null
          social_score?: number
          source_key?: string
          source_name?: string
          source_type?: string
        }
        Relationships: []
      }
      symbol_score_flags: {
        Row: {
          created_at: string
          flagged_by: string | null
          id: string
          node_id: string | null
          note: string | null
          observed_confidence: number | null
          queue_id: string | null
          reason: string
          status: string
          symbol: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          flagged_by?: string | null
          id?: string
          node_id?: string | null
          note?: string | null
          observed_confidence?: number | null
          queue_id?: string | null
          reason: string
          status?: string
          symbol: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          flagged_by?: string | null
          id?: string
          node_id?: string | null
          note?: string | null
          observed_confidence?: number | null
          queue_id?: string | null
          reason?: string
          status?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "symbol_score_flags_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "symbol_score_flags_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "resolution_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      taxonomy_nodes: {
        Row: {
          audio_embedding: string | null
          code: string
          created_at: string
          crosswalk: Json
          embedding: string | null
          grounding_count: number
          id: string
          label: string
          parent_code: string | null
          proposal: Json | null
          reviewed: boolean
          source: string
          suppressed: boolean
          taxonomy_version: string
          updated_at: string
        }
        Insert: {
          audio_embedding?: string | null
          code: string
          created_at?: string
          crosswalk?: Json
          embedding?: string | null
          grounding_count?: number
          id?: string
          label: string
          parent_code?: string | null
          proposal?: Json | null
          reviewed?: boolean
          source?: string
          suppressed?: boolean
          taxonomy_version?: string
          updated_at?: string
        }
        Update: {
          audio_embedding?: string | null
          code?: string
          created_at?: string
          crosswalk?: Json
          embedding?: string | null
          grounding_count?: number
          id?: string
          label?: string
          parent_code?: string | null
          proposal?: Json | null
          reviewed?: boolean
          source?: string
          suppressed?: boolean
          taxonomy_version?: string
          updated_at?: string
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
      worker_heartbeats: {
        Row: {
          created_at: string
          host: string | null
          last_seen: string
          stats: Json
          updated_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          host?: string | null
          last_seen?: string
          stats?: Json
          updated_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          host?: string | null
          last_seen?: string
          stats?: Json
          updated_at?: string
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_intuizi_lease: {
        Args: { p_owner: string; p_seconds?: number }
        Returns: boolean
      }
      acquire_job_worker_lease: {
        Args: { p_owner: string; p_seconds?: number }
        Returns: boolean
      }
      acquire_named_lease: {
        Args: { p_id: string; p_owner: string; p_seconds?: number }
        Returns: boolean
      }
      admin_prune_analysis_telemetry: {
        Args: {
          p_cache_idle_days?: number
          p_job_days?: number
          p_log_days?: number
        }
        Returns: Json
      }
      admin_recalculate_all_fingerprints: { Args: never; Returns: number }
      admin_recalculate_user_fingerprint: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      block_ingest_file: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      claim_analysis_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          audio_source_id: string | null
          cache_key: string
          created_at: string
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          params: Json
          priority: number
          started_at: string | null
          status: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_intuizi_score_jobs: {
        Args: { p_limit?: number }
        Returns: {
          activation_id: string | null
          attempts: number
          confidence: number
          created_at: string
          dead_lettered_at: string | null
          failure_kind: string | null
          finished_at: string | null
          id: string
          identifier: string
          label: string | null
          last_error: string | null
          last_stage: string | null
          max_attempts: number
          next_attempt_at: string
          object_key: string
          owner_id: string | null
          report_type: string
          signals: Json
          started_at: string | null
          status: string
          step_scale: number
          tags: Json
          trace_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "intuizi_score_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_ingest_file: {
        Args: { p_worker: string }
        Returns: {
          id: string
          object_key: string
          report_type: string
          trace_id: string
        }[]
      }
      client_control: { Args: { _key: string }; Returns: Json }
      complete_ingest_file: {
        Args: { p_id: string; p_rows: number; p_status?: string }
        Returns: undefined
      }
      creator_queued_symbols: {
        Args: never
        Returns: {
          attempts: number
          first_seen_at: string
          id: string
          last_seen_at: string
          sightings: number
          status: string
          symbol: string
          symbol_type: string
        }[]
      }
      enqueue_score_tasks: { Args: { p_rows: Json }; Returns: number }
      fail_ingest_file: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      grounding_coverage: {
        Args: never
        Returns: {
          branch: string
          coverage_pct: number
          grounded_tags: number
          grounded_weight: number
          observed_tags: number
          observed_weight: number
        }[]
      }
      grounding_gaps: {
        Args: { p_branch?: string; p_limit?: number }
        Returns: {
          branch: string
          code: string
          label: string
          node_id: string
          observed_sources: number
          observed_weight: number
          queued: boolean
        }[]
      }
      has_org_access: { Args: { _org: string }; Returns: boolean }
      has_org_write: { Args: { _org: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      intuizi_score_queue_depth: {
        Args: { p_cap?: number }
        Returns: {
          capped_at: number
          dead_letter_capped: number
          pending_capped: number
        }[]
      }
      is_org_owner: { Args: { _org: string }; Returns: boolean }
      lease_ingest_file: {
        Args: { p_stale_after?: string; p_worker_id: string }
        Returns: {
          file_id: string
          object_key: string
          report_type: string
          row_group_cursor: number
          rows_offset: number
          total_rows: number
          trace_id: string
        }[]
      }
      log_intuizi_custody_scan: { Args: never; Returns: Json }
      match_audio_profiles: {
        Args: {
          exclude_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          artistic_score: number
          cognitive_score: number
          communication_score: number
          contextual_score: number
          emotional_score: number
          id: string
          name: string
          similarity: number
          social_score: number
        }[]
      }
      match_audioset_nodes: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          code: string
          id: string
          label: string
          similarity: number
        }[]
      }
      match_taxonomy_nodes: {
        Args: {
          code_prefix?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          code: string
          id: string
          label: string
          similarity: number
        }[]
      }
      normalize_intuizi_subject_keys: {
        Args: { p_retention_days?: number }
        Returns: Json
      }
      normalize_score_to_percentile: {
        Args: { pop_mean: number; pop_stddev: number; raw_score: number }
        Returns: number
      }
      org_cohort_aggregates: {
        Args: { _org: string }
        Returns: {
          cohort_id: string
          description: string
          export_eligible: boolean
          last_exported_at: string
          member_count: number
          name: string
          narrative: string
          slug: string
        }[]
      }
      org_retention_summary: {
        Args: { _org: string }
        Returns: {
          last_run_at: string
          last_status: string
          org_sources_recent: number
          org_sources_total: number
          retention_days: number
        }[]
      }
      prune_analysis_telemetry: {
        Args: {
          p_cache_idle_days?: number
          p_job_days?: number
          p_log_days?: number
        }
        Returns: Json
      }
      read_ingest_rollup_subject_batch: {
        Args: {
          p_after_subject?: string
          p_limit?: number
          p_object_key: string
        }
        Returns: {
          subject_key: string
          tags: Json
        }[]
      }
      reap_stale_ingest_claims: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      recalculate_all_fingerprints: { Args: never; Returns: number }
      recalculate_user_fingerprint: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      refresh_taxonomy_grounding: {
        Args: never
        Returns: {
          grounded_nodes: number
          nodes_updated: number
        }[]
      }
      refresh_taxonomy_suppression: { Args: never; Returns: Json }
      release_intuizi_lease: { Args: { p_owner: string }; Returns: undefined }
      release_job_worker_lease: {
        Args: { p_owner: string }
        Returns: undefined
      }
      release_named_lease: {
        Args: { p_id: string; p_owner: string }
        Returns: undefined
      }
      requeue_ingest_file: {
        Args: { p_id: string; p_max_attempts?: number; p_reason?: string }
        Returns: string
      }
      requeue_intuizi_score_failures: {
        Args: {
          p_activation_id?: string
          p_extra_attempts?: number
          p_include_dead_letter?: boolean
          p_object_key?: string
        }
        Returns: {
          remaining_dead_letter: number
          requeued: number
        }[]
      }
      require_admin: { Args: never; Returns: undefined }
      retire_exhausted_intuizi_score_jobs: {
        Args: { p_limit?: number }
        Returns: number
      }
      run_intuizi_retention: { Args: { p_days?: number }; Returns: Json }
      scan_intuizi_custody: { Args: never; Returns: Json }
      skip_ingest_file: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      stage_ingest_rollups: {
        Args: {
          p_object_key: string
          p_part_key?: string
          p_report_type: string
          p_rows: Json
          p_source_offset: number
        }
        Returns: number
      }
      touch_audio_profile_embedding: {
        Args: { p_cache_key: string; p_model: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      org_role: "owner" | "analyst" | "viewer"
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
      org_role: ["owner", "analyst", "viewer"],
    },
  },
} as const
