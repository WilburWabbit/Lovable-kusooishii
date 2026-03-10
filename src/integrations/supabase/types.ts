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
      channel_listing: {
        Row: {
          channel: string
          created_at: string
          external_listing_id: string | null
          external_sku: string
          id: string
          listed_price: number | null
          listed_quantity: number | null
          listing_description: string | null
          listing_title: string | null
          offer_status: string | null
          raw_data: Json | null
          sku_id: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          external_listing_id?: string | null
          external_sku: string
          id?: string
          listed_price?: number | null
          listed_quantity?: number | null
          listing_description?: string | null
          listing_title?: string | null
          offer_status?: string | null
          raw_data?: Json | null
          sku_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          external_listing_id?: string | null
          external_sku?: string
          id?: string
          listed_price?: number | null
          listed_quantity?: number | null
          listing_description?: string | null
          listing_title?: string | null
          offer_status?: string | null
          raw_data?: Json | null
          sku_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_listing_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
        ]
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
      customer: {
        Row: {
          active: boolean
          billing_city: string | null
          billing_country: string | null
          billing_county: string | null
          billing_line_1: string | null
          billing_line_2: string | null
          billing_postcode: string | null
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
        ]
      }
      product: {
        Row: {
          age_range: string | null
          call_to_action: string | null
          created_at: string
          description: string | null
          height_cm: number | null
          highlights: string | null
          id: string
          img_url: string | null
          lego_catalog_id: string | null
          length_cm: number | null
          mpn: string
          name: string | null
          piece_count: number | null
          product_hook: string | null
          product_type: string
          release_year: number | null
          retired_flag: boolean
          seo_description: string | null
          seo_title: string | null
          status: string
          subtheme_name: string | null
          theme_id: string | null
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          age_range?: string | null
          call_to_action?: string | null
          created_at?: string
          description?: string | null
          height_cm?: number | null
          highlights?: string | null
          id?: string
          img_url?: string | null
          lego_catalog_id?: string | null
          length_cm?: number | null
          mpn: string
          name?: string | null
          piece_count?: number | null
          product_hook?: string | null
          product_type?: string
          release_year?: number | null
          retired_flag?: boolean
          seo_description?: string | null
          seo_title?: string | null
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          age_range?: string | null
          call_to_action?: string | null
          created_at?: string
          description?: string | null
          height_cm?: number | null
          highlights?: string | null
          id?: string
          img_url?: string | null
          lego_catalog_id?: string | null
          length_cm?: number | null
          mpn?: string
          name?: string | null
          piece_count?: number | null
          product_hook?: string | null
          product_type?: string
          release_year?: number | null
          retired_flag?: boolean
          seo_description?: string | null
          seo_title?: string | null
          status?: string
          subtheme_name?: string | null
          theme_id?: string | null
          updated_at?: string
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
          club_commission_amount: number
          club_discount_amount: number
          club_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          discount_total: number
          doc_number: string | null
          global_tax_calculation: string | null
          gross_total: number
          guest_email: string | null
          guest_name: string | null
          id: string
          merchandise_subtotal: number
          notes: string | null
          order_number: string
          origin_channel: string
          origin_reference: string | null
          payment_reference: string | null
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
          txn_date: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          club_commission_amount?: number
          club_discount_amount?: number
          club_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          discount_total?: number
          doc_number?: string | null
          global_tax_calculation?: string | null
          gross_total: number
          guest_email?: string | null
          guest_name?: string | null
          id?: string
          merchandise_subtotal: number
          notes?: string | null
          order_number?: string
          origin_channel?: string
          origin_reference?: string | null
          payment_reference?: string | null
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
          txn_date?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          club_commission_amount?: number
          club_discount_amount?: number
          club_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          discount_total?: number
          doc_number?: string | null
          global_tax_calculation?: string | null
          gross_total?: number
          guest_email?: string | null
          guest_name?: string | null
          id?: string
          merchandise_subtotal?: number
          notes?: string | null
          order_number?: string
          origin_channel?: string
          origin_reference?: string | null
          payment_reference?: string | null
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
          txn_date?: string | null
          updated_at?: string
          user_id?: string | null
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
      sku: {
        Row: {
          active_flag: boolean
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          id: string
          name: string | null
          price: number | null
          product_id: string | null
          qbo_item_id: string | null
          saleable_flag: boolean
          sku_code: string
          updated_at: string
        }
        Insert: {
          active_flag?: boolean
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          id?: string
          name?: string | null
          price?: number | null
          product_id?: string | null
          qbo_item_id?: string | null
          saleable_flag?: boolean
          sku_code: string
          updated_at?: string
        }
        Update: {
          active_flag?: boolean
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          id?: string
          name?: string | null
          price?: number | null
          product_id?: string | null
          qbo_item_id?: string | null
          saleable_flag?: boolean
          sku_code?: string
          updated_at?: string
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
          carrying_value: number | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          id: string
          inbound_receipt_line_id: string | null
          landed_cost: number | null
          location_id: string | null
          mpn: string
          notes: string | null
          reservation_id: string | null
          serial_or_internal_mark: string | null
          sku_id: string
          status: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          accumulated_impairment?: number
          carrying_value?: number | null
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          id?: string
          inbound_receipt_line_id?: string | null
          landed_cost?: number | null
          location_id?: string | null
          mpn: string
          notes?: string | null
          reservation_id?: string | null
          serial_or_internal_mark?: string | null
          sku_id: string
          status?: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          accumulated_impairment?: number
          carrying_value?: number | null
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          id?: string
          inbound_receipt_line_id?: string | null
          landed_cost?: number | null
          location_id?: string | null
          mpn?: string
          notes?: string | null
          reservation_id?: string | null
          serial_or_internal_mark?: string | null
          sku_id?: string
          status?: Database["public"]["Enums"]["stock_unit_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_unit_inbound_receipt_line_id_fkey"
            columns: ["inbound_receipt_line_id"]
            isOneToOne: false
            referencedRelation: "inbound_receipt_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_unit_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
            referencedColumns: ["id"]
          },
        ]
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
      [_ in never]: never
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
      browse_catalog: {
        Args: {
          filter_grade?: string
          filter_retired?: boolean
          filter_theme_id?: string
          search_term?: string
        }
        Returns: {
          best_grade: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
    }
    Enums: {
      app_role: "admin" | "staff" | "member"
      condition_grade: "1" | "2" | "3" | "4" | "5"
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
    },
  },
} as const
