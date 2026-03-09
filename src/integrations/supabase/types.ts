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
      catalog_product: {
        Row: {
          brickeconomy_id: string | null
          bricklink_item_no: string | null
          brickowl_boid: string | null
          created_at: string
          id: string
          mpn: string
          name: string
          piece_count: number | null
          product_type: string
          rebrickable_id: string | null
          release_year: number | null
          retired_flag: boolean
          status: string
          theme_id: string | null
          updated_at: string
          version_descriptor: string | null
        }
        Insert: {
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          created_at?: string
          id?: string
          mpn: string
          name: string
          piece_count?: number | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          retired_flag?: boolean
          status?: string
          theme_id?: string | null
          updated_at?: string
          version_descriptor?: string | null
        }
        Update: {
          brickeconomy_id?: string | null
          bricklink_item_no?: string | null
          brickowl_boid?: string | null
          created_at?: string
          id?: string
          mpn?: string
          name?: string
          piece_count?: number | null
          product_type?: string
          rebrickable_id?: string | null
          release_year?: number | null
          retired_flag?: boolean
          status?: string
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
      sku: {
        Row: {
          active_flag: boolean
          catalog_product_id: string
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at: string
          id: string
          qbo_item_id: string | null
          saleable_flag: boolean
          sku_code: string
          updated_at: string
        }
        Insert: {
          active_flag?: boolean
          catalog_product_id: string
          condition_grade: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          id?: string
          qbo_item_id?: string | null
          saleable_flag?: boolean
          sku_code: string
          updated_at?: string
        }
        Update: {
          active_flag?: boolean
          catalog_product_id?: string
          condition_grade?: Database["public"]["Enums"]["condition_grade"]
          created_at?: string
          id?: string
          qbo_item_id?: string | null
          saleable_flag?: boolean
          sku_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_catalog_product_id_fkey"
            columns: ["catalog_product_id"]
            isOneToOne: false
            referencedRelation: "catalog_product"
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
            foreignKeyName: "stock_unit_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku"
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
            referencedRelation: "catalog_product"
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
