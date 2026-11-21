/**
 * Generated from the connected Supabase project "wasla".
 * Project ref: yfgvimcqbtthnrbzbhft
 * Generated: 2026-11-21
 *
 * Contains schema types only; it does not contain private API keys.
 */
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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      consents: {
        Row: {
          accepted_at: string
          id: number
          kind: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: number
          kind: string
          user_id: string
          version?: string
        }
        Update: {
          accepted_at?: string
          id?: number
          kind?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          code: string
          created_by: string | null
          expires_at: string
          kind: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code?: string
          created_by?: string | null
          expires_at?: string
          kind: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_by?: string | null
          expires_at?: string
          kind?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_notes: {
        Row: {
          created_at: string
          doctor_id: string
          id: number
          note: string
          order_id: string | null
          patient_id: string
        }
        Insert: {
          created_at?: string
          doctor_id: string
          id?: number
          note: string
          order_id?: string | null
          patient_id: string
        }
        Update: {
          created_at?: string
          doctor_id?: string
          id?: number
          note?: string
          order_id?: string | null
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_notes_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          active: boolean
          created_at: string
          id: number
          sort_order: number
          text: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          sort_order?: number
          text: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          sort_order?: number
          text?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: number
          note: string | null
          order_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: number
          note?: string | null
          order_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: number
          note?: string | null
          order_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string
          created_at: string
          customer_id: string
          deposit_egp: number
          deposit_paid: boolean
          id: string
          item_id: number | null
          lat: number | null
          lng: number | null
          notes: string | null
          price_egp: number | null
          product_id: number | null
          provider_id: string | null
          quantity: number
          ref: string
          scheduled_at: string | null
          sector: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          customer_id: string
          deposit_egp?: number
          deposit_paid?: boolean
          id?: string
          item_id?: number | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          price_egp?: number | null
          product_id?: number | null
          provider_id?: string | null
          quantity?: number
          ref?: string
          scheduled_at?: string | null
          sector: string
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          customer_id?: string
          deposit_egp?: number
          deposit_paid?: boolean
          id?: string
          item_id?: number | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          price_egp?: number | null
          product_id?: number | null
          provider_id?: string | null
          quantity?: number
          ref?: string
          scheduled_at?: string | null
          sector?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          discount_price_egp: number | null
          expiry: string | null
          id: number
          merchant_id: string
          name: string
          price_egp: number
          stock: number
        }
        Insert: {
          active?: boolean
          discount_price_egp?: number | null
          expiry?: string | null
          id?: number
          merchant_id: string
          name: string
          price_egp: number
          stock?: number
        }
        Update: {
          active?: boolean
          discount_price_egp?: number | null
          expiry?: string | null
          id?: number
          merchant_id?: string
          name?: string
          price_egp?: number
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string | null
          role: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          phone?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: string
        }
        Relationships: []
      }
      provider_schedules: {
        Row: {
          active: boolean
          end_time: string
          id: number
          provider_id: string
          slot_minutes: number
          start_time: string
          weekday: number
        }
        Insert: {
          active?: boolean
          end_time: string
          id?: never
          provider_id: string
          slot_minutes?: number
          start_time: string
          weekday: number
        }
        Update: {
          active?: boolean
          end_time?: string
          id?: never
          provider_id?: string
          slot_minutes?: number
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_schedules_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          active: boolean
          approved: boolean
          area: string | null
          created_at: string
          display_name: string
          id: string
          is_test: boolean
          kind: string
          specialty: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          approved?: boolean
          area?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_test?: boolean
          kind: string
          specialty?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          approved?: boolean
          area?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_test?: boolean
          kind?: string
          specialty?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_items: {
        Row: {
          active: boolean
          id: number
          name: string
          price_egp: number | null
          sector: string
        }
        Insert: {
          active?: boolean
          id?: number
          name: string
          price_egp?: number | null
          sector: string
        }
        Update: {
          active?: boolean
          id?: number
          name?: string
          price_egp?: number | null
          sector?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_consent: {
        Args: { p_kind: string; p_version?: string }
        Returns: undefined
      }
      admin_reset_user_password: {
        Args: { p_new_password: string; p_phone: string }
        Returns: string
      }
      approve_provider: { Args: { p_provider: string }; Returns: undefined }
      assign_order: {
        Args: { p_order: string; p_provider: string }
        Returns: undefined
      }
      book_clinic_slot: {
        Args: {
          p_at: string
          p_notes?: string
          p_provider: string
          p_source?: string
        }
        Returns: {
          out_order_id: string
          out_price_egp: number
          out_ref: string
          out_scheduled_at: string
        }[]
      }
      clinic_available_slots: {
        Args: { p_day: string; p_provider: string }
        Returns: {
          slot: string
        }[]
      }
      create_invite: { Args: { p_kind: string }; Returns: string }
      current_provider_id: { Args: never; Returns: string }
      current_role_name: { Args: never; Returns: string }
      doctor_set_appointment_status: {
        Args: { p_note?: string; p_order: string; p_to: string }
        Returns: undefined
      }
      is_staff: { Args: never; Returns: boolean }
      my_order_tracking: {
        Args: { p_order: string }
        Returns: {
          ahead_count: number
          events: Json
          queue_position: number
          ref: string
          scheduled_at: string
          sector: string
          status: string
        }[]
      }
      place_order: {
        Args: {
          p_address: string
          p_item_id: number
          p_notes?: string
          p_sector: string
          p_source?: string
        }
        Returns: {
          out_deposit_egp: number
          out_order_id: string
          out_price_egp: number
          out_ref: string
        }[]
      }
      place_product_order: {
        Args: {
          p_address: string
          p_notes?: string
          p_product: number
          p_qty: number
          p_source?: string
        }
        Returns: {
          out_order_id: string
          out_ref: string
          out_total: number
        }[]
      }
      provider_set_order_status: {
        Args: { p_note?: string; p_order: string; p_to: string }
        Returns: undefined
      }
      quote_order: {
        Args: { p_order: string; p_price: number }
        Returns: undefined
      }
      redeem_invite: {
        Args: {
          p_area?: string
          p_code: string
          p_display_name: string
          p_specialty?: string
        }
        Returns: string
      }
      set_order_location: {
        Args: {
          p_address?: string
          p_lat: number
          p_lng: number
          p_order: string
        }
        Returns: undefined
      }
      set_order_status: {
        Args: { p_note?: string; p_order: string; p_to: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
