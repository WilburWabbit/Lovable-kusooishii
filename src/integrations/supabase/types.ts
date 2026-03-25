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
      app_settings: {
        Row: {
          id: string
          stripe_test_mode: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          stripe_test_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
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
          created_at: string
          display_name: string
          email: string | null
          id: string
          mobile: string | null
          notes: string | null
          phone: string | null
          qbo_customer_id: string
          synced_at: string
          updated_at: string
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
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          qbo_customer_id: string
          synced_at?: string
          updated_at?: string
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
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          phone?: string | null
          qbo_customer_id?: string
          synced_at?: string
          updated_at?: string
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
      landing_raw_qbo_item: {
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
      landing_raw_qbo_purchase: {
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
      landing_raw_qbo_refund_receipt: {
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
      landing_raw_qbo_sales_receipt: {
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
        ]
      }
      payouts: {
        Row: {
          channel: Database["public"]["Enums"]["payout_channel"]
          created_at: string
          external_payout_id: string | null
          fee_breakdown: Json | null
          gross_amount: number
          id: string
          net_amount: number
          notes: string | null
          order_count: number
          payout_date: string
          qbo_deposit_id: string | null
          qbo_expense_id: string | null
          qbo_sync_status: string | null
          reconciliation_status: string | null
          total_fees: number
          unit_count: number
          updated_at: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["payout_channel"]
          created_at?: string
          external_payout_id?: string | null
          fee_breakdown?: Json | null
          gross_amount: number
          id?: string
          net_amount: number
          notes?: string | null
          order_count?: number
          payout_date: string
          qbo_deposit_id?: string | null
          qbo_expense_id?: string | null
          qbo_sync_status?: string | null
          reconciliation_status?: string | null
          total_fees?: number
          unit_count?: number
          updated_at?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["payout_channel"]
          created_at?: string
          external_payout_id?: string | null
          fee_breakdown?: Json | null
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          order_count?: number
          payout_date?: string
          qbo_deposit_id?: string | null
          qbo_expense_id?: string | null
          qbo_sync_status?: string | null
          reconciliation_status?: string | null
          total_fees?: number
          unit_count?: number
          updated_at?: string | null
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
          brand: string | null
          brickeconomy_id: string | null
          bricklink_item_no: string | null
          brickowl_boid: string | null
          call_to_action: string | null
          created_at: string
          description: string | null
          dimensions_cm: string | null
          ean: string | null
          field_overrides: Json | null
          height_cm: number | null
          highlights: string | null
          id: string
          img_url: string | null
          include_catalog_img: boolean
          lego_catalog_id: string | null
          length_cm: number | null
          minifigs_count: number | null
          mpn: string
          name: string | null
          piece_count: number | null
          product_hook: string | null
          product_type: string
          rebrickable_id: string | null
          release_year: number | null
          released_date: string | null
          retail_price: number | null
          retired_date: string | null
          retired_flag: boolean
          seo_description: string | null
          seo_title: string | null
          set_number: string | null
          status: string
          subtheme_name: string | null
          theme_id: string | null
          updated_at: string
          version_descriptor: string | null
          weight_g: number | null
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          age_mark?: string | null
          age_range?: string | null
          brand?: string | null
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          call_to_action?: string | null
          created_at?: string
          description?: string | null
          dimensions_cm?: string | null
          ean?: string | null
          field_overrides?: Json | null
          height_cm?: number | null
          highlights?: string | null
          id?: string
          img_url?: string | null
          include_catalog_img?: boolean
          lego_catalog_id?: string | null
          length_cm?: number | null
          minifigs_count?: number | null
          mpn: string
          name?: string | null
          piece_count?: number | null
          product_hook?: string | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          released_date?: string | null
          retail_price?: number | null
          retired_date?: string | null
          retired_flag?: boolean
          seo_description?: string | null
          seo_title?: string | null
          set_number?: string | null
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          updated_at?: string
          version_descriptor?: string | null
          weight_g?: number | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          age_mark?: string | null
          age_range?: string | null
          brand?: string | null
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          call_to_action?: string | null
          created_at?: string
          description?: string | null
          dimensions_cm?: string | null
          ean?: string | null
          field_overrides?: Json | null
          height_cm?: number | null
          highlights?: string | null
          id?: string
          img_url?: string | null
          include_catalog_img?: boolean
          lego_catalog_id?: string | null
          length_cm?: number | null
          minifigs_count?: number | null
          mpn?: string
          name?: string | null
          piece_count?: number | null
          product_hook?: string | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          released_date?: string | null
          retail_price?: number | null
          retired_date?: string | null
          retired_flag?: boolean
          seo_description?: string | null
          seo_title?: string | null
          set_number?: string | null
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          updated_at?: string
          version_descriptor?: string | null
          weight_g?: number | null
          weight_kg?: number | null
          width_cm?: number | null
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
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchase_batches: {
        Row: {
          created_at: string
          id: string
          purchase_date: string
          reference: string | null
          shared_costs: Json
          status: Database["public"]["Enums"]["purchase_batch_status"]
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
          reference?: string | null
          shared_costs?: Json
          status?: Database["public"]["Enums"]["purchase_batch_status"]
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
          reference?: string | null
          shared_costs?: Json
          status?: Database["public"]["Enums"]["purchase_batch_status"]
          supplier_name?: string
          supplier_vat_registered?: boolean
          total_shared_costs?: number
          unit_counter?: number
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          id: string
          line_discount: number
          line_total: number
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
          created_at?: string
          id?: string
          line_discount?: number
          line_total: number
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
          created_at?: string
          id?: string
          line_discount?: number
          line_total?: number
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
            foreignKeyName: "sales_order_line_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_order"
            referencedColumns: ["id"]
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
            foreignKeyName: "sales_order_line_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "stock_unit"
            referencedColumns: ["id"]
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
      shipping_rate_table: {
        Row: {
          active: boolean
          carrier: string
          channel: string
          cost: number
          created_at: string
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
      admin_set_user_role: {
        Args: {
          assign: boolean
          target_role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Returns: undefined
      }
      allocate_stock_units: {
        Args: {
          p_order_line_ids?: string[]
          p_quantity: number
          p_sku_id: string
        }
        Returns: string[]
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
      ensure_product_exists:
        | {
            Args: {
              p_brand?: string
              p_item_type?: string
              p_mpn: string
              p_name?: string
            }
            Returns: string
          }
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
        | {
            Args: {
              p_img_url?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      parse_sku_code: {
        Args: { p_sku_code: string }
        Returns: {
          condition_grade: string
          mpn: string
        }[]
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
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
      v2_reallocate_costs_by_grade: {
        Args: { p_line_item_id: string }
        Returns: undefined
      }
      v2_recalculate_variant_stats: {
        Args: { p_sku_code: string }
        Returns: undefined
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
    },
  },
} as const
