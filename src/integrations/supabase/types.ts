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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounting_event: {
        Row: {
          amount: number
          created_at: string
          credit_account_purpose: string | null
          currency: string
          debit_account_purpose: string | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          idempotency_key: string
          metadata: Json
          occurred_at: string
          sales_order_id: string | null
          sales_order_line_id: string | null
          source: string
          status: string
          stock_unit_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          credit_account_purpose?: string | null
          currency?: string
          debit_account_purpose?: string | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          idempotency_key: string
          metadata?: Json
          occurred_at?: string
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          source?: string
          status?: string
          stock_unit_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          credit_account_purpose?: string | null
          currency?: string
          debit_account_purpose?: string | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          occurred_at?: string
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          source?: string
          status?: string
          stock_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "accounting_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "accounting_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "accounting_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "accounting_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
        ]
      }
      actual_settlement_line: {
        Row: {
          amount: number
          category: string
          created_at: string
          currency: string
          external_reference: string | null
          id: string
          idempotency_key: string
          metadata: Json
          occurred_at: string | null
          payout_fee_id: string | null
          payout_id: string | null
          qbo_posting_reference_id: string | null
          sales_order_id: string | null
          source_system: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          occurred_at?: string | null
          payout_fee_id?: string | null
          payout_id?: string | null
          qbo_posting_reference_id?: string | null
          sales_order_id?: string | null
          source_system: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          occurred_at?: string | null
          payout_fee_id?: string | null
          payout_id?: string | null
          qbo_posting_reference_id?: string | null
          sales_order_id?: string | null
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "actual_settlement_line_payout_fee_id_fkey"
            columns: ["payout_fee_id"]
            isOneToOne: false
            referencedRelation: "payout_fee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actual_settlement_line_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actual_settlement_line_qbo_posting_reference_id_fkey"
            columns: ["qbo_posting_reference_id"]
            isOneToOne: false
            referencedRelation: "qbo_posting_reference"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "actual_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          ai_provider: string
          id: string
          stripe_test_mode: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_provider?: string
          id?: string
          stripe_test_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_provider?: string
          id?: string
          stripe_test_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_event: {
        Row: {
          actor_id: string | null
          actor_type: string
          after_json: Json | null
          before_json: Json | null
          causation_id: string | null
          checksum: string | null
          correlation_id: string | null
          diff_json: Json | null
          entity_id: string
          entity_type: string
          id: string
          input_json: Json | null
          job_run_id: string | null
          occurred_at: string
          output_json: Json | null
          parser_version: string | null
          source_system: string | null
          trigger_type: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          after_json?: Json | null
          before_json?: Json | null
          causation_id?: string | null
          checksum?: string | null
          correlation_id?: string | null
          diff_json?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          input_json?: Json | null
          job_run_id?: string | null
          occurred_at?: string
          output_json?: Json | null
          parser_version?: string | null
          source_system?: string | null
          trigger_type: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          after_json?: Json | null
          before_json?: Json | null
          causation_id?: string | null
          checksum?: string | null
          correlation_id?: string | null
          diff_json?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          input_json?: Json | null
          job_run_id?: string | null
          occurred_at?: string
          output_json?: Json | null
          parser_version?: string | null
          source_system?: string | null
          trigger_type?: string
        }
        Relationships: []
      }
      brickeconomy_catalog_item: {
        Row: {
          age_mark: string | null
          created_at: string
          fetched_at: string
          height_cm: number | null
          id: string
          image_url: string | null
          length_cm: number | null
          minifig_count: number | null
          mpn: string
          name: string | null
          piece_count: number | null
          raw_attributes: Json
          release_year: number | null
          subtheme: string | null
          theme: string | null
          updated_at: string
          weight_g: number | null
          width_cm: number | null
        }
        Insert: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Update: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn?: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Relationships: []
      }
      brickeconomy_channel_overrides: {
        Row: {
          channel: string
          id: string
          item_number: string
          item_type: string
          notes: string | null
          price_override: number
          updated_at: string
        }
        Insert: {
          channel: string
          id?: string
          item_number: string
          item_type: string
          notes?: string | null
          price_override: number
          updated_at?: string
        }
        Update: {
          channel?: string
          id?: string
          item_number?: string
          item_type?: string
          notes?: string | null
          price_override?: number
          updated_at?: string
        }
        Relationships: []
      }
      brickeconomy_collection: {
        Row: {
          acquired_date: string | null
          collection_name: string | null
          condition: string | null
          created_at: string
          currency: string
          current_value: number | null
          growth: number | null
          id: string
          item_number: string
          item_type: string
          minifigs_count: number | null
          name: string | null
          paid_price: number | null
          pieces_count: number | null
          released_date: string | null
          retail_price: number | null
          retired_date: string | null
          subtheme: string | null
          synced_at: string
          theme: string | null
          year: number | null
        }
        Insert: {
          acquired_date?: string | null
          collection_name?: string | null
          condition?: string | null
          created_at?: string
          currency?: string
          current_value?: number | null
          growth?: number | null
          id?: string
          item_number: string
          item_type: string
          minifigs_count?: number | null
          name?: string | null
          paid_price?: number | null
          pieces_count?: number | null
          released_date?: string | null
          retail_price?: number | null
          retired_date?: string | null
          subtheme?: string | null
          synced_at?: string
          theme?: string | null
          year?: number | null
        }
        Update: {
          acquired_date?: string | null
          collection_name?: string | null
          condition?: string | null
          created_at?: string
          currency?: string
          current_value?: number | null
          growth?: number | null
          id?: string
          item_number?: string
          item_type?: string
          minifigs_count?: number | null
          name?: string | null
          paid_price?: number | null
          pieces_count?: number | null
          released_date?: string | null
          retail_price?: number | null
          retired_date?: string | null
          subtheme?: string | null
          synced_at?: string
          theme?: string | null
          year?: number | null
        }
        Relationships: []
      }
      brickeconomy_portfolio_snapshot: {
        Row: {
          currency: string
          current_value: number | null
          id: string
          period_data: Json | null
          snapshot_type: string
          synced_at: string
          total_count: number | null
          unique_count: number | null
        }
        Insert: {
          currency?: string
          current_value?: number | null
          id?: string
          period_data?: Json | null
          snapshot_type: string
          synced_at?: string
          total_count?: number | null
          unique_count?: number | null
        }
        Update: {
          currency?: string
          current_value?: number | null
          id?: string
          period_data?: Json | null
          snapshot_type?: string
          synced_at?: string
          total_count?: number | null
          unique_count?: number | null
        }
        Relationships: []
      }
      brickeconomy_price_history: {
        Row: {
          currency: string
          current_value: number | null
          growth: number | null
          id: string
          item_number: string
          item_type: string
          recorded_at: string
          retail_price: number | null
          source: string
        }
        Insert: {
          currency?: string
          current_value?: number | null
          growth?: number | null
          id?: string
          item_number: string
          item_type: string
          recorded_at?: string
          retail_price?: number | null
          source?: string
        }
        Update: {
          currency?: string
          current_value?: number | null
          growth?: number | null
          id?: string
          item_number?: string
          item_type?: string
          recorded_at?: string
          retail_price?: number | null
          source?: string
        }
        Relationships: []
      }
      bricklink_catalog_item: {
        Row: {
          age_mark: string | null
          created_at: string
          fetched_at: string
          height_cm: number | null
          id: string
          image_url: string | null
          length_cm: number | null
          minifig_count: number | null
          mpn: string
          name: string | null
          piece_count: number | null
          raw_attributes: Json
          release_year: number | null
          subtheme: string | null
          theme: string | null
          updated_at: string
          weight_g: number | null
          width_cm: number | null
        }
        Insert: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Update: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn?: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Relationships: []
      }
      bricklink_set_minifig: {
        Row: {
          bl_mpn: string
          created_at: string
          fetched_at: string
          id: string
          image_url: string | null
          name: string | null
          quantity: number
          set_no: string
          updated_at: string
        }
        Insert: {
          bl_mpn: string
          created_at?: string
          fetched_at?: string
          id?: string
          image_url?: string | null
          name?: string | null
          quantity?: number
          set_no: string
          updated_at?: string
        }
        Update: {
          bl_mpn?: string
          created_at?: string
          fetched_at?: string
          id?: string
          image_url?: string | null
          name?: string | null
          quantity?: number
          set_no?: string
          updated_at?: string
        }
        Relationships: []
      }
      brickowl_catalog_item: {
        Row: {
          age_mark: string | null
          created_at: string
          fetched_at: string
          height_cm: number | null
          id: string
          image_url: string | null
          length_cm: number | null
          minifig_count: number | null
          mpn: string
          name: string | null
          piece_count: number | null
          raw_attributes: Json
          release_year: number | null
          subtheme: string | null
          theme: string | null
          updated_at: string
          weight_g: number | null
          width_cm: number | null
        }
        Insert: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Update: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn?: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Relationships: []
      }
      brickowl_mpn_alias: {
        Row: {
          boid: string
          confidence: string
          created_at: string
          id: string
          last_verified_at: string | null
          mpn: string
          notes: string | null
          source: string
          updated_at: string
        }
        Insert: {
          boid: string
          confidence?: string
          created_at?: string
          id?: string
          last_verified_at?: string | null
          mpn: string
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          boid?: string
          confidence?: string
          created_at?: string
          id?: string
          last_verified_at?: string | null
          mpn?: string
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      brickset_catalog_item: {
        Row: {
          age_mark: string | null
          created_at: string
          fetched_at: string
          height_cm: number | null
          id: string
          image_url: string | null
          length_cm: number | null
          minifig_count: number | null
          mpn: string
          name: string | null
          piece_count: number | null
          raw_attributes: Json
          release_year: number | null
          subtheme: string | null
          theme: string | null
          updated_at: string
          weight_g: number | null
          width_cm: number | null
        }
        Insert: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Update: {
          age_mark?: string | null
          created_at?: string
          fetched_at?: string
          height_cm?: number | null
          id?: string
          image_url?: string | null
          length_cm?: number | null
          minifig_count?: number | null
          mpn?: string
          name?: string | null
          piece_count?: number | null
          raw_attributes?: Json
          release_year?: number | null
          subtheme?: string | null
          theme?: string | null
          updated_at?: string
          weight_g?: number | null
          width_cm?: number | null
        }
        Relationships: []
      }
      canonical_attribute: {
        Row: {
          active: boolean
          applies_to_ebay_categories: string[] | null
          applies_to_product_types: string[] | null
          attribute_group: string
          created_at: string
          data_type: string
          db_column: string | null
          editable: boolean
          editor: string
          id: string
          key: string
          label: string
          provider_chain: Json
          sort_order: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to_ebay_categories?: string[] | null
          applies_to_product_types?: string[] | null
          attribute_group?: string
          created_at?: string
          data_type?: string
          db_column?: string | null
          editable?: boolean
          editor?: string
          id?: string
          key: string
          label: string
          provider_chain?: Json
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to_ebay_categories?: string[] | null
          applies_to_product_types?: string[] | null
          attribute_group?: string
          created_at?: string
          data_type?: string
          db_column?: string | null
          editable?: boolean
          editor?: string
          id?: string
          key?: string
          label?: string
          provider_chain?: Json
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      channel_attribute_mapping: {
        Row: {
          aspect_key: string
          canonical_key: string | null
          category_id: string | null
          channel: string
          constant_value: string | null
          created_at: string
          id: string
          marketplace: string | null
          notes: string | null
          transform: string | null
          updated_at: string
        }
        Insert: {
          aspect_key: string
          canonical_key?: string | null
          category_id?: string | null
          channel: string
          constant_value?: string | null
          created_at?: string
          id?: string
          marketplace?: string | null
          notes?: string | null
          transform?: string | null
          updated_at?: string
        }
        Update: {
          aspect_key?: string
          canonical_key?: string | null
          category_id?: string | null
          channel?: string
          constant_value?: string | null
          created_at?: string
          id?: string
          marketplace?: string | null
          notes?: string | null
          transform?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_attribute_mapping_canonical_key_fkey"
            columns: ["canonical_key"]
            isOneToOne: false
            referencedRelation: "canonical_attribute"
            referencedColumns: ["key"]
          },
        ]
      }
      channel_category_attribute: {
        Row: {
          allowed_values: Json | null
          allows_custom: boolean
          cardinality: string
          created_at: string
          data_type: string
          help_text: string | null
          id: string
          key: string
          label: string | null
          required: boolean
          schema_id: string
          sort_order: number
        }
        Insert: {
          allowed_values?: Json | null
          allows_custom?: boolean
          cardinality?: string
          created_at?: string
          data_type?: string
          help_text?: string | null
          id?: string
          key: string
          label?: string | null
          required?: boolean
          schema_id: string
          sort_order?: number
        }
        Update: {
          allowed_values?: Json | null
          allows_custom?: boolean
          cardinality?: string
          created_at?: string
          data_type?: string
          help_text?: string | null
          id?: string
          key?: string
          label?: string | null
          required?: boolean
          schema_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_category_attribute_schema_id_fkey"
            columns: ["schema_id"]
            isOneToOne: false
            referencedRelation: "channel_category_schema"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_category_schema: {
        Row: {
          category_id: string
          category_name: string
          channel: string
          condition_policy: Json | null
          condition_policy_fetched_at: string | null
          created_at: string
          id: string
          leaf: boolean
          marketplace: string
          parent_id: string | null
          raw_payload: Json | null
          schema_fetched_at: string | null
          updated_at: string
        }
        Insert: {
          category_id: string
          category_name: string
          channel: string
          condition_policy?: Json | null
          condition_policy_fetched_at?: string | null
          created_at?: string
          id?: string
          leaf?: boolean
          marketplace?: string
          parent_id?: string | null
          raw_payload?: Json | null
          schema_fetched_at?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string
          category_name?: string
          channel?: string
          condition_policy?: Json | null
          condition_policy_fetched_at?: string | null
          created_at?: string
          id?: string
          leaf?: boolean
          marketplace?: string
          parent_id?: string | null
          raw_payload?: Json | null
          schema_fetched_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      channel_fee_schedule: {
        Row: {
          active: boolean
          applies_to: string
          channel: string
          created_at: string
          fee_name: string
          fixed_amount: number
          id: string
          max_amount: number | null
          min_amount: number | null
          notes: string | null
          rate_percent: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to?: string
          channel: string
          created_at?: string
          fee_name: string
          fixed_amount?: number
          id?: string
          max_amount?: number | null
          min_amount?: number | null
          notes?: string | null
          rate_percent?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to?: string
          channel?: string
          created_at?: string
          fee_name?: string
          fixed_amount?: number
          id?: string
          max_amount?: number | null
          min_amount?: number | null
          notes?: string | null
          rate_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      channel_listing: {
        Row: {
          channel: string
          confidence_score: number | null
          created_at: string
          current_price_decision_snapshot_id: string | null
          estimated_fees: number | null
          estimated_net: number | null
          external_listing_id: string | null
          external_sku: string
          external_url: string | null
          fee_adjusted_price: number | null
          id: string
          listed_at: string | null
          listed_price: number | null
          listed_quantity: number | null
          listing_description: string | null
          listing_title: string | null
          offer_status: string | null
          price_ceiling: number | null
          price_floor: number | null
          price_target: number | null
          priced_at: string | null
          pricing_notes: string | null
          raw_data: Json | null
          sku_id: string | null
          synced_at: string
          updated_at: string
          v2_channel: Database["public"]["Enums"]["v2_channel"] | null
          v2_status:
            | Database["public"]["Enums"]["v2_channel_listing_status"]
            | null
        }
        Insert: {
          channel?: string
          confidence_score?: number | null
          created_at?: string
          current_price_decision_snapshot_id?: string | null
          estimated_fees?: number | null
          estimated_net?: number | null
          external_listing_id?: string | null
          external_sku: string
          external_url?: string | null
          fee_adjusted_price?: number | null
          id?: string
          listed_at?: string | null
          listed_price?: number | null
          listed_quantity?: number | null
          listing_description?: string | null
          listing_title?: string | null
          offer_status?: string | null
          price_ceiling?: number | null
          price_floor?: number | null
          price_target?: number | null
          priced_at?: string | null
          pricing_notes?: string | null
          raw_data?: Json | null
          sku_id?: string | null
          synced_at?: string
          updated_at?: string
          v2_channel?: Database["public"]["Enums"]["v2_channel"] | null
          v2_status?:
            | Database["public"]["Enums"]["v2_channel_listing_status"]
            | null
        }
        Update: {
          channel?: string
          confidence_score?: number | null
          created_at?: string
          current_price_decision_snapshot_id?: string | null
          estimated_fees?: number | null
          estimated_net?: number | null
          external_listing_id?: string | null
          external_sku?: string
          external_url?: string | null
          fee_adjusted_price?: number | null
          id?: string
          listed_at?: string | null
          listed_price?: number | null
          listed_quantity?: number | null
          listing_description?: string | null
          listing_title?: string | null
          offer_status?: string | null
          price_ceiling?: number | null
          price_floor?: number | null
          price_target?: number | null
          priced_at?: string | null
          pricing_notes?: string | null
          raw_data?: Json | null
          sku_id?: string | null
          synced_at?: string
          updated_at?: string
          v2_channel?: Database["public"]["Enums"]["v2_channel"] | null
          v2_status?:
            | Database["public"]["Enums"]["v2_channel_listing_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_listing_current_price_decision_snapshot_id_fkey"
            columns: ["current_price_decision_snapshot_id"]
            isOneToOne: false
            referencedRelation: "price_decision_snapshot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_listing_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_listing_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_listing_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      channel_price_policy: {
        Row: {
          active: boolean
          advertising_fee_rate: number
          channel: string
          created_at: string
          default_delivery_cost: number
          default_packaging_cost: number
          fixed_fee_amount: number
          id: string
          marketplace_fee_rate: number
          metadata: Json
          minimum_margin_rate: number | null
          minimum_profit_amount: number | null
          payment_fee_rate: number
          price_policy_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          advertising_fee_rate?: number
          channel: string
          created_at?: string
          default_delivery_cost?: number
          default_packaging_cost?: number
          fixed_fee_amount?: number
          id?: string
          marketplace_fee_rate?: number
          metadata?: Json
          minimum_margin_rate?: number | null
          minimum_profit_amount?: number | null
          payment_fee_rate?: number
          price_policy_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          advertising_fee_rate?: number
          channel?: string
          created_at?: string
          default_delivery_cost?: number
          default_packaging_cost?: number
          fixed_fee_amount?: number
          id?: string
          marketplace_fee_rate?: number
          metadata?: Json
          minimum_margin_rate?: number | null
          minimum_profit_amount?: number | null
          payment_fee_rate?: number
          price_policy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_price_policy_price_policy_id_fkey"
            columns: ["price_policy_id"]
            isOneToOne: false
            referencedRelation: "price_policy"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_pricing_config: {
        Row: {
          auto_price_enabled: boolean
          channel: string
          id: string
          max_decrease_amount: number | null
          max_decrease_pct: number | null
          max_increase_amount: number | null
          max_increase_pct: number | null
          updated_at: string
        }
        Insert: {
          auto_price_enabled?: boolean
          channel: string
          id?: string
          max_decrease_amount?: number | null
          max_decrease_pct?: number | null
          max_increase_amount?: number | null
          max_increase_pct?: number | null
          updated_at?: string
        }
        Update: {
          auto_price_enabled?: boolean
          channel?: string
          id?: string
          max_decrease_amount?: number | null
          max_decrease_pct?: number | null
          max_increase_amount?: number | null
          max_increase_pct?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      club: {
        Row: {
          active: boolean
          city: string | null
          commission_rate: number
          created_at: string
          discount_rate: number
          id: string
          location_description: string | null
          name: string
          postcode: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          commission_rate?: number
          created_at?: string
          discount_rate?: number
          id?: string
          location_description?: string | null
          name: string
          postcode?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          commission_rate?: number
          created_at?: string
          discount_rate?: number
          id?: string
          location_description?: string | null
          name?: string
          postcode?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      csv_sync_audit: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          id: string
          performed_at: string
          performed_by: string
          row_id: string
          session_id: string
          table_name: string
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          id?: string
          performed_at?: string
          performed_by: string
          row_id: string
          session_id: string
          table_name: string
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          id?: string
          performed_at?: string
          performed_by?: string
          row_id?: string
          session_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_sync_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "csv_sync_session"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_sync_changeset: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          changed_fields: string[] | null
          created_at: string
          errors: string[] | null
          id: string
          natural_key: Json | null
          row_id: string | null
          session_id: string
          warnings: string[] | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          changed_fields?: string[] | null
          created_at?: string
          errors?: string[] | null
          id?: string
          natural_key?: Json | null
          row_id?: string | null
          session_id: string
          warnings?: string[] | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          changed_fields?: string[] | null
          created_at?: string
          errors?: string[] | null
          id?: string
          natural_key?: Json | null
          row_id?: string | null
          session_id?: string
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "csv_sync_changeset_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "csv_sync_session"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_sync_session: {
        Row: {
          applied_at: string | null
          changeset_summary: Json | null
          created_at: string
          delete_count: number
          error_count: number
          error_message: string | null
          filename: string
          id: string
          insert_count: number
          performed_by: string
          rolled_back_at: string | null
          row_count: number
          status: string
          table_name: string
          update_count: number
          warning_count: number
        }
        Insert: {
          applied_at?: string | null
          changeset_summary?: Json | null
          created_at?: string
          delete_count?: number
          error_count?: number
          error_message?: string | null
          filename: string
          id?: string
          insert_count?: number
          performed_by: string
          rolled_back_at?: string | null
          row_count?: number
          status?: string
          table_name: string
          update_count?: number
          warning_count?: number
        }
        Update: {
          applied_at?: string | null
          changeset_summary?: Json | null
          created_at?: string
          delete_count?: number
          error_count?: number
          error_message?: string | null
          filename?: string
          id?: string
          insert_count?: number
          performed_by?: string
          rolled_back_at?: string | null
          row_count?: number
          status?: string
          table_name?: string
          update_count?: number
          warning_count?: number
        }
        Relationships: []
      }
      csv_sync_staging: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          raw_data: Json
          row_number: number
          session_id: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          raw_data: Json
          row_number: number
          session_id: string
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          raw_data?: Json
          row_number?: number
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_sync_staging_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "csv_sync_session"
            referencedColumns: ["id"]
          },
        ]
      }
      customer: {
        Row: {
          active: boolean
          billing_city: string | null
          billing_country: string | null
          billing_county: string | null
          billing_line_1: string | null
          billing_line_2: string | null
          billing_postcode: string | null
          blue_bell_member: boolean
          channel_ids: Json | null
          company_name: string | null
          created_at: string
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          mobile: string | null
          notes: string | null
          phone: string | null
          qbo_customer_id: string | null
          stripe_customer_id: string | null
          synced_at: string
          updated_at: string
          user_id: string | null
          web_addr: string | null
        }
        Insert: {
          active?: boolean
          billing_city?: string | null
          billing_country?: string | null
          billing_county?: string | null
          billing_line_1?: string | null
          billing_line_2?: string | null
          billing_postcode?: string | null
          blue_bell_member?: boolean
          channel_ids?: Json | null
          company_name?: string | null
          created_at?: string
          display_name: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          qbo_customer_id?: string | null
          stripe_customer_id?: string | null
          synced_at?: string
          updated_at?: string
          user_id?: string | null
          web_addr?: string | null
        }
        Update: {
          active?: boolean
          billing_city?: string | null
          billing_country?: string | null
          billing_county?: string | null
          billing_line_1?: string | null
          billing_line_2?: string | null
          billing_postcode?: string | null
          blue_bell_member?: boolean
          channel_ids?: Json | null
          company_name?: string | null
          created_at?: string
          display_name?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          qbo_customer_id?: string | null
          stripe_customer_id?: string | null
          synced_at?: string
          updated_at?: string
          user_id?: string | null
          web_addr?: string | null
        }
        Relationships: []
      }
      ebay_connection: {
        Row: {
          access_token: string
          created_at: string
          id: string
          refresh_token: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          refresh_token: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          refresh_token?: string
          token_expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ebay_notification: {
        Row: {
          created_at: string
          id: string
          notification_id: string | null
          payload: Json | null
          read: boolean
          received_at: string
          topic: string
        }
        Insert: {
          created_at?: string
          id?: string
          notification_id?: string | null
          payload?: Json | null
          read?: boolean
          received_at?: string
          topic: string
        }
        Update: {
          created_at?: string
          id?: string
          notification_id?: string | null
          payload?: Json | null
          read?: boolean
          received_at?: string
          topic?: string
        }
        Relationships: []
      }
      ebay_payout_transactions: {
        Row: {
          buyer_username: string | null
          created_at: string | null
          currency: string
          ebay_item_id: string | null
          fee_details: Json
          gross_amount: number
          id: string
          match_method: string | null
          matched: boolean
          matched_order_id: string | null
          memo: string | null
          net_amount: number
          order_id: string | null
          payout_id: string
          qbo_purchase_id: string | null
          qbo_sales_receipt_id: string | null
          total_fees: number
          transaction_date: string
          transaction_id: string
          transaction_status: string
          transaction_type: string
        }
        Insert: {
          buyer_username?: string | null
          created_at?: string | null
          currency?: string
          ebay_item_id?: string | null
          fee_details?: Json
          gross_amount: number
          id?: string
          match_method?: string | null
          matched?: boolean
          matched_order_id?: string | null
          memo?: string | null
          net_amount: number
          order_id?: string | null
          payout_id: string
          qbo_purchase_id?: string | null
          qbo_sales_receipt_id?: string | null
          total_fees?: number
          transaction_date: string
          transaction_id: string
          transaction_status: string
          transaction_type: string
        }
        Update: {
          buyer_username?: string | null
          created_at?: string | null
          currency?: string
          ebay_item_id?: string | null
          fee_details?: Json
          gross_amount?: number
          id?: string
          match_method?: string | null
          matched?: boolean
          matched_order_id?: string | null
          memo?: string | null
          net_amount?: number
          order_id?: string | null
          payout_id?: string
          qbo_purchase_id?: string | null
          qbo_sales_receipt_id?: string | null
          total_fees?: number
          transaction_date?: string
          transaction_id?: string
          transaction_status?: string
          transaction_type?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      expected_settlement_line: {
        Row: {
          amount: number
          category: string
          confidence: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          metadata: Json
          sales_order_id: string | null
          sales_order_line_id: string | null
          sales_program_accrual_id: string | null
          source: string
        }
        Insert: {
          amount: number
          category: string
          confidence?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key: string
          metadata?: Json
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          sales_program_accrual_id?: string | null
          source?: string
        }
        Update: {
          amount?: number
          category?: string
          confidence?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          sales_program_accrual_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_program_accrual_id_fkey"
            columns: ["sales_program_accrual_id"]
            isOneToOne: false
            referencedRelation: "sales_program_accrual"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_program_accrual_id_fkey"
            columns: ["sales_program_accrual_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["accrual_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_program_accrual_id_fkey"
            columns: ["sales_program_accrual_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["accrual_id"]
          },
          {
            foreignKeyName: "expected_settlement_line_sales_program_accrual_id_fkey"
            columns: ["sales_program_accrual_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["accrual_id"]
          },
        ]
      }
      google_merchant_connection: {
        Row: {
          access_token: string
          created_at: string
          data_source: string | null
          id: string
          merchant_id: string
          refresh_token: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          data_source?: string | null
          id?: string
          merchant_id: string
          refresh_token: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          data_source?: string | null
          id?: string
          merchant_id?: string
          refresh_token?: string
          token_expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      inbound_receipt: {
        Row: {
          created_at: string
          currency: string
          global_tax_calculation: string | null
          id: string
          processed_at: string | null
          qbo_purchase_id: string
          raw_payload: Json | null
          status: Database["public"]["Enums"]["receipt_status"]
          tax_total: number
          total_amount: number
          txn_date: string | null
          vendor_name: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          global_tax_calculation?: string | null
          id?: string
          processed_at?: string | null
          qbo_purchase_id: string
          raw_payload?: Json | null
          status?: Database["public"]["Enums"]["receipt_status"]
          tax_total?: number
          total_amount?: number
          txn_date?: string | null
          vendor_name?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          global_tax_calculation?: string | null
          id?: string
          processed_at?: string | null
          qbo_purchase_id?: string
          raw_payload?: Json | null
          status?: Database["public"]["Enums"]["receipt_status"]
          tax_total?: number
          total_amount?: number
          txn_date?: string | null
          vendor_name?: string | null
        }
        Relationships: []
      }
      inbound_receipt_line: {
        Row: {
          condition_grade: string | null
          created_at: string
          description: string | null
          id: string
          inbound_receipt_id: string
          is_stock_line: boolean
          line_total: number
          mpn: string | null
          qbo_item_id: string | null
          qbo_tax_code_ref: string | null
          quantity: number
          sku_code: string | null
          tax_code_id: string | null
          unit_cost: number
        }
        Insert: {
          condition_grade?: string | null
          created_at?: string
          description?: string | null
          id?: string
          inbound_receipt_id: string
          is_stock_line?: boolean
          line_total?: number
          mpn?: string | null
          qbo_item_id?: string | null
          qbo_tax_code_ref?: string | null
          quantity?: number
          sku_code?: string | null
          tax_code_id?: string | null
          unit_cost?: number
        }
        Update: {
          condition_grade?: string | null
          created_at?: string
          description?: string | null
          id?: string
          inbound_receipt_id?: string
          is_stock_line?: boolean
          line_total?: number
          mpn?: string | null
          qbo_item_id?: string | null
          qbo_tax_code_ref?: string | null
          quantity?: number
          sku_code?: string | null
          tax_code_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inbound_receipt_line_inbound_receipt_id_fkey"
            columns: ["inbound_receipt_id"]
            isOneToOne: false
            referencedRelation: "inbound_receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_receipt_line_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_code"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_raw_brickeconomy: {
        Row: {
          correlation_id: string | null
          entity_type: string
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_bricklink: {
        Row: {
          correlation_id: string | null
          entity_type: string
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_brickowl: {
        Row: {
          correlation_id: string | null
          entity_type: string
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_brickset: {
        Row: {
          correlation_id: string | null
          entity_type: string
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_ebay_listing: {
        Row: {
          correlation_id: string | null
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_ebay_order: {
        Row: {
          correlation_id: string | null
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_ebay_payout: {
        Row: {
          correlation_id: string | null
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string | null
          status: string
        }
        Insert: {
          correlation_id?: string | null
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string | null
          status?: string
        }
        Update: {
          correlation_id?: string | null
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string | null
          status?: string
        }
        Relationships: []
      }
      landing_raw_qbo_customer: {
        Row: {
          cloud_event_id: string | null
          correlation_id: string | null
          error_message: string | null
          event_time: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_deposit: {
        Row: {
          cloud_event_id: string | null
          correlation_id: string | null
          error_message: string | null
          event_time: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_item: {
        Row: {
          cloud_event_id: string | null
          correlation_id: string | null
          error_message: string | null
          event_time: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_purchase: {
        Row: {
          cloud_event_id: string | null
          correlation_id: string | null
          error_message: string | null
          event_time: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_refund_receipt: {
        Row: {
          cloud_event_id: string | null
          correlation_id: string | null
          error_message: string | null
          event_time: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_sales_receipt: {
        Row: {
          cloud_event_id: string | null
          correlation_id: string | null
          error_message: string | null
          event_time: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          cloud_event_id?: string | null
          correlation_id?: string | null
          error_message?: string | null
          event_time?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_tax_entity: {
        Row: {
          correlation_id: string | null
          entity_type: string
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          entity_type: string
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          entity_type?: string
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_qbo_vendor: {
        Row: {
          correlation_id: string | null
          error_message: string | null
          external_id: string
          id: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          error_message?: string | null
          external_id: string
          id?: string
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          error_message?: string | null
          external_id?: string
          id?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      landing_raw_stripe_event: {
        Row: {
          correlation_id: string | null
          error_message: string | null
          event_type: string
          external_id: string
          id: string
          is_test: boolean
          processed_at: string | null
          raw_payload: Json
          received_at: string
          status: Database["public"]["Enums"]["landing_status"]
        }
        Insert: {
          correlation_id?: string | null
          error_message?: string | null
          event_type: string
          external_id: string
          id?: string
          is_test?: boolean
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Update: {
          correlation_id?: string | null
          error_message?: string | null
          event_type?: string
          external_id?: string
          id?: string
          is_test?: boolean
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          status?: Database["public"]["Enums"]["landing_status"]
        }
        Relationships: []
      }
      lego_catalog: {
        Row: {
          brickeconomy_id: string | null
          bricklink_item_no: string | null
          brickowl_boid: string | null
          created_at: string
          description: string | null
          id: string
          img_url: string | null
          mpn: string
          name: string
          piece_count: number | null
          product_type: string
          rebrickable_id: string | null
          release_year: number | null
          retired_flag: boolean
          status: string
          subtheme_name: string | null
          theme_id: string | null
          updated_at: string
          version_descriptor: string | null
        }
        Insert: {
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          created_at?: string
          description?: string | null
          id?: string
          img_url?: string | null
          mpn: string
          name: string
          piece_count?: number | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          retired_flag?: boolean
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          updated_at?: string
          version_descriptor?: string | null
        }
        Update: {
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          created_at?: string
          description?: string | null
          id?: string
          img_url?: string | null
          mpn?: string
          name?: string
          piece_count?: number | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          retired_flag?: boolean
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          updated_at?: string
          version_descriptor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "theme"
            referencedColumns: ["id"]
          },
        ]
      }
      lovable_agent_transcripts: {
        Row: {
          body: string
          char_count: number
          created_at: string
          id: string
          message_index: number
          message_index_end: number | null
          occurred_at: string | null
          part_number: number
          role: string
          source_file: string
          title: string | null
          token_count: number
        }
        Insert: {
          body: string
          char_count?: number
          created_at?: string
          id?: string
          message_index: number
          message_index_end?: number | null
          occurred_at?: string | null
          part_number: number
          role: string
          source_file: string
          title?: string | null
          token_count?: number
        }
        Update: {
          body?: string
          char_count?: number
          created_at?: string
          id?: string
          message_index?: number
          message_index_end?: number | null
          occurred_at?: string | null
          part_number?: number
          role?: string
          source_file?: string
          title?: string | null
          token_count?: number
        }
        Relationships: []
      }
      market_price_snapshot: {
        Row: {
          captured_at: string
          channel: string | null
          condition_grade: Database["public"]["Enums"]["condition_grade"] | null
          confidence_score: number
          created_at: string
          currency: string
          freshness_score: number | null
          id: string
          metadata: Json
          mpn: string | null
          price: number
          price_high: number | null
          price_low: number | null
          raw_landing_id: string | null
          raw_landing_table: string | null
          sample_size: number | null
          sku_id: string | null
          source_id: string
          vat_treatment: string
        }
        Insert: {
          captured_at?: string
          channel?: string | null
          condition_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          confidence_score?: number
          created_at?: string
          currency?: string
          freshness_score?: number | null
          id?: string
          metadata?: Json
          mpn?: string | null
          price: number
          price_high?: number | null
          price_low?: number | null
          raw_landing_id?: string | null
          raw_landing_table?: string | null
          sample_size?: number | null
          sku_id?: string | null
          source_id: string
          vat_treatment?: string
        }
        Update: {
          captured_at?: string
          channel?: string | null
          condition_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          confidence_score?: number
          created_at?: string
          currency?: string
          freshness_score?: number | null
          id?: string
          metadata?: Json
          mpn?: string | null
          price?: number
          price_high?: number | null
          price_low?: number | null
          raw_landing_id?: string | null
          raw_landing_table?: string | null
          sample_size?: number | null
          sku_id?: string | null
          source_id?: string
          vat_treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_price_snapshot_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_price_snapshot_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_price_snapshot_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "market_price_snapshot_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "market_signal_source"
            referencedColumns: ["id"]
          },
        ]
      }
      market_signal: {
        Row: {
          channel: string | null
          condition_grade: Database["public"]["Enums"]["condition_grade"] | null
          created_at: string
          freshness_score: number | null
          id: string
          metadata: Json
          mpn: string | null
          observed_at: string
          observed_price: number | null
          observed_price_max: number | null
          observed_price_min: number | null
          raw_landing_id: string | null
          raw_landing_table: string | null
          sample_size: number | null
          signal_type: string
          sku_id: string | null
          source_confidence: number
          source_id: string
          vat_treatment: string
        }
        Insert: {
          channel?: string | null
          condition_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          created_at?: string
          freshness_score?: number | null
          id?: string
          metadata?: Json
          mpn?: string | null
          observed_at?: string
          observed_price?: number | null
          observed_price_max?: number | null
          observed_price_min?: number | null
          raw_landing_id?: string | null
          raw_landing_table?: string | null
          sample_size?: number | null
          signal_type: string
          sku_id?: string | null
          source_confidence?: number
          source_id: string
          vat_treatment?: string
        }
        Update: {
          channel?: string | null
          condition_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          created_at?: string
          freshness_score?: number | null
          id?: string
          metadata?: Json
          mpn?: string | null
          observed_at?: string
          observed_price?: number | null
          observed_price_max?: number | null
          observed_price_min?: number | null
          raw_landing_id?: string | null
          raw_landing_table?: string | null
          sample_size?: number | null
          signal_type?: string
          sku_id?: string | null
          source_confidence?: number
          source_id?: string
          vat_treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_signal_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_signal_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_signal_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "market_signal_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "market_signal_source"
            referencedColumns: ["id"]
          },
        ]
      }
      market_signal_source: {
        Row: {
          active: boolean
          created_at: string
          id: string
          metadata: Json
          name: string
          rate_limit_per_day: number | null
          source_code: string
          source_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          rate_limit_per_day?: number | null
          source_code: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          rate_limit_per_day?: number | null
          source_code?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      media_asset: {
        Row: {
          alt_text: string | null
          caption: string | null
          checksum: string | null
          created_at: string
          created_by: string | null
          file_size_bytes: number | null
          height: number | null
          id: string
          mime_type: string | null
          original_url: string
          provenance: string | null
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          mime_type?: string | null
          original_url: string
          provenance?: string | null
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          mime_type?: string | null
          original_url?: string
          provenance?: string | null
          width?: number | null
        }
        Relationships: []
      }
      member_address: {
        Row: {
          address_type: string
          city: string
          country: string
          county: string | null
          created_at: string
          id: string
          is_default: boolean
          label: string
          line_1: string
          line_2: string | null
          postcode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_type?: string
          city: string
          country?: string
          county?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          line_1: string
          line_2?: string | null
          postcode: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_type?: string
          city?: string
          country?: string
          county?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          line_1?: string
          line_2?: string | null
          postcode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      member_club_link: {
        Row: {
          approved: boolean
          club_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          club_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          club_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_club_link_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_club_link_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club_public"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_command: {
        Row: {
          command_type: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          response_payload: Json | null
          retry_count: number
          sent_at: string | null
          status: string
          target_system: string
          updated_at: string
        }
        Insert: {
          command_type: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          response_payload?: Json | null
          retry_count?: number
          sent_at?: string | null
          status?: string
          target_system: string
          updated_at?: string
        }
        Update: {
          command_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          response_payload?: Json | null
          retry_count?: number
          sent_at?: string | null
          status?: string
          target_system?: string
          updated_at?: string
        }
        Relationships: []
      }
      payout_fee: {
        Row: {
          amount: number
          channel: string
          created_at: string
          description: string | null
          external_order_id: string | null
          fee_category: string
          id: string
          payout_id: string
          qbo_purchase_id: string | null
          sales_order_id: string | null
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          amount: number
          channel?: string
          created_at?: string
          description?: string | null
          external_order_id?: string | null
          fee_category: string
          id?: string
          payout_id: string
          qbo_purchase_id?: string | null
          sales_order_id?: string | null
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          channel?: string
          created_at?: string
          description?: string | null
          external_order_id?: string | null
          fee_category?: string
          id?: string
          payout_id?: string
          qbo_purchase_id?: string | null
          sales_order_id?: string | null
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_fee_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_fee_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendor"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_fee_line: {
        Row: {
          amount: number
          created_at: string
          ebay_transaction_id: string | null
          fee_category: string
          fee_type: string
          id: string
          payout_fee_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          ebay_transaction_id?: string | null
          fee_category: string
          fee_type: string
          id?: string
          payout_fee_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          ebay_transaction_id?: string | null
          fee_category?: string
          fee_type?: string
          id?: string
          payout_fee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_fee_line_payout_fee_id_fkey"
            columns: ["payout_fee_id"]
            isOneToOne: false
            referencedRelation: "payout_fee"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_orders: {
        Row: {
          created_at: string | null
          id: string
          order_fees: number | null
          order_gross: number | null
          order_net: number | null
          payout_id: string
          sales_order_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_fees?: number | null
          order_gross?: number | null
          order_net?: number | null
          payout_id: string
          sales_order_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          order_fees?: number | null
          order_gross?: number | null
          order_net?: number | null
          payout_id?: string
          sales_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_orders_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "payout_orders_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
        ]
      }
      payouts: {
        Row: {
          bank_reference: string | null
          channel: Database["public"]["Enums"]["payout_channel"]
          created_at: string
          external_payout_id: string | null
          fee_breakdown: Json | null
          gross_amount: number
          id: string
          matched_order_count: number | null
          net_amount: number
          notes: string | null
          order_count: number
          payout_date: string
          qbo_deposit_id: string | null
          qbo_expense_id: string | null
          qbo_sync_error: string | null
          qbo_sync_status: string | null
          reconciliation_status: string | null
          sync_attempted_at: string | null
          total_fees: number
          transaction_count: number | null
          unit_count: number
          unmatched_transaction_count: number | null
          updated_at: string | null
        }
        Insert: {
          bank_reference?: string | null
          channel: Database["public"]["Enums"]["payout_channel"]
          created_at?: string
          external_payout_id?: string | null
          fee_breakdown?: Json | null
          gross_amount: number
          id?: string
          matched_order_count?: number | null
          net_amount: number
          notes?: string | null
          order_count?: number
          payout_date: string
          qbo_deposit_id?: string | null
          qbo_expense_id?: string | null
          qbo_sync_error?: string | null
          qbo_sync_status?: string | null
          reconciliation_status?: string | null
          sync_attempted_at?: string | null
          total_fees?: number
          transaction_count?: number | null
          unit_count?: number
          unmatched_transaction_count?: number | null
          updated_at?: string | null
        }
        Update: {
          bank_reference?: string | null
          channel?: Database["public"]["Enums"]["payout_channel"]
          created_at?: string
          external_payout_id?: string | null
          fee_breakdown?: Json | null
          gross_amount?: number
          id?: string
          matched_order_count?: number | null
          net_amount?: number
          notes?: string | null
          order_count?: number
          payout_date?: string
          qbo_deposit_id?: string | null
          qbo_expense_id?: string | null
          qbo_sync_error?: string | null
          qbo_sync_status?: string | null
          reconciliation_status?: string | null
          sync_attempted_at?: string | null
          total_fees?: number
          transaction_count?: number | null
          unit_count?: number
          unmatched_transaction_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      posting_intent: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          posted_at: string | null
          qbo_reference_id: string | null
          response_payload: Json | null
          retry_count: number
          status: string
          target_system: string
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          posted_at?: string | null
          qbo_reference_id?: string | null
          response_payload?: Json | null
          retry_count?: number
          status?: string
          target_system?: string
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          posted_at?: string | null
          qbo_reference_id?: string | null
          response_payload?: Json | null
          retry_count?: number
          status?: string
          target_system?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_audit_log: {
        Row: {
          created_at: string
          id: string
          new_price: number | null
          old_price: number | null
          performed_by: string | null
          reason: string
          sku_code: string
          sku_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_price?: number | null
          old_price?: number | null
          performed_by?: string | null
          reason: string
          sku_code: string
          sku_id: string
        }
        Update: {
          created_at?: string
          id?: string
          new_price?: number | null
          old_price?: number | null
          performed_by?: string | null
          reason?: string
          sku_code?: string
          sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_audit_log_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_audit_log_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_audit_log_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      price_decision_snapshot: {
        Row: {
          blocking_reasons: Json
          calculation_version: string
          candidate_price: number | null
          carrying_value_basis: number
          ceiling_price: number | null
          channel: string
          channel_listing_id: string | null
          channel_price_policy_id: string | null
          confidence_score: number
          created_at: string
          created_by: string | null
          currency: string
          current_price: number | null
          delivery_cost: number
          estimated_fees: number
          estimated_program_commission: number
          estimated_program_discount: number
          expected_gross: number
          expected_margin_amount: number | null
          expected_margin_rate: number | null
          expected_net_before_cogs: number
          floor_price: number | null
          freshness_score: number | null
          id: string
          inputs: Json
          market_consensus_price: number | null
          override_required: boolean
          packaging_cost: number
          price_policy_id: string | null
          recommendation: string
          sales_program_id: string | null
          sku_id: string
          source_divergence_score: number | null
          target_price: number | null
        }
        Insert: {
          blocking_reasons?: Json
          calculation_version?: string
          candidate_price?: number | null
          carrying_value_basis?: number
          ceiling_price?: number | null
          channel: string
          channel_listing_id?: string | null
          channel_price_policy_id?: string | null
          confidence_score?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          current_price?: number | null
          delivery_cost?: number
          estimated_fees?: number
          estimated_program_commission?: number
          estimated_program_discount?: number
          expected_gross?: number
          expected_margin_amount?: number | null
          expected_margin_rate?: number | null
          expected_net_before_cogs?: number
          floor_price?: number | null
          freshness_score?: number | null
          id?: string
          inputs?: Json
          market_consensus_price?: number | null
          override_required?: boolean
          packaging_cost?: number
          price_policy_id?: string | null
          recommendation?: string
          sales_program_id?: string | null
          sku_id: string
          source_divergence_score?: number | null
          target_price?: number | null
        }
        Update: {
          blocking_reasons?: Json
          calculation_version?: string
          candidate_price?: number | null
          carrying_value_basis?: number
          ceiling_price?: number | null
          channel?: string
          channel_listing_id?: string | null
          channel_price_policy_id?: string | null
          confidence_score?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          current_price?: number | null
          delivery_cost?: number
          estimated_fees?: number
          estimated_program_commission?: number
          estimated_program_discount?: number
          expected_gross?: number
          expected_margin_amount?: number | null
          expected_margin_rate?: number | null
          expected_net_before_cogs?: number
          floor_price?: number | null
          freshness_score?: number | null
          id?: string
          inputs?: Json
          market_consensus_price?: number | null
          override_required?: boolean
          packaging_cost?: number
          price_policy_id?: string | null
          recommendation?: string
          sales_program_id?: string | null
          sku_id?: string
          source_divergence_score?: number | null
          target_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_decision_snapshot_channel_listing_id_fkey"
            columns: ["channel_listing_id"]
            isOneToOne: false
            referencedRelation: "channel_listing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decision_snapshot_channel_price_policy_id_fkey"
            columns: ["channel_price_policy_id"]
            isOneToOne: false
            referencedRelation: "channel_price_policy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decision_snapshot_price_policy_id_fkey"
            columns: ["price_policy_id"]
            isOneToOne: false
            referencedRelation: "price_policy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decision_snapshot_sales_program_id_fkey"
            columns: ["sales_program_id"]
            isOneToOne: false
            referencedRelation: "sales_program"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decision_snapshot_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decision_snapshot_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_decision_snapshot_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      price_override: {
        Row: {
          approved_by: string | null
          channel: string
          channel_listing_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          new_price: number
          old_price: number | null
          override_type: string
          performed_by: string | null
          price_decision_snapshot_id: string | null
          reason_code: string
          reason_note: string | null
          sku_id: string
        }
        Insert: {
          approved_by?: string | null
          channel: string
          channel_listing_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          new_price: number
          old_price?: number | null
          override_type: string
          performed_by?: string | null
          price_decision_snapshot_id?: string | null
          reason_code: string
          reason_note?: string | null
          sku_id: string
        }
        Update: {
          approved_by?: string | null
          channel?: string
          channel_listing_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          new_price?: number
          old_price?: number | null
          override_type?: string
          performed_by?: string | null
          price_decision_snapshot_id?: string | null
          reason_code?: string
          reason_note?: string | null
          sku_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_override_channel_listing_id_fkey"
            columns: ["channel_listing_id"]
            isOneToOne: false
            referencedRelation: "channel_listing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_override_price_decision_snapshot_id_fkey"
            columns: ["price_decision_snapshot_id"]
            isOneToOne: false
            referencedRelation: "price_decision_snapshot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_override_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_override_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_override_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      price_policy: {
        Row: {
          clearance_markdown_days: number
          clearance_markdown_rate: number
          created_at: string
          first_markdown_days: number
          first_markdown_rate: number
          id: string
          metadata: Json
          minimum_margin_rate: number
          minimum_profit_amount: number
          name: string
          policy_code: string
          risk_reserve_rate: number
          status: string
          updated_at: string
        }
        Insert: {
          clearance_markdown_days?: number
          clearance_markdown_rate?: number
          created_at?: string
          first_markdown_days?: number
          first_markdown_rate?: number
          id?: string
          metadata?: Json
          minimum_margin_rate?: number
          minimum_profit_amount?: number
          name: string
          policy_code: string
          risk_reserve_rate?: number
          status?: string
          updated_at?: string
        }
        Update: {
          clearance_markdown_days?: number
          clearance_markdown_rate?: number
          created_at?: string
          first_markdown_days?: number
          first_markdown_rate?: number
          id?: string
          metadata?: Json
          minimum_margin_rate?: number
          minimum_profit_amount?: number
          name?: string
          policy_code?: string
          risk_reserve_rate?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pricing_fee_component: {
        Row: {
          active: boolean
          applies_to: string
          channel: string
          channel_price_policy_id: string | null
          created_at: string
          fee_category: string
          fee_name: string
          fixed_amount: number
          id: string
          notes: string | null
          rate_percent: number
          source_id: string | null
          source_table: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to?: string
          channel: string
          channel_price_policy_id?: string | null
          created_at?: string
          fee_category?: string
          fee_name: string
          fixed_amount?: number
          id?: string
          notes?: string | null
          rate_percent?: number
          source_id?: string | null
          source_table?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to?: string
          channel?: string
          channel_price_policy_id?: string | null
          created_at?: string
          fee_category?: string
          fee_name?: string
          fixed_amount?: number
          id?: string
          notes?: string | null
          rate_percent?: number
          source_id?: string | null
          source_table?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_fee_component_channel_price_policy_id_fkey"
            columns: ["channel_price_policy_id"]
            isOneToOne: false
            referencedRelation: "channel_price_policy"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          key: string
          label: string
          updated_at: string
          value: number
        }
        Insert: {
          key: string
          label: string
          updated_at?: string
          value: number
        }
        Update: {
          key?: string
          label?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      product: {
        Row: {
          age_mark: string | null
          age_range: string | null
          appliance_capabilities: string | null
          appliance_uses: string | null
          brand: string | null
          brickeconomy_id: string | null
          bricklink_item_no: string | null
          brickowl_boid: string | null
          cable_length: string | null
          call_to_action: string | null
          capacity: string | null
          colour: string | null
          compatible_lego_set: string | null
          components_included: string | null
          country_of_origin: string | null
          created_at: string
          description: string | null
          dimensions_cm: string | null
          ean: string | null
          ebay_category_id: string | null
          ebay_marketplace: string | null
          ec_range: string | null
          energy_efficiency_rating: string | null
          eprel_registration_number: string | null
          features: string | null
          field_overrides: Json | null
          food_compatibility: string | null
          gmc_product_category: string | null
          height_cm: number | null
          highlights: string | null
          id: string
          img_url: string | null
          include_catalog_img: boolean
          interests: string | null
          isbn: string | null
          item_diameter: string | null
          item_length: string | null
          item_number: string | null
          item_weight: string | null
          item_width: string | null
          lego_catalog_id: string | null
          lego_character: string | null
          lego_set_name: string | null
          lego_set_number: string | null
          lego_subtheme: string | null
          lego_theme: string | null
          length_cm: number | null
          manufacturer_warranty: string | null
          material: string | null
          meta_category: string | null
          minifigs_count: number | null
          minifigure_number: string | null
          mpn: string
          name: string | null
          number_of_blades: string | null
          number_of_items: string | null
          number_of_settings_programs: string | null
          number_of_speeds: string | null
          piece_count: number | null
          power: string | null
          power_source: string | null
          product_hook: string | null
          product_type: string
          rebrickable_id: string | null
          release_year: number | null
          released_date: string | null
          retail_price: number | null
          retired: string | null
          retired_date: string | null
          retired_flag: boolean
          selected_minifig_fig_nums: Json
          seo_description: string | null
          seo_title: string | null
          set_number: string | null
          status: string
          subtheme_name: string | null
          theme_id: string | null
          unit_quantity: string | null
          unit_type: string | null
          upc: string | null
          updated_at: string
          version_descriptor: string | null
          voltage: string | null
          weight_g: number | null
          weight_kg: number | null
          width_cm: number | null
          year_manufactured: string | null
          year_retired: string | null
        }
        Insert: {
          age_mark?: string | null
          age_range?: string | null
          appliance_capabilities?: string | null
          appliance_uses?: string | null
          brand?: string | null
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          cable_length?: string | null
          call_to_action?: string | null
          capacity?: string | null
          colour?: string | null
          compatible_lego_set?: string | null
          components_included?: string | null
          country_of_origin?: string | null
          created_at?: string
          description?: string | null
          dimensions_cm?: string | null
          ean?: string | null
          ebay_category_id?: string | null
          ebay_marketplace?: string | null
          ec_range?: string | null
          energy_efficiency_rating?: string | null
          eprel_registration_number?: string | null
          features?: string | null
          field_overrides?: Json | null
          food_compatibility?: string | null
          gmc_product_category?: string | null
          height_cm?: number | null
          highlights?: string | null
          id?: string
          img_url?: string | null
          include_catalog_img?: boolean
          interests?: string | null
          isbn?: string | null
          item_diameter?: string | null
          item_length?: string | null
          item_number?: string | null
          item_weight?: string | null
          item_width?: string | null
          lego_catalog_id?: string | null
          lego_character?: string | null
          lego_set_name?: string | null
          lego_set_number?: string | null
          lego_subtheme?: string | null
          lego_theme?: string | null
          length_cm?: number | null
          manufacturer_warranty?: string | null
          material?: string | null
          meta_category?: string | null
          minifigs_count?: number | null
          minifigure_number?: string | null
          mpn: string
          name?: string | null
          number_of_blades?: string | null
          number_of_items?: string | null
          number_of_settings_programs?: string | null
          number_of_speeds?: string | null
          piece_count?: number | null
          power?: string | null
          power_source?: string | null
          product_hook?: string | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          released_date?: string | null
          retail_price?: number | null
          retired?: string | null
          retired_date?: string | null
          retired_flag?: boolean
          selected_minifig_fig_nums?: Json
          seo_description?: string | null
          seo_title?: string | null
          set_number?: string | null
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          unit_quantity?: string | null
          unit_type?: string | null
          upc?: string | null
          updated_at?: string
          version_descriptor?: string | null
          voltage?: string | null
          weight_g?: number | null
          weight_kg?: number | null
          width_cm?: number | null
          year_manufactured?: string | null
          year_retired?: string | null
        }
        Update: {
          age_mark?: string | null
          age_range?: string | null
          appliance_capabilities?: string | null
          appliance_uses?: string | null
          brand?: string | null
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          cable_length?: string | null
          call_to_action?: string | null
          capacity?: string | null
          colour?: string | null
          compatible_lego_set?: string | null
          components_included?: string | null
          country_of_origin?: string | null
          created_at?: string
          description?: string | null
          dimensions_cm?: string | null
          ean?: string | null
          ebay_category_id?: string | null
          ebay_marketplace?: string | null
          ec_range?: string | null
          energy_efficiency_rating?: string | null
          eprel_registration_number?: string | null
          features?: string | null
          field_overrides?: Json | null
          food_compatibility?: string | null
          gmc_product_category?: string | null
          height_cm?: number | null
          highlights?: string | null
          id?: string
          img_url?: string | null
          include_catalog_img?: boolean
          interests?: string | null
          isbn?: string | null
          item_diameter?: string | null
          item_length?: string | null
          item_number?: string | null
          item_weight?: string | null
          item_width?: string | null
          lego_catalog_id?: string | null
          lego_character?: string | null
          lego_set_name?: string | null
          lego_set_number?: string | null
          lego_subtheme?: string | null
          lego_theme?: string | null
          length_cm?: number | null
          manufacturer_warranty?: string | null
          material?: string | null
          meta_category?: string | null
          minifigs_count?: number | null
          minifigure_number?: string | null
          mpn?: string
          name?: string | null
          number_of_blades?: string | null
          number_of_items?: string | null
          number_of_settings_programs?: string | null
          number_of_speeds?: string | null
          piece_count?: number | null
          power?: string | null
          power_source?: string | null
          product_hook?: string | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          released_date?: string | null
          retail_price?: number | null
          retired?: string | null
          retired_date?: string | null
          retired_flag?: boolean
          selected_minifig_fig_nums?: Json
          seo_description?: string | null
          seo_title?: string | null
          set_number?: string | null
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          unit_quantity?: string | null
          unit_type?: string | null
          upc?: string | null
          updated_at?: string
          version_descriptor?: string | null
          voltage?: string | null
          weight_g?: number | null
          weight_kg?: number | null
          width_cm?: number | null
          year_manufactured?: string | null
          year_retired?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_lego_catalog_id_fkey"
            columns: ["lego_catalog_id"]
            isOneToOne: false
            referencedRelation: "lego_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "theme"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attribute: {
        Row: {
          aspect_key: string | null
          category_id: string | null
          channel: string | null
          chosen_source: string | null
          custom_value: string | null
          id: string
          is_override: boolean
          key: string
          marketplace: string | null
          namespace: string
          product_id: string
          source: string
          source_value: string | null
          source_values_jsonb: Json | null
          updated_at: string
          value: string | null
          value_json: Json | null
        }
        Insert: {
          aspect_key?: string | null
          category_id?: string | null
          channel?: string | null
          chosen_source?: string | null
          custom_value?: string | null
          id?: string
          is_override?: boolean
          key: string
          marketplace?: string | null
          namespace: string
          product_id: string
          source?: string
          source_value?: string | null
          source_values_jsonb?: Json | null
          updated_at?: string
          value?: string | null
          value_json?: Json | null
        }
        Update: {
          aspect_key?: string | null
          category_id?: string | null
          channel?: string | null
          chosen_source?: string | null
          custom_value?: string | null
          id?: string
          is_override?: boolean
          key?: string
          marketplace?: string | null
          namespace?: string
          product_id?: string
          source?: string
          source_value?: string | null
          source_values_jsonb?: Json | null
          updated_at?: string
          value?: string | null
          value_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          media_asset_id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          media_asset_id: string
          product_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          media_asset_id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_media_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_asset"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
        ]
      }
      profile: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string
          display_name: string | null
          ebay_username: string | null
          facebook_handle: string | null
          first_name: string | null
          id: string
          instagram_handle: string | null
          last_name: string | null
          mobile: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          display_name?: string | null
          ebay_username?: string | null
          facebook_handle?: string | null
          first_name?: string | null
          id?: string
          instagram_handle?: string | null
          last_name?: string | null
          mobile?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          display_name?: string | null
          ebay_username?: string | null
          facebook_handle?: string | null
          first_name?: string | null
          id?: string
          instagram_handle?: string | null
          last_name?: string | null
          mobile?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_change_log: {
        Row: {
          changed_by: string | null
          created_at: string
          effective_date: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          user_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          effective_date?: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          effective_date?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id?: string
        }
        Relationships: []
      }
      purchase_batches: {
        Row: {
          created_at: string
          id: string
          purchase_date: string
          qbo_purchase_id: string | null
          qbo_sync_attempted_at: string | null
          qbo_sync_error: string | null
          qbo_sync_status: string
          reference: string | null
          shared_costs: Json
          status: Database["public"]["Enums"]["purchase_batch_status"]
          supplier_id: string | null
          supplier_name: string
          supplier_vat_registered: boolean
          total_shared_costs: number
          unit_counter: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          purchase_date?: string
          qbo_purchase_id?: string | null
          qbo_sync_attempted_at?: string | null
          qbo_sync_error?: string | null
          qbo_sync_status?: string
          reference?: string | null
          shared_costs?: Json
          status?: Database["public"]["Enums"]["purchase_batch_status"]
          supplier_id?: string | null
          supplier_name: string
          supplier_vat_registered?: boolean
          total_shared_costs?: number
          unit_counter?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          purchase_date?: string
          qbo_purchase_id?: string | null
          qbo_sync_attempted_at?: string | null
          qbo_sync_error?: string | null
          qbo_sync_status?: string
          reference?: string | null
          shared_costs?: Json
          status?: Database["public"]["Enums"]["purchase_batch_status"]
          supplier_id?: string | null
          supplier_name?: string
          supplier_vat_registered?: boolean
          total_shared_costs?: number
          unit_counter?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "vendor"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_line_items: {
        Row: {
          apportioned_cost: number
          batch_id: string
          created_at: string
          id: string
          landed_cost_per_unit: number
          mpn: string
          quantity: number
          unit_cost: number
        }
        Insert: {
          apportioned_cost?: number
          batch_id: string
          created_at?: string
          id?: string
          landed_cost_per_unit?: number
          mpn: string
          quantity: number
          unit_cost: number
        }
        Update: {
          apportioned_cost?: number
          batch_id?: string
          created_at?: string
          id?: string
          landed_cost_per_unit?: number
          mpn?: string
          quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_line_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "purchase_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_account_mapping: {
        Row: {
          account_type: string
          created_at: string | null
          id: string
          purpose: string
          qbo_account_id: string
          qbo_account_name: string
          updated_at: string | null
        }
        Insert: {
          account_type: string
          created_at?: string | null
          id?: string
          purpose: string
          qbo_account_id: string
          qbo_account_name: string
          updated_at?: string | null
        }
        Update: {
          account_type?: string
          created_at?: string | null
          id?: string
          purpose?: string
          qbo_account_id?: string
          qbo_account_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      qbo_account_settings: {
        Row: {
          account_id: string
          account_name: string | null
          account_type: string | null
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          account_name?: string | null
          account_type?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          account_name?: string | null
          account_type?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      qbo_connection: {
        Row: {
          access_token: string
          created_at: string
          id: string
          realm_id: string
          refresh_token: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          realm_id: string
          refresh_token: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          realm_id?: string
          refresh_token?: string
          token_expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_posting_reference: {
        Row: {
          created_at: string
          id: string
          local_entity_id: string | null
          local_entity_type: string
          metadata: Json
          posting_intent_id: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string
          qbo_entity_type: string
          raw_landing_id: string | null
          raw_landing_table: string | null
          source_column: string | null
          synced_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          local_entity_id?: string | null
          local_entity_type: string
          metadata?: Json
          posting_intent_id?: string | null
          qbo_doc_number?: string | null
          qbo_entity_id: string
          qbo_entity_type: string
          raw_landing_id?: string | null
          raw_landing_table?: string | null
          source_column?: string | null
          synced_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          local_entity_id?: string | null
          local_entity_type?: string
          metadata?: Json
          posting_intent_id?: string | null
          qbo_doc_number?: string | null
          qbo_entity_id?: string
          qbo_entity_type?: string
          raw_landing_id?: string | null
          raw_landing_table?: string | null
          source_column?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_posting_reference_posting_intent_id_fkey"
            columns: ["posting_intent_id"]
            isOneToOne: false
            referencedRelation: "posting_intent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_posting_reference_posting_intent_id_fkey"
            columns: ["posting_intent_id"]
            isOneToOne: false
            referencedRelation: "v_posting_intent_with_references"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_refresh_drift: {
        Row: {
          app_reference: string | null
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          current_values: Json
          drift_type: string
          id: string
          local_entity_id: string | null
          local_entity_type: string | null
          local_reference: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string
          qbo_refresh_run_id: string
          qbo_values: Json
          recommended_action: string | null
          severity: string
          status: string
          target_route: string | null
        }
        Insert: {
          app_reference?: string | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_values?: Json
          drift_type: string
          id?: string
          local_entity_id?: string | null
          local_entity_type?: string | null
          local_reference?: string | null
          qbo_doc_number?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type: string
          qbo_refresh_run_id: string
          qbo_values?: Json
          recommended_action?: string | null
          severity?: string
          status?: string
          target_route?: string | null
        }
        Update: {
          app_reference?: string | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          current_values?: Json
          drift_type?: string
          id?: string
          local_entity_id?: string | null
          local_entity_type?: string | null
          local_reference?: string | null
          qbo_doc_number?: string | null
          qbo_entity_id?: string | null
          qbo_entity_type?: string
          qbo_refresh_run_id?: string
          qbo_values?: Json
          recommended_action?: string | null
          severity?: string
          status?: string
          target_route?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_refresh_drift_qbo_refresh_run_id_fkey"
            columns: ["qbo_refresh_run_id"]
            isOneToOne: false
            referencedRelation: "qbo_refresh_run"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_refresh_run: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          mode: string
          requested_by: string | null
          requested_scope: Json
          result_summary: Json
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          mode?: string
          requested_by?: string | null
          requested_scope?: Json
          result_summary?: Json
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          mode?: string
          requested_by?: string | null
          requested_scope?: Json
          result_summary?: Json
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      rebrickable_inventories: {
        Row: {
          id: number
          set_num: string
          version: number
        }
        Insert: {
          id: number
          set_num: string
          version?: number
        }
        Update: {
          id?: number
          set_num?: string
          version?: number
        }
        Relationships: []
      }
      rebrickable_inventory_minifigs: {
        Row: {
          fig_num: string
          inventory_id: number
          quantity: number
        }
        Insert: {
          fig_num: string
          inventory_id: number
          quantity?: number
        }
        Update: {
          fig_num?: string
          inventory_id?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "rebrickable_inventory_minifigs_fig_num_fkey"
            columns: ["fig_num"]
            isOneToOne: false
            referencedRelation: "rebrickable_minifigs"
            referencedColumns: ["fig_num"]
          },
          {
            foreignKeyName: "rebrickable_inventory_minifigs_fig_num_fkey"
            columns: ["fig_num"]
            isOneToOne: false
            referencedRelation: "set_minifigs"
            referencedColumns: ["fig_num"]
          },
          {
            foreignKeyName: "rebrickable_inventory_minifigs_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "rebrickable_inventories"
            referencedColumns: ["id"]
          },
        ]
      }
      rebrickable_minifigs: {
        Row: {
          bricklink_id: string | null
          fig_num: string
          img_url: string | null
          name: string
          num_parts: number
        }
        Insert: {
          bricklink_id?: string | null
          fig_num: string
          img_url?: string | null
          name: string
          num_parts?: number
        }
        Update: {
          bricklink_id?: string | null
          fig_num?: string
          img_url?: string | null
          name?: string
          num_parts?: number
        }
        Relationships: []
      }
      reconciliation_case: {
        Row: {
          amount_actual: number | null
          amount_expected: number | null
          case_type: string
          close_code: string | null
          closed_at: string | null
          created_at: string
          due_at: string | null
          evidence: Json
          id: string
          owner_id: string | null
          payout_id: string | null
          recommended_action: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          severity: string
          status: string
          suspected_root_cause: string | null
          updated_at: string
          variance_amount: number | null
        }
        Insert: {
          amount_actual?: number | null
          amount_expected?: number | null
          case_type: string
          close_code?: string | null
          closed_at?: string | null
          created_at?: string
          due_at?: string | null
          evidence?: Json
          id?: string
          owner_id?: string | null
          payout_id?: string | null
          recommended_action?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          severity?: string
          status?: string
          suspected_root_cause?: string | null
          updated_at?: string
          variance_amount?: number | null
        }
        Update: {
          amount_actual?: number | null
          amount_expected?: number | null
          case_type?: string
          close_code?: string | null
          closed_at?: string | null
          created_at?: string
          due_at?: string | null
          evidence?: Json
          id?: string
          owner_id?: string | null
          payout_id?: string | null
          recommended_action?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          severity?: string
          status?: string
          suspected_root_cause?: string | null
          updated_at?: string
          variance_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_case_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
        ]
      }
      reconciliation_case_note: {
        Row: {
          actor_id: string | null
          created_at: string
          evidence: Json
          id: string
          note: string | null
          note_type: string
          reconciliation_case_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          note?: string | null
          note_type?: string
          reconciliation_case_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          note?: string | null
          note_type?: string
          reconciliation_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_case_note_reconciliation_case_id_fkey"
            columns: ["reconciliation_case_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_case"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_note_reconciliation_case_id_fkey"
            columns: ["reconciliation_case_id"]
            isOneToOne: false
            referencedRelation: "v_reconciliation_case_export"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_note_reconciliation_case_id_fkey"
            columns: ["reconciliation_case_id"]
            isOneToOne: false
            referencedRelation: "v_reconciliation_inbox"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order: {
        Row: {
          blue_bell_club: boolean
          carrier: string | null
          club_commission_amount: number
          club_discount_amount: number
          club_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          delivered_at: string | null
          discount_total: number
          doc_number: string | null
          external_order_id: string | null
          global_tax_calculation: string | null
          gross_total: number
          guest_email: string | null
          guest_name: string | null
          id: string
          is_test: boolean
          merchandise_subtotal: number
          net_amount: number | null
          notes: string | null
          order_number: string
          origin_channel: string
          origin_reference: string | null
          payment_method: string | null
          payment_reference: string | null
          qbo_customer_id: string | null
          qbo_last_attempt_at: string | null
          qbo_last_error: string | null
          qbo_retry_count: number | null
          qbo_sales_receipt_id: string | null
          qbo_sync_status: string | null
          shipped_date: string | null
          shipped_via: string | null
          shipping_city: string
          shipping_country: string
          shipping_county: string | null
          shipping_line_1: string
          shipping_line_2: string | null
          shipping_name: string
          shipping_postcode: string
          shipping_total: number
          status: Database["public"]["Enums"]["order_status"]
          tax_total: number
          tracking_number: string | null
          txn_date: string | null
          updated_at: string
          user_id: string | null
          v2_status: Database["public"]["Enums"]["v2_order_status"] | null
          vat_amount: number | null
        }
        Insert: {
          blue_bell_club?: boolean
          carrier?: string | null
          club_commission_amount?: number
          club_discount_amount?: number
          club_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          delivered_at?: string | null
          discount_total?: number
          doc_number?: string | null
          external_order_id?: string | null
          global_tax_calculation?: string | null
          gross_total: number
          guest_email?: string | null
          guest_name?: string | null
          id?: string
          is_test?: boolean
          merchandise_subtotal: number
          net_amount?: number | null
          notes?: string | null
          order_number?: string
          origin_channel?: string
          origin_reference?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          qbo_customer_id?: string | null
          qbo_last_attempt_at?: string | null
          qbo_last_error?: string | null
          qbo_retry_count?: number | null
          qbo_sales_receipt_id?: string | null
          qbo_sync_status?: string | null
          shipped_date?: string | null
          shipped_via?: string | null
          shipping_city?: string
          shipping_country?: string
          shipping_county?: string | null
          shipping_line_1?: string
          shipping_line_2?: string | null
          shipping_name?: string
          shipping_postcode?: string
          shipping_total?: number
          status?: Database["public"]["Enums"]["order_status"]
          tax_total?: number
          tracking_number?: string | null
          txn_date?: string | null
          updated_at?: string
          user_id?: string | null
          v2_status?: Database["public"]["Enums"]["v2_order_status"] | null
          vat_amount?: number | null
        }
        Update: {
          blue_bell_club?: boolean
          carrier?: string | null
          club_commission_amount?: number
          club_discount_amount?: number
          club_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          delivered_at?: string | null
          discount_total?: number
          doc_number?: string | null
          external_order_id?: string | null
          global_tax_calculation?: string | null
          gross_total?: number
          guest_email?: string | null
          guest_name?: string | null
          id?: string
          is_test?: boolean
          merchandise_subtotal?: number
          net_amount?: number | null
          notes?: string | null
          order_number?: string
          origin_channel?: string
          origin_reference?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          qbo_customer_id?: string | null
          qbo_last_attempt_at?: string | null
          qbo_last_error?: string | null
          qbo_retry_count?: number | null
          qbo_sales_receipt_id?: string | null
          qbo_sync_status?: string | null
          shipped_date?: string | null
          shipped_via?: string | null
          shipping_city?: string
          shipping_country?: string
          shipping_county?: string | null
          shipping_line_1?: string
          shipping_line_2?: string | null
          shipping_name?: string
          shipping_postcode?: string
          shipping_total?: number
          status?: Database["public"]["Enums"]["order_status"]
          tax_total?: number
          tracking_number?: string | null
          txn_date?: string | null
          updated_at?: string
          user_id?: string | null
          v2_status?: Database["public"]["Enums"]["v2_order_status"] | null
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "club_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_order_line: {
        Row: {
          cogs: number | null
          cogs_amount: number | null
          cogs_source_unit_id: string | null
          costing_method: string | null
          created_at: string
          economics_status: string
          fee_snapshot: Json
          gross_margin_amount: number | null
          id: string
          line_discount: number
          line_total: number
          net_margin_amount: number | null
          net_margin_rate: number | null
          price_decision_snapshot_id: string | null
          program_commission_amount: number
          program_discount_amount: number
          qbo_tax_code_ref: string | null
          quantity: number
          sales_order_id: string
          sku_id: string
          stock_unit_id: string | null
          tax_code_id: string | null
          unit_price: number
          vat_rate_id: string | null
        }
        Insert: {
          cogs?: number | null
          cogs_amount?: number | null
          cogs_source_unit_id?: string | null
          costing_method?: string | null
          created_at?: string
          economics_status?: string
          fee_snapshot?: Json
          gross_margin_amount?: number | null
          id?: string
          line_discount?: number
          line_total: number
          net_margin_amount?: number | null
          net_margin_rate?: number | null
          price_decision_snapshot_id?: string | null
          program_commission_amount?: number
          program_discount_amount?: number
          qbo_tax_code_ref?: string | null
          quantity?: number
          sales_order_id: string
          sku_id: string
          stock_unit_id?: string | null
          tax_code_id?: string | null
          unit_price: number
          vat_rate_id?: string | null
        }
        Update: {
          cogs?: number | null
          cogs_amount?: number | null
          cogs_source_unit_id?: string | null
          costing_method?: string | null
          created_at?: string
          economics_status?: string
          fee_snapshot?: Json
          gross_margin_amount?: number | null
          id?: string
          line_discount?: number
          line_total?: number
          net_margin_amount?: number | null
          net_margin_rate?: number | null
          price_decision_snapshot_id?: string | null
          program_commission_amount?: number
          program_discount_amount?: number
          qbo_tax_code_ref?: string | null
          quantity?: number
          sales_order_id?: string
          sku_id?: string
          stock_unit_id?: string | null
          tax_code_id?: string | null
          unit_price?: number
          vat_rate_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_price_decision_snapshot_id_fkey"
            columns: ["price_decision_snapshot_id"]
            isOneToOne: false
            referencedRelation: "price_decision_snapshot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_code"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_vat_rate_id_fkey"
            columns: ["vat_rate_id"]
            isOneToOne: false
            referencedRelation: "vat_rate"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_program: {
        Row: {
          created_at: string
          default_commission_rate: number
          default_discount_rate: number
          id: string
          metadata: Json
          name: string
          program_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_commission_rate?: number
          default_discount_rate?: number
          id?: string
          metadata?: Json
          name: string
          program_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_commission_rate?: number
          default_discount_rate?: number
          id?: string
          metadata?: Json
          name?: string
          program_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_program_accrual: {
        Row: {
          accrual_type: string
          attribution_id: string | null
          basis_amount: number
          commission_amount: number
          created_at: string
          currency: string
          discount_amount: number
          id: string
          metadata: Json
          reversed_amount: number
          sales_order_id: string
          sales_program_id: string
          settlement_id: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          accrual_type?: string
          attribution_id?: string | null
          basis_amount?: number
          commission_amount?: number
          created_at?: string
          currency?: string
          discount_amount?: number
          id?: string
          metadata?: Json
          reversed_amount?: number
          sales_order_id: string
          sales_program_id: string
          settlement_id?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          accrual_type?: string
          attribution_id?: string | null
          basis_amount?: number
          commission_amount?: number
          created_at?: string
          currency?: string
          discount_amount?: number
          id?: string
          metadata?: Json
          reversed_amount?: number
          sales_order_id?: string
          sales_program_id?: string
          settlement_id?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_accrual_attribution_id_fkey"
            columns: ["attribution_id"]
            isOneToOne: false
            referencedRelation: "sales_program_attribution"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_accrual_sales_program_id_fkey"
            columns: ["sales_program_id"]
            isOneToOne: false
            referencedRelation: "sales_program"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_program_accrual_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "sales_program_settlement"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_program_attribution: {
        Row: {
          actor_id: string | null
          attribution_reason: string | null
          attribution_source: string
          corrected_from_attribution_id: string | null
          created_at: string
          id: string
          locked_at: string | null
          sales_order_id: string
          sales_program_id: string
        }
        Insert: {
          actor_id?: string | null
          attribution_reason?: string | null
          attribution_source: string
          corrected_from_attribution_id?: string | null
          created_at?: string
          id?: string
          locked_at?: string | null
          sales_order_id: string
          sales_program_id: string
        }
        Update: {
          actor_id?: string | null
          attribution_reason?: string | null
          attribution_source?: string
          corrected_from_attribution_id?: string | null
          created_at?: string
          id?: string
          locked_at?: string | null
          sales_order_id?: string
          sales_program_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_attribution_corrected_from_attribution_id_fkey"
            columns: ["corrected_from_attribution_id"]
            isOneToOne: false
            referencedRelation: "sales_program_attribution"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_program_attribution_sales_program_id_fkey"
            columns: ["sales_program_id"]
            isOneToOne: false
            referencedRelation: "sales_program"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_program_rule: {
        Row: {
          active: boolean
          commission_basis: string
          commission_rate: number
          created_at: string
          created_by: string | null
          currency: string
          discount_basis: string
          discount_rate: number
          effective_from: string
          effective_to: string | null
          id: string
          sales_program_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          commission_basis?: string
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_basis?: string
          discount_rate?: number
          effective_from?: string
          effective_to?: string | null
          id?: string
          sales_program_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          commission_basis?: string
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_basis?: string
          discount_rate?: number
          effective_from?: string
          effective_to?: string | null
          id?: string
          sales_program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_rule_sales_program_id_fkey"
            columns: ["sales_program_id"]
            isOneToOne: false
            referencedRelation: "sales_program"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_program_settlement: {
        Row: {
          commission_amount: number
          created_at: string
          created_by: string | null
          discount_amount: number
          gross_sales_amount: number
          id: string
          notes: string | null
          paid_amount: number
          period_end: string
          period_start: string
          qbo_expense_id: string | null
          qbo_payment_reference: string | null
          reversed_amount: number
          sales_program_id: string
          status: string
          updated_at: string
        }
        Insert: {
          commission_amount?: number
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          gross_sales_amount?: number
          id?: string
          notes?: string | null
          paid_amount?: number
          period_end: string
          period_start: string
          qbo_expense_id?: string | null
          qbo_payment_reference?: string | null
          reversed_amount?: number
          sales_program_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          commission_amount?: number
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          gross_sales_amount?: number
          id?: string
          notes?: string | null
          paid_amount?: number
          period_end?: string
          period_start?: string
          qbo_expense_id?: string | null
          qbo_payment_reference?: string | null
          reversed_amount?: number
          sales_program_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_settlement_sales_program_id_fkey"
            columns: ["sales_program_id"]
            isOneToOne: false
            referencedRelation: "sales_program"
            referencedColumns: ["id"]
          },
        ]
      }
      selling_cost_defaults: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: number
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: number
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      seo_document: {
        Row: {
          created_at: string
          created_by: string | null
          document_key: string
          document_type: string
          entity_id: string | null
          entity_reference: string | null
          entity_type: string | null
          id: string
          metadata: Json
          published_revision_id: string | null
          route_path: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_key: string
          document_type: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          published_revision_id?: string | null
          route_path?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_key?: string
          document_type?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          published_revision_id?: string | null
          route_path?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_document_published_revision_id_fkey"
            columns: ["published_revision_id"]
            isOneToOne: false
            referencedRelation: "seo_revision"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_revision: {
        Row: {
          breadcrumbs: Json
          canonical_path: string
          canonical_url: string
          change_summary: string | null
          created_at: string
          created_by: string | null
          geo: Json
          id: string
          image_metadata: Json
          indexation_policy: string
          keywords: string[]
          meta_description: string
          metadata: Json
          open_graph: Json
          published_at: string | null
          revision_number: number
          robots_directive: string
          seo_document_id: string
          sitemap: Json
          source: string
          status: string
          structured_data: Json
          title_tag: string
          twitter_card: Json
        }
        Insert: {
          breadcrumbs?: Json
          canonical_path: string
          canonical_url: string
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          geo?: Json
          id?: string
          image_metadata?: Json
          indexation_policy?: string
          keywords?: string[]
          meta_description: string
          metadata?: Json
          open_graph?: Json
          published_at?: string | null
          revision_number: number
          robots_directive?: string
          seo_document_id: string
          sitemap?: Json
          source?: string
          status?: string
          structured_data?: Json
          title_tag: string
          twitter_card?: Json
        }
        Update: {
          breadcrumbs?: Json
          canonical_path?: string
          canonical_url?: string
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          geo?: Json
          id?: string
          image_metadata?: Json
          indexation_policy?: string
          keywords?: string[]
          meta_description?: string
          metadata?: Json
          open_graph?: Json
          published_at?: string | null
          revision_number?: number
          robots_directive?: string
          seo_document_id?: string
          sitemap?: Json
          source?: string
          status?: string
          structured_data?: Json
          title_tag?: string
          twitter_card?: Json
        }
        Relationships: [
          {
            foreignKeyName: "seo_revision_seo_document_id_fkey"
            columns: ["seo_document_id"]
            isOneToOne: false
            referencedRelation: "seo_document"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_rate_table: {
        Row: {
          active: boolean
          carrier: string
          channel: string
          cost: number
          created_at: string
          destination: string
          est_delivery: string | null
          id: string
          max_compensation: number | null
          max_depth_cm: number | null
          max_girth_cm: number | null
          max_length_cm: number | null
          max_weight_kg: number
          max_width_cm: number | null
          price_ex_vat: number
          price_inc_vat: number
          service_name: string
          size_band: string | null
          tier: string | null
          tracked: boolean
          updated_at: string
          vat_exempt: boolean
        }
        Insert: {
          active?: boolean
          carrier: string
          channel?: string
          cost?: number
          created_at?: string
          destination?: string
          est_delivery?: string | null
          id?: string
          max_compensation?: number | null
          max_depth_cm?: number | null
          max_girth_cm?: number | null
          max_length_cm?: number | null
          max_weight_kg: number
          max_width_cm?: number | null
          price_ex_vat?: number
          price_inc_vat?: number
          service_name: string
          size_band?: string | null
          tier?: string | null
          tracked?: boolean
          updated_at?: string
          vat_exempt?: boolean
        }
        Update: {
          active?: boolean
          carrier?: string
          channel?: string
          cost?: number
          created_at?: string
          destination?: string
          est_delivery?: string | null
          id?: string
          max_compensation?: number | null
          max_depth_cm?: number | null
          max_girth_cm?: number | null
          max_length_cm?: number | null
          max_weight_kg?: number
          max_width_cm?: number | null
          price_ex_vat?: number
          price_inc_vat?: number
          service_name?: string
          size_band?: string | null
          tier?: string | null
          tracked?: boolean
          updated_at?: string
          vat_exempt?: boolean
        }
        Relationships: []
      }
      sku: {
        Row: {
          active_flag: boolean
          avg_cost: number | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          condition_notes: string | null
          cost_range: string | null
          created_at: string
          floor_price: number | null
          id: string
          market_price: number | null
          mpn: string | null
          name: string | null
          price: number | null
          product_id: string | null
          qbo_item_id: string | null
          qbo_parent_item_id: string | null
          sale_price: number | null
          saleable_flag: boolean
          sku_code: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
          v2_markdown_applied: string | null
        }
        Insert: {
          active_flag?: boolean
          avg_cost?: number | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          condition_notes?: string | null
          cost_range?: string | null
          created_at?: string
          floor_price?: number | null
          id?: string
          market_price?: number | null
          mpn?: string | null
          name?: string | null
          price?: number | null
          product_id?: string | null
          qbo_item_id?: string | null
          qbo_parent_item_id?: string | null
          sale_price?: number | null
          saleable_flag?: boolean
          sku_code: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
          v2_markdown_applied?: string | null
        }
        Update: {
          active_flag?: boolean
          avg_cost?: number | null
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          condition_notes?: string | null
          cost_range?: string | null
          created_at?: string
          floor_price?: number | null
          id?: string
          market_price?: number | null
          mpn?: string | null
          name?: string | null
          price?: number | null
          product_id?: string | null
          qbo_item_id?: string | null
          qbo_parent_item_id?: string | null
          sale_price?: number | null
          saleable_flag?: boolean
          sku_code?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
          v2_markdown_applied?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sku_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
        ]
      }
      source_field_mapping: {
        Row: {
          canonical_key: string
          created_at: string
          id: string
          source: string
          source_field: string
          transform: string | null
          updated_at: string
        }
        Insert: {
          canonical_key: string
          created_at?: string
          id?: string
          source: string
          source_field: string
          transform?: string | null
          updated_at?: string
        }
        Update: {
          canonical_key?: string
          created_at?: string
          id?: string
          source?: string
          source_field?: string
          transform?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_field_mapping_canonical_key_fkey"
            columns: ["canonical_key"]
            isOneToOne: false
            referencedRelation: "canonical_attribute"
            referencedColumns: ["key"]
          },
        ]
      }
      stock_allocation: {
        Row: {
          actor_id: string | null
          allocated_at: string | null
          allocation_method: string
          allocation_source: string
          created_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          released_at: string | null
          requested_stock_unit_id: string | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          selected_stock_unit_id: string | null
          sku_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          allocated_at?: string | null
          allocation_method: string
          allocation_source?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          released_at?: string | null
          requested_stock_unit_id?: string | null
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          selected_stock_unit_id?: string | null
          sku_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          allocated_at?: string | null
          allocation_method?: string
          allocation_source?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          released_at?: string | null
          requested_stock_unit_id?: string | null
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          selected_stock_unit_id?: string | null
          sku_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_allocation_requested_stock_unit_id_fkey"
            columns: ["requested_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_allocation_requested_stock_unit_id_fkey"
            columns: ["requested_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_allocation_requested_stock_unit_id_fkey"
            columns: ["requested_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_allocation_requested_stock_unit_id_fkey"
            columns: ["requested_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "stock_allocation_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "stock_allocation_selected_stock_unit_id_fkey"
            columns: ["selected_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_allocation_selected_stock_unit_id_fkey"
            columns: ["selected_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_allocation_selected_stock_unit_id_fkey"
            columns: ["selected_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_allocation_selected_stock_unit_id_fkey"
            columns: ["selected_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_allocation_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_allocation_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_allocation_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      stock_cost_event: {
        Row: {
          amount: number
          carrying_value_after: number | null
          carrying_value_before: number | null
          costing_method: string | null
          created_at: string
          currency: string
          event_at: string
          event_type: string
          id: string
          idempotency_key: string
          metadata: Json
          sales_order_id: string | null
          sales_order_line_id: string | null
          source: string
          stock_allocation_id: string | null
          stock_unit_id: string | null
        }
        Insert: {
          amount?: number
          carrying_value_after?: number | null
          carrying_value_before?: number | null
          costing_method?: string | null
          created_at?: string
          currency?: string
          event_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          metadata?: Json
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          source?: string
          stock_allocation_id?: string | null
          stock_unit_id?: string | null
        }
        Update: {
          amount?: number
          carrying_value_after?: number | null
          carrying_value_before?: number | null
          costing_method?: string | null
          created_at?: string
          currency?: string
          event_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          sales_order_id?: string | null
          sales_order_line_id?: string | null
          source?: string
          stock_allocation_id?: string | null
          stock_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "stock_cost_event_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "stock_cost_event_stock_allocation_id_fkey"
            columns: ["stock_allocation_id"]
            isOneToOne: false
            referencedRelation: "stock_allocation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_cost_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "stock_cost_event_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
        ]
      }
      stock_unit: {
        Row: {
          accumulated_impairment: number
          batch_id: string | null
          carrying_value: number | null
          completed_at: string | null
          condition_flags: Json | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          delivered_at: string | null
          graded_at: string | null
          id: string
          inbound_receipt_line_id: string | null
          landed_cost: number | null
          line_item_id: string | null
          listed_at: string | null
          location_id: string | null
          mpn: string
          notes: string | null
          order_id: string | null
          payout_id: string | null
          reservation_id: string | null
          serial_or_internal_mark: string | null
          shipped_at: string | null
          sku_id: string
          sold_at: string | null
          status: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id: string | null
          uid: string | null
          updated_at: string
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        Insert: {
          accumulated_impairment?: number
          batch_id?: string | null
          carrying_value?: number | null
          completed_at?: string | null
          condition_flags?: Json | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          delivered_at?: string | null
          graded_at?: string | null
          id?: string
          inbound_receipt_line_id?: string | null
          landed_cost?: number | null
          line_item_id?: string | null
          listed_at?: string | null
          location_id?: string | null
          mpn: string
          notes?: string | null
          order_id?: string | null
          payout_id?: string | null
          reservation_id?: string | null
          serial_or_internal_mark?: string | null
          shipped_at?: string | null
          sku_id: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id?: string | null
          uid?: string | null
          updated_at?: string
          v2_status?: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        Update: {
          accumulated_impairment?: number
          batch_id?: string | null
          carrying_value?: number | null
          completed_at?: string | null
          condition_flags?: Json | null
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          delivered_at?: string | null
          graded_at?: string | null
          id?: string
          inbound_receipt_line_id?: string | null
          landed_cost?: number | null
          line_item_id?: string | null
          listed_at?: string | null
          location_id?: string | null
          mpn?: string
          notes?: string | null
          order_id?: string | null
          payout_id?: string | null
          reservation_id?: string | null
          serial_or_internal_mark?: string | null
          shipped_at?: string | null
          sku_id?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id?: string | null
          uid?: string | null
          updated_at?: string
          v2_status?: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "fk_stock_unit_payout"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "purchase_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_inbound_receipt_line_id_fkey"
            columns: ["inbound_receipt_line_id"]
            isOneToOne: false
            referencedRelation: "inbound_receipt_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tax_code: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          purchase_tax_rate_id: string | null
          qbo_tax_code_id: string
          sales_tax_rate_id: string | null
          synced_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          purchase_tax_rate_id?: string | null
          qbo_tax_code_id: string
          sales_tax_rate_id?: string | null
          synced_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          purchase_tax_rate_id?: string | null
          qbo_tax_code_id?: string
          sales_tax_rate_id?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_code_purchase_tax_rate_id_fkey"
            columns: ["purchase_tax_rate_id"]
            isOneToOne: false
            referencedRelation: "vat_rate"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_code_sales_tax_rate_id_fkey"
            columns: ["sales_tax_rate_id"]
            isOneToOne: false
            referencedRelation: "vat_rate"
            referencedColumns: ["id"]
          },
        ]
      }
      theme: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_theme_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_theme_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_theme_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_parent_theme_id_fkey"
            columns: ["parent_theme_id"]
            isOneToOne: false
            referencedRelation: "theme"
            referencedColumns: ["id"]
          },
        ]
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
      vat_rate: {
        Row: {
          active: boolean
          agency_ref: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          qbo_tax_rate_id: string
          rate_percent: number
          synced_at: string
        }
        Insert: {
          active?: boolean
          agency_ref?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          qbo_tax_rate_id: string
          rate_percent: number
          synced_at?: string
        }
        Update: {
          active?: boolean
          agency_ref?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          qbo_tax_rate_id?: string
          rate_percent?: number
          synced_at?: string
        }
        Relationships: []
      }
      vat_semantics_audit: {
        Row: {
          classification: string
          created_at: string
          id: string
          original_header: Json
          original_lines: Json
          qbo_snapshot: Json | null
          reason: string
          repair_status: string
          repaired_at: string | null
          sales_order_id: string
          updated_at: string
        }
        Insert: {
          classification: string
          created_at?: string
          id?: string
          original_header?: Json
          original_lines?: Json
          qbo_snapshot?: Json | null
          reason: string
          repair_status?: string
          repaired_at?: string | null
          sales_order_id: string
          updated_at?: string
        }
        Update: {
          classification?: string
          created_at?: string
          id?: string
          original_header?: Json
          original_lines?: Json
          qbo_snapshot?: Json | null
          reason?: string
          repair_status?: string
          repaired_at?: string | null
          sales_order_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "vat_semantics_audit_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: true
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
        ]
      }
      vendor: {
        Row: {
          company_name: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          normalized_name: string | null
          qbo_vendor_id: string | null
          updated_at: string
          vendor_type: Database["public"]["Enums"]["vendor_type"]
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          normalized_name?: string | null
          qbo_vendor_id?: string | null
          updated_at?: string
          vendor_type?: Database["public"]["Enums"]["vendor_type"]
        }
        Update: {
          company_name?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          normalized_name?: string | null
          qbo_vendor_id?: string | null
          updated_at?: string
          vendor_type?: Database["public"]["Enums"]["vendor_type"]
        }
        Relationships: []
      }
      wishlist: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wishlist_item: {
        Row: {
          catalog_product_id: string
          created_at: string
          id: string
          max_price: number | null
          notes: string | null
          notify_on_stock: boolean
          preferred_grade: Database["public"]["Enums"]["condition_grade"] | null
          wishlist_id: string
        }
        Insert: {
          catalog_product_id: string
          created_at?: string
          id?: string
          max_price?: number | null
          notes?: string | null
          notify_on_stock?: boolean
          preferred_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          wishlist_id: string
        }
        Update: {
          catalog_product_id?: string
          created_at?: string
          id?: string
          max_price?: number | null
          notes?: string | null
          notify_on_stock?: boolean
          preferred_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_item_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "lego_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_item_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlist"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      club_public: {
        Row: {
          active: boolean | null
          city: string | null
          id: string | null
          location_description: string | null
          name: string | null
          postcode: string | null
          slug: string | null
        }
        Insert: {
          active?: boolean | null
          city?: string | null
          id?: string | null
          location_description?: string | null
          name?: string | null
          postcode?: string | null
          slug?: string | null
        }
        Update: {
          active?: boolean | null
          city?: string | null
          id?: string | null
          location_description?: string | null
          name?: string | null
          postcode?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      lego_set_minifigs: {
        Row: {
          bricklink_id: string | null
          fig_num: string | null
          inventory_version: number | null
          minifig_img_url: string | null
          minifig_name: string | null
          minifig_num_parts: number | null
          quantity: number | null
          set_num: string | null
          source: string | null
        }
        Relationships: []
      }
      set_minifigs: {
        Row: {
          bricklink_id: string | null
          fig_img_url: string | null
          fig_name: string | null
          fig_num: string | null
          fig_num_parts: number | null
          inventory_version: number | null
          quantity: number | null
          set_num: string | null
        }
        Relationships: []
      }
      sku_public: {
        Row: {
          active_flag: boolean | null
          condition_grade: Database["public"]["Enums"]["condition_grade"] | null
          condition_notes: string | null
          created_at: string | null
          id: string | null
          market_price: number | null
          mpn: string | null
          name: string | null
          price: number | null
          product_id: string | null
          sale_price: number | null
          saleable_flag: boolean | null
          sku_code: string | null
          updated_at: string | null
        }
        Insert: {
          active_flag?: boolean | null
          condition_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          condition_notes?: string | null
          created_at?: string | null
          id?: string | null
          market_price?: number | null
          mpn?: string | null
          name?: string | null
          price?: number | null
          product_id?: string | null
          sale_price?: number | null
          saleable_flag?: boolean | null
          sku_code?: string | null
          updated_at?: string | null
        }
        Update: {
          active_flag?: boolean | null
          condition_grade?:
            | Database["public"]["Enums"]["condition_grade"]
            | null
          condition_notes?: string | null
          created_at?: string | null
          id?: string | null
          market_price?: number | null
          mpn?: string | null
          name?: string | null
          price?: number | null
          product_id?: string | null
          sale_price?: number | null
          saleable_flag?: boolean | null
          sku_code?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sku_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_profit_view: {
        Row: {
          advertising_fee: number | null
          batch_id: string | null
          gross_revenue: number | null
          landed_cost: number | null
          net_landed_cost: number | null
          net_margin_pct: number | null
          net_profit: number | null
          net_revenue: number | null
          net_total_fees: number | null
          payout_id: string | null
          processing_fee: number | null
          sales_order_id: string | null
          selling_fee: number | null
          shipping_fee: number | null
          sku: string | null
          stock_unit_id: string | null
          total_fees_per_unit: number | null
          uid: string | null
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_unit_payout"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_unit_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "purchase_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      v_blue_bell_accrual_ledger: {
        Row: {
          accrual_id: string | null
          app_reference: string | null
          basis_amount: number | null
          commission_amount: number | null
          commission_outstanding: number | null
          created_at: string | null
          discount_amount: number | null
          ebay_reference: string | null
          external_reference: string | null
          order_created_at: string | null
          order_number: string | null
          origin_channel: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_expense_id: string | null
          qbo_payment_reference: string | null
          reversed_amount: number | null
          sales_order_id: string | null
          settlement_id: string | null
          settlement_status: string | null
          status: string | null
          stripe_reference: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_accrual_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "sales_program_settlement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_blue_bell_monthly_statement_export: {
        Row: {
          accrual_id: string | null
          app_reference: string | null
          basis_amount: number | null
          commission_amount: number | null
          commission_outstanding: number | null
          created_at: string | null
          discount_amount: number | null
          ebay_reference: string | null
          external_reference: string | null
          order_created_at: string | null
          order_number: string | null
          origin_channel: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_expense_id: string | null
          qbo_payment_reference: string | null
          reversed_amount: number | null
          sales_order_id: string | null
          settlement_id: string | null
          settlement_status: string | null
          status: string | null
          stripe_reference: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_accrual_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "sales_program_settlement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_blue_bell_statement: {
        Row: {
          basis_amount: number | null
          commission_accrued: number | null
          commission_outstanding: number | null
          commission_reversed: number | null
          commission_settled: number | null
          discount_amount: number | null
          period_end: string | null
          period_start: string | null
          qualifying_order_count: number | null
        }
        Relationships: []
      }
      v_blue_bell_statement_export: {
        Row: {
          accrual_id: string | null
          app_reference: string | null
          basis_amount: number | null
          commission_amount: number | null
          commission_outstanding: number | null
          created_at: string | null
          discount_amount: number | null
          ebay_reference: string | null
          external_reference: string | null
          order_created_at: string | null
          order_number: string | null
          origin_channel: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_expense_id: string | null
          qbo_payment_reference: string | null
          reversed_amount: number | null
          sales_order_id: string | null
          settlement_id: string | null
          settlement_status: string | null
          status: string | null
          stripe_reference: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_program_accrual_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "sales_program_settlement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_current_sku_pricing: {
        Row: {
          avg_cost: number | null
          blocking_reasons: Json | null
          ceiling_price: number | null
          channel: string | null
          condition_grade: Database["public"]["Enums"]["condition_grade"] | null
          confidence_score: number | null
          cost_range: string | null
          current_price: number | null
          expected_margin_amount: number | null
          expected_margin_rate: number | null
          floor_price: number | null
          market_price: number | null
          mpn: string | null
          override_required: boolean | null
          priced_at: string | null
          recommendation: string | null
          sku_code: string | null
          sku_id: string | null
          target_price: number | null
        }
        Relationships: []
      }
      v_entity_reference_columns: {
        Row: {
          app_reference: string | null
          created_at: string | null
          ebay_reference: string | null
          entity_id: string | null
          entity_reference: string | null
          entity_type: string | null
          external_reference: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          stripe_reference: string | null
          uuid_reference: string | null
        }
        Relationships: []
      }
      v_margin_profit_report: {
        Row: {
          app_reference: string | null
          batch_id: string | null
          ebay_reference: string | null
          external_reference: string | null
          fee_pct: number | null
          gross_margin_pct: number | null
          gross_revenue: number | null
          landed_cost: number | null
          mpn: string | null
          net_margin_pct: number | null
          net_profit: number | null
          order_date: string | null
          order_number: string | null
          origin_channel: string | null
          payout_id: string | null
          product_name: string | null
          program_commission_amount: number | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          sku: string | null
          stock_unit_id: string | null
          stripe_reference: string | null
          total_fee_amount: number | null
          uid: string | null
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_unit_payout"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_unit_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "purchase_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      v_order_line_economics: {
        Row: {
          cogs_amount: number | null
          cogs_source_unit_id: string | null
          costing_method: string | null
          economics_status: string | null
          fee_snapshot: Json | null
          gross_margin_amount: number | null
          line_discount: number | null
          line_total: number | null
          net_margin_amount: number | null
          net_margin_rate: number | null
          order_created_at: string | null
          order_number: string | null
          origin_channel: string | null
          program_commission_amount: number | null
          program_discount_amount: number | null
          quantity: number | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          sku_id: string | null
          stock_unit_id: string | null
          total_fee_amount: number | null
          unit_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_cogs_source_unit_id_fkey"
            columns: ["cogs_source_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "unit_profit_view"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["stock_unit_id"]
          },
          {
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["stock_unit_id"]
          },
        ]
      }
      v_outbound_command_with_references: {
        Row: {
          app_reference: string | null
          channel: string | null
          command_type: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          external_listing_id: string | null
          id: string | null
          last_error: string | null
          mpn: string | null
          next_attempt_at: string | null
          payload: Json | null
          retry_count: number | null
          sent_at: string | null
          sku_code: string | null
          status: string | null
          target_system: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_posting_intent_with_references: {
        Row: {
          action: string | null
          app_reference: string | null
          created_at: string | null
          ebay_reference: string | null
          entity_id: string | null
          entity_type: string | null
          external_reference: string | null
          id: string | null
          last_error: string | null
          next_attempt_at: string | null
          payload: Json | null
          posted_at: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_reference_id: string | null
          retry_count: number | null
          status: string | null
          stripe_reference: string | null
          target_system: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_qbo_refresh_drift: {
        Row: {
          app_reference: string | null
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          current_values: Json | null
          drift_type: string | null
          id: string | null
          local_entity_id: string | null
          local_entity_type: string | null
          local_reference: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          qbo_entity_type: string | null
          qbo_refresh_run_id: string | null
          qbo_values: Json | null
          recommended_action: string | null
          refresh_completed_at: string | null
          refresh_mode: string | null
          refresh_started_at: string | null
          refresh_status: string | null
          severity: string | null
          status: string | null
          target_route: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_refresh_drift_qbo_refresh_run_id_fkey"
            columns: ["qbo_refresh_run_id"]
            isOneToOne: false
            referencedRelation: "qbo_refresh_run"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reconciliation_case_export: {
        Row: {
          amount_actual: number | null
          amount_expected: number | null
          app_reference: string | null
          case_type: string | null
          close_code: string | null
          closed_at: string | null
          created_at: string | null
          diagnosis: string | null
          ebay_reference: string | null
          evidence_json: string | null
          external_payout_id: string | null
          external_reference: string | null
          id: string | null
          latest_note: string | null
          latest_note_at: string | null
          next_step: string | null
          note_count: number | null
          order_number: string | null
          origin_channel: string | null
          payout_channel: string | null
          payout_id: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          recommended_action: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          requires_evidence: boolean | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          severity: string | null
          sku_code: string | null
          status: string | null
          stripe_reference: string | null
          suspected_root_cause: string | null
          target_label: string | null
          target_route: string | null
          updated_at: string | null
          variance_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_case_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
        ]
      }
      v_reconciliation_case_note: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string | null
          evidence: Json | null
          id: string | null
          note: string | null
          note_type: string | null
          reconciliation_case_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_case_note_reconciliation_case_id_fkey"
            columns: ["reconciliation_case_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_case"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_note_reconciliation_case_id_fkey"
            columns: ["reconciliation_case_id"]
            isOneToOne: false
            referencedRelation: "v_reconciliation_case_export"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_note_reconciliation_case_id_fkey"
            columns: ["reconciliation_case_id"]
            isOneToOne: false
            referencedRelation: "v_reconciliation_inbox"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reconciliation_case_owner: {
        Row: {
          display_name: string | null
          roles: Database["public"]["Enums"]["app_role"][] | null
          user_id: string | null
        }
        Relationships: []
      }
      v_reconciliation_inbox: {
        Row: {
          amount_actual: number | null
          amount_expected: number | null
          app_reference: string | null
          case_type: string | null
          created_at: string | null
          diagnosis: string | null
          due_at: string | null
          ebay_reference: string | null
          evidence: Json | null
          external_payout_id: string | null
          external_reference: string | null
          id: string | null
          latest_note: string | null
          latest_note_at: string | null
          next_step: string | null
          note_count: number | null
          order_number: string | null
          origin_channel: string | null
          owner_id: string | null
          owner_name: string | null
          payout_channel: string | null
          payout_id: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          recommended_action: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          requires_evidence: boolean | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          severity: string | null
          sku_code: string | null
          sku_id: string | null
          sla_status: string | null
          status: string | null
          stripe_reference: string | null
          suspected_root_cause: string | null
          target_label: string | null
          target_route: string | null
          updated_at: string | null
          variance_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_case_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_margin_profit_report"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_economics"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "reconciliation_case_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "v_unit_profit_v2"
            referencedColumns: ["sales_order_line_id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "v_current_sku_pricing"
            referencedColumns: ["sku_id"]
          },
        ]
      }
      v_rolling_settlement_export: {
        Row: {
          actual_total: number | null
          amount_mismatch_case_count: number | null
          app_reference: string | null
          ebay_reference: string | null
          expected_total: number | null
          external_reference: string | null
          latest_actual_at: string | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_created_at: string | null
          order_number: string | null
          order_status: string | null
          origin_channel: string | null
          payment_method: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          sales_order_id: string | null
          settlement_status: string | null
          stripe_reference: string | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v_rolling_settlement_monitor: {
        Row: {
          actual_total: number | null
          amount_mismatch_case_count: number | null
          app_reference: string | null
          ebay_reference: string | null
          expected_total: number | null
          external_reference: string | null
          latest_actual_at: string | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_created_at: string | null
          order_number: string | null
          order_status: string | null
          origin_channel: string | null
          payment_method: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          sales_order_id: string | null
          settlement_status: string | null
          stripe_reference: string | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v_settlement_close_export: {
        Row: {
          actual_total: number | null
          amount_mismatch_case_count: number | null
          app_reference: string | null
          ebay_reference: string | null
          expected_total: number | null
          external_reference: string | null
          latest_actual_at: string | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_created_at: string | null
          order_number: string | null
          order_status: string | null
          origin_channel: string | null
          payment_method: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          sales_order_id: string | null
          settlement_status: string | null
          stripe_reference: string | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v_settlement_order_rollup: {
        Row: {
          actual_fees: number | null
          actual_gross: number | null
          actual_net_lines: number | null
          actual_refunds: number | null
          actual_shipping: number | null
          actual_total: number | null
          amount_mismatch_case_count: number | null
          expected_commission: number | null
          expected_discount: number | null
          expected_fees: number | null
          expected_gross: number | null
          expected_shipping: number | null
          expected_tax: number | null
          expected_total: number | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_date: string | null
          order_number: string | null
          origin_channel: string | null
          period_end: string | null
          period_start: string | null
          sales_order_id: string | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v_settlement_period_close: {
        Row: {
          actual_total: number | null
          amount_mismatch_case_count: number | null
          channel_count: number | null
          close_status: string | null
          expected_total: number | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_count: number | null
          payout_count: number | null
          period_end: string | null
          period_start: string | null
          unreconciled_payout_count: number | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v_settlement_period_summary: {
        Row: {
          actual_fees: number | null
          actual_gross: number | null
          actual_refunds: number | null
          actual_shipping: number | null
          actual_total: number | null
          amount_mismatch_case_count: number | null
          channel: string | null
          expected_commission: number | null
          expected_discount: number | null
          expected_fees: number | null
          expected_gross: number | null
          expected_shipping: number | null
          expected_tax: number | null
          expected_total: number | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_count: number | null
          payout_count: number | null
          payout_fees: number | null
          payout_gross: number | null
          payout_net: number | null
          period_end: string | null
          period_start: string | null
          unreconciled_payout_count: number | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v_subledger_job_run: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          error: string | null
          id: string | null
          job: string | null
          job_success: boolean | null
          occurred_at: string | null
          requested_job: string | null
          response: Json | null
          rows_processed: number | null
          run_success: boolean | null
        }
        Relationships: []
      }
      v_subledger_operations_health: {
        Row: {
          area: string | null
          failed_count: number | null
          health_status: string | null
          last_failure_at: string | null
          last_success_at: string | null
          oldest_pending_at: string | null
          open_count: number | null
          overdue_count: number | null
          pending_count: number | null
          recommendation: string | null
          severity: string | null
        }
        Relationships: []
      }
      v_unit_profit_v2: {
        Row: {
          batch_id: string | null
          fee_pct: number | null
          gross_margin_pct: number | null
          gross_revenue: number | null
          landed_cost: number | null
          net_margin_pct: number | null
          net_profit: number | null
          payout_id: string | null
          program_commission_amount: number | null
          sales_order_id: string | null
          sales_order_line_id: string | null
          sku: string | null
          stock_unit_id: string | null
          total_fee_amount: number | null
          uid: string | null
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_unit_payout"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_accrual_ledger"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_monthly_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_blue_bell_statement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_rolling_settlement_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_close_export"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_order_rollup"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "v_withheld_payout_monitor"
            referencedColumns: ["sales_order_id"]
          },
          {
            foreignKeyName: "stock_unit_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "purchase_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      v_withheld_payout_monitor: {
        Row: {
          actual_total: number | null
          amount_mismatch_case_count: number | null
          app_reference: string | null
          ebay_reference: string | null
          expected_total: number | null
          external_reference: string | null
          latest_actual_at: string | null
          missing_payout_case_count: number | null
          open_case_count: number | null
          order_created_at: string | null
          order_number: string | null
          order_status: string | null
          origin_channel: string | null
          payment_method: string | null
          qbo_doc_number: string | null
          qbo_entity_id: string | null
          sales_order_id: string | null
          settlement_status: string | null
          stripe_reference: string | null
          variance_amount: number | null
        }
        Relationships: []
      }
      v2_variant_stock_summary: {
        Row: {
          avg_cost: number | null
          condition_grade: Database["public"]["Enums"]["condition_grade"] | null
          floor_price: number | null
          market_price: number | null
          mpn: string | null
          qty_on_hand: number | null
          sale_price: number | null
          sku_code: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_list_users: {
        Args: never
        Returns: {
          avatar_url: string
          display_name: string
          email: string
          roles: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }[]
      }
      admin_list_users_detailed: {
        Args: never
        Returns: {
          avatar_url: string
          company_name: string
          display_name: string
          ebay_username: string
          email: string
          facebook_handle: string
          first_name: string
          instagram_handle: string
          last_name: string
          mobile: string
          order_count: number
          phone: string
          roles: string[]
          total_order_value: number
          user_id: string
        }[]
      }
      admin_set_user_role: {
        Args: {
          assign: boolean
          target_role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Returns: undefined
      }
      allocate_order_line_stock_unit: {
        Args: { p_line_item_id: string; p_order_id: string; p_sku_code: string }
        Returns: {
          accumulated_impairment: number
          batch_id: string | null
          carrying_value: number | null
          completed_at: string | null
          condition_flags: Json | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          delivered_at: string | null
          graded_at: string | null
          id: string
          inbound_receipt_line_id: string | null
          landed_cost: number | null
          line_item_id: string | null
          listed_at: string | null
          location_id: string | null
          mpn: string
          notes: string | null
          order_id: string | null
          payout_id: string | null
          reservation_id: string | null
          serial_or_internal_mark: string | null
          shipped_at: string | null
          sku_id: string
          sold_at: string | null
          status: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id: string | null
          uid: string | null
          updated_at: string
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_unit"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      allocate_order_line_stock_unit_by_uid: {
        Args: { p_line_item_id: string; p_order_id: string; p_unit_uid: string }
        Returns: {
          accumulated_impairment: number
          batch_id: string | null
          carrying_value: number | null
          completed_at: string | null
          condition_flags: Json | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          delivered_at: string | null
          graded_at: string | null
          id: string
          inbound_receipt_line_id: string | null
          landed_cost: number | null
          line_item_id: string | null
          listed_at: string | null
          location_id: string | null
          mpn: string
          notes: string | null
          order_id: string | null
          payout_id: string | null
          reservation_id: string | null
          serial_or_internal_mark: string | null
          shipped_at: string | null
          sku_id: string
          sold_at: string | null
          status: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id: string | null
          uid: string | null
          updated_at: string
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_unit"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      allocate_stock_for_order_line: {
        Args: {
          p_actor_id?: string
          p_requested_stock_unit_id?: string
          p_sales_order_line_id: string
        }
        Returns: Json
      }
      allocate_stock_units: {
        Args: { p_order_id?: string; p_quantity: number; p_sku_id: string }
        Returns: string[]
      }
      apply_approved_qbo_refresh_drift: {
        Args: { p_actor_id?: string; p_run_id?: string }
        Returns: number
      }
      approve_qbo_refresh_drift: {
        Args: { p_actor_id?: string; p_drift_id: string }
        Returns: Json
      }
      browse_catalog: {
        Args: {
          filter_grade?: string
          filter_retired?: boolean
          filter_theme_id?: string
          search_term?: string
        }
        Returns: {
          best_grade: string
          img_url: string
          min_price: number
          mpn: string
          name: string
          piece_count: number
          product_id: string
          release_year: number
          retired_flag: boolean
          theme_id: string
          theme_name: string
          total_stock: number
        }[]
      }
      bulk_set_ebay_category: {
        Args: {
          p_category_id: string
          p_marketplace?: string
          p_product_ids: string[]
        }
        Returns: number
      }
      bulk_update_reconciliation_case_workflow: {
        Args: {
          p_case_ids: string[]
          p_clear_due_at?: boolean
          p_clear_owner?: boolean
          p_due_at?: string
          p_evidence?: Json
          p_note?: string
          p_owner_id?: string
          p_status?: string
        }
        Returns: Json
      }
      cancel_listing_outbound_command: {
        Args: { p_outbound_command_id: string }
        Returns: string
      }
      cancel_qbo_posting_intent: {
        Args: { p_posting_intent_id: string }
        Returns: string
      }
      catalog_filter_options: {
        Args: {
          filter_subtheme?: string
          filter_theme?: string
          filter_year?: number
          search_term?: string
        }
        Returns: {
          subthemes: string[]
          themes: string[]
          years: number[]
        }[]
      }
      commerce_quote_price: {
        Args: {
          p_candidate_price?: number
          p_channel?: string
          p_sales_program_code?: string
          p_sku_id: string
        }
        Returns: Json
      }
      create_price_decision_snapshot: {
        Args: {
          p_actor_id?: string
          p_candidate_price?: number
          p_channel?: string
          p_channel_listing_id?: string
          p_sales_program_code?: string
          p_sku_id: string
        }
        Returns: string
      }
      create_sales_program_settlement: {
        Args: {
          p_actor_id?: string
          p_notes?: string
          p_period_end: string
          p_period_start: string
          p_program_code: string
        }
        Returns: string
      }
      csv_sync_apply_changeset: {
        Args: { p_session_id: string }
        Returns: Json
      }
      csv_sync_rollback_session: {
        Args: { p_session_id: string }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_product_column: {
        Args: { p_column_name: string; p_data_type: string }
        Returns: Json
      }
      ensure_product_exists:
        | { Args: { p_mpn: string; p_name?: string }; Returns: string }
        | {
            Args: {
              p_brand?: string
              p_img_url?: string
              p_item_type?: string
              p_mpn: string
              p_name?: string
              p_piece_count?: number
              p_release_year?: number
              p_retired?: boolean
              p_subtheme?: string
              p_theme_id?: string
            }
            Returns: string
          }
      ensure_vendor: {
        Args: {
          p_display_name: string
          p_vendor_type?: Database["public"]["Enums"]["vendor_type"]
        }
        Returns: string
      }
      get_ebay_category_schema: {
        Args: { p_category_id: string; p_marketplace: string }
        Returns: {
          allowed_values: Json
          allows_custom: boolean
          aspect_key: string
          cardinality: string
          data_type: string
          label: string
          required: boolean
          sort_order: number
        }[]
      }
      get_my_order_lines: {
        Args: { p_order_id: string }
        Returns: {
          id: string
          line_total: number
          quantity: number
          sales_order_id: string
          sku_id: string
          unit_price: number
        }[]
      }
      get_or_create_rebrickable_inventory: {
        Args: { p_set_num: string; p_version?: number }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      infer_vendor_type: {
        Args: { p_name: string }
        Returns: Database["public"]["Enums"]["vendor_type"]
      }
      invoke_subledger_scheduled_job: {
        Args: { p_body?: Json; p_job: string }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_vendor_name: { Args: { p_name: string }; Returns: string }
      parse_sku_code: {
        Args: { p_sku_code: string }
        Returns: {
          condition_grade: string
          mpn: string
        }[]
      }
      process_order_return: {
        Args: {
          p_actor_id?: string
          p_line_actions: Json
          p_reason?: string
          p_sales_order_id: string
        }
        Returns: Json
      }
      product_detail_offers: {
        Args: { p_mpn: string }
        Returns: {
          condition_grade: string
          price: number
          sku_code: string
          sku_id: string
          stock_count: number
        }[]
      }
      queue_listing_command: {
        Args: {
          p_actor_id?: string
          p_allow_below_floor?: boolean
          p_channel_listing_id: string
          p_command_type: string
        }
        Returns: string
      }
      queue_qbo_customer_posting_intent: {
        Args: { p_customer_id?: string; p_payload?: Json }
        Returns: string
      }
      queue_qbo_item_posting_intent: {
        Args: {
          p_old_sku_code?: string
          p_purchase_cost?: number
          p_sku_id: string
          p_supplier_vat_registered?: boolean
        }
        Returns: string
      }
      queue_qbo_payout_posting_intent: {
        Args: { p_payout_id: string }
        Returns: string
      }
      queue_qbo_posting_intents_for_order: {
        Args: { p_sales_order_id: string }
        Returns: number
      }
      queue_qbo_purchase_posting_intent: {
        Args: { p_action?: string; p_batch_id: string }
        Returns: string
      }
      queue_qbo_refund_posting_intent_for_order: {
        Args: { p_refunded_line_ids?: string[]; p_sales_order_id: string }
        Returns: string
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      rebuild_listing_command_reconciliation_cases: {
        Args: never
        Returns: number
      }
      rebuild_qbo_refresh_drift: { Args: { p_run_id: string }; Returns: number }
      rebuild_reconciliation_cases: {
        Args: { p_sales_order_id?: string }
        Returns: number
      }
      reconciliation_case_requires_evidence: {
        Args: { p_case_type: string }
        Returns: boolean
      }
      record_order_accounting_events: {
        Args: { p_sales_order_id: string; p_source?: string }
        Returns: number
      }
      record_price_override_approval: {
        Args: {
          p_approved_by?: string
          p_price_decision_snapshot_id: string
          p_reason_code: string
          p_reason_note?: string
        }
        Returns: string
      }
      record_sales_program_accrual: {
        Args: {
          p_actor_id?: string
          p_attribution_source?: string
          p_basis_amount?: number
          p_commission_amount?: number
          p_discount_amount?: number
          p_program_code?: string
          p_sales_order_id: string
        }
        Returns: string
      }
      refresh_actual_settlement_lines: {
        Args: {
          p_payout_id?: string
          p_rebuild_cases?: boolean
          p_sales_order_id?: string
        }
        Returns: number
      }
      refresh_market_price_snapshots: {
        Args: { p_sku_id?: string }
        Returns: number
      }
      refresh_order_line_economics: {
        Args: { p_sales_order_id: string }
        Returns: number
      }
      refresh_order_settlement_lines: {
        Args: { p_rebuild_cases?: boolean; p_sales_order_id: string }
        Returns: number
      }
      refresh_sku_cost_rollups: { Args: { p_sku_id?: string }; Returns: number }
      release_stock_allocation_for_order_line: {
        Args: { p_reason?: string; p_sales_order_line_id: string }
        Returns: Json
      }
      resolve_reconciliation_case: {
        Args: { p_case_id: string; p_note?: string; p_resolution: string }
        Returns: Json
      }
      retry_listing_outbound_command: {
        Args: { p_outbound_command_id: string }
        Returns: string
      }
      retry_qbo_posting_intent: {
        Args: { p_posting_intent_id: string }
        Returns: string
      }
      search_catalog_for_wishlist: {
        Args: {
          filter_subtheme?: string
          filter_theme?: string
          filter_year?: number
          search_term?: string
        }
        Returns: {
          img_url: string
          mpn: string
          name: string
          product_id: string
          release_year: number
          subtheme_name: string
          theme_name: string
        }[]
      }
      settle_sales_program_accruals: {
        Args: {
          p_accrual_ids: string[]
          p_actor_id?: string
          p_notes?: string
          p_program_code: string
        }
        Returns: string
      }
      subledger_staff_read_policy: { Args: never; Returns: boolean }
      update_reconciliation_case_workflow: {
        Args: {
          p_case_id: string
          p_clear_due_at?: boolean
          p_clear_owner?: boolean
          p_due_at?: string
          p_evidence?: Json
          p_note?: string
          p_owner_id?: string
          p_status?: string
        }
        Returns: Json
      }
      v2_calculate_apportioned_costs: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      v2_compute_vat: {
        Args: { gross: number }
        Returns: {
          net: number
          vat: number
        }[]
      }
      v2_consume_fifo_unit: {
        Args: { p_sku_code: string }
        Returns: {
          accumulated_impairment: number
          batch_id: string | null
          carrying_value: number | null
          completed_at: string | null
          condition_flags: Json | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          delivered_at: string | null
          graded_at: string | null
          id: string
          inbound_receipt_line_id: string | null
          landed_cost: number | null
          line_item_id: string | null
          listed_at: string | null
          location_id: string | null
          mpn: string
          notes: string | null
          order_id: string | null
          payout_id: string | null
          reservation_id: string | null
          serial_or_internal_mark: string | null
          shipped_at: string | null
          sku_id: string
          sold_at: string | null
          status: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id: string | null
          uid: string | null
          updated_at: string
          v2_status: Database["public"]["Enums"]["v2_unit_status"] | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_unit"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      v2_create_purchase_batch: { Args: { p_input: Json }; Returns: Json }
      v2_detect_orphan_purchase_batches: { Args: never; Returns: number }
      v2_link_unmatched_payout_fees: { Args: never; Returns: number }
      v2_reallocate_costs_by_grade: {
        Args: { p_line_item_id: string }
        Returns: undefined
      }
      v2_recalculate_variant_stats: {
        Args: { p_sku_code: string }
        Returns: undefined
      }
      v2_reserve_stock_unit_uids: {
        Args: { p_batch_id: string; p_count: number }
        Returns: string[]
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "member"
      condition_grade: "1" | "2" | "3" | "4" | "5"
      landing_status: "pending" | "staged" | "committed" | "error" | "skipped"
      listing_status:
        | "draft"
        | "price_pending"
        | "media_pending"
        | "copy_pending"
        | "approval_pending"
        | "publish_queued"
        | "live"
        | "paused"
        | "suppressed"
        | "ended"
        | "archived"
      order_status:
        | "pending_payment"
        | "authorised"
        | "paid"
        | "picking"
        | "packed"
        | "awaiting_dispatch"
        | "shipped"
        | "complete"
        | "cancelled"
        | "partially_refunded"
        | "refunded"
        | "exception"
      payout_channel: "ebay" | "stripe"
      purchase_batch_status: "draft" | "recorded"
      receipt_status: "pending" | "processed" | "error"
      stock_unit_status:
        | "pending_receipt"
        | "received"
        | "awaiting_grade"
        | "graded"
        | "available"
        | "reserved"
        | "allocated"
        | "picked"
        | "packed"
        | "shipped"
        | "delivered"
        | "returned"
        | "awaiting_disposition"
        | "scrap"
        | "part_out"
        | "written_off"
        | "closed"
      v2_channel: "ebay" | "website" | "bricklink" | "brickowl" | "in_person"
      v2_channel_listing_status: "draft" | "live" | "paused" | "ended"
      v2_order_status:
        | "needs_allocation"
        | "new"
        | "awaiting_shipment"
        | "shipped"
        | "delivered"
        | "complete"
        | "return_pending"
        | "refunded"
        | "cancelled"
      v2_unit_status:
        | "purchased"
        | "graded"
        | "listed"
        | "sold"
        | "shipped"
        | "delivered"
        | "payout_received"
        | "complete"
        | "return_pending"
        | "refunded"
        | "restocked"
        | "needs_allocation"
      vendor_type: "supplier" | "marketplace" | "payment_processor" | "other"
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
      app_role: ["admin", "staff", "member"],
      condition_grade: ["1", "2", "3", "4", "5"],
      landing_status: ["pending", "staged", "committed", "error", "skipped"],
      listing_status: [
        "draft",
        "price_pending",
        "media_pending",
        "copy_pending",
        "approval_pending",
        "publish_queued",
        "live",
        "paused",
        "suppressed",
        "ended",
        "archived",
      ],
      order_status: [
        "pending_payment",
        "authorised",
        "paid",
        "picking",
        "packed",
        "awaiting_dispatch",
        "shipped",
        "complete",
        "cancelled",
        "partially_refunded",
        "refunded",
        "exception",
      ],
      payout_channel: ["ebay", "stripe"],
      purchase_batch_status: ["draft", "recorded"],
      receipt_status: ["pending", "processed", "error"],
      stock_unit_status: [
        "pending_receipt",
        "received",
        "awaiting_grade",
        "graded",
        "available",
        "reserved",
        "allocated",
        "picked",
        "packed",
        "shipped",
        "delivered",
        "returned",
        "awaiting_disposition",
        "scrap",
        "part_out",
        "written_off",
        "closed",
      ],
      v2_channel: ["ebay", "website", "bricklink", "brickowl", "in_person"],
      v2_channel_listing_status: ["draft", "live", "paused", "ended"],
      v2_order_status: [
        "needs_allocation",
        "new",
        "awaiting_shipment",
        "shipped",
        "delivered",
        "complete",
        "return_pending",
        "refunded",
        "cancelled",
      ],
      v2_unit_status: [
        "purchased",
        "graded",
        "listed",
        "sold",
        "shipped",
        "delivered",
        "payout_received",
        "complete",
        "return_pending",
        "refunded",
        "restocked",
        "needs_allocation",
      ],
      vendor_type: ["supplier", "marketplace", "payment_processor", "other"],
    },
  },
} as const
