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
      cash_tip_verifications: {
        Row: {
          called_at: string
          called_by: string | null
          company_id: string
          confirmed_amount_cents: number | null
          confirmed_by: string | null
          customer_contact: string | null
          driver_id: string | null
          id: string
          notes: string | null
          outcome: string
          reported_amount_cents: number | null
          reported_method: string | null
          tip_id: string | null
        }
        Insert: {
          called_at?: string
          called_by?: string | null
          company_id: string
          confirmed_amount_cents?: number | null
          confirmed_by?: string | null
          customer_contact?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          outcome: string
          reported_amount_cents?: number | null
          reported_method?: string | null
          tip_id?: string | null
        }
        Update: {
          called_at?: string
          called_by?: string | null
          company_id?: string
          confirmed_amount_cents?: number | null
          confirmed_by?: string | null
          customer_contact?: string | null
          driver_id?: string | null
          id?: string
          notes?: string | null
          outcome?: string
          reported_amount_cents?: number | null
          reported_method?: string | null
          tip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_tip_verifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_tip_verifications_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_tip_verifications_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "tips"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          company_pct: number
          created_at: string
          driver_pct: number
          facebook_review_url: string | null
          google_review_url: string | null
          id: string
          logo_url: string | null
          name: string
          platform_pct: number
          primary_color: string | null
          secondary_color: string | null
          slug: string
          sms_template: string | null
          status: string
          support_email: string | null
          support_phone: string | null
          thank_you_email_subject: string
          thank_you_email_template: string
          thank_you_enabled: boolean
          thank_you_sms_template: string
          yelp_review_url: string | null
        }
        Insert: {
          company_pct?: number
          created_at?: string
          driver_pct?: number
          facebook_review_url?: string | null
          google_review_url?: string | null
          id?: string
          logo_url?: string | null
          name: string
          platform_pct?: number
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          sms_template?: string | null
          status?: string
          support_email?: string | null
          support_phone?: string | null
          thank_you_email_subject?: string
          thank_you_email_template?: string
          thank_you_enabled?: boolean
          thank_you_sms_template?: string
          yelp_review_url?: string | null
        }
        Update: {
          company_pct?: number
          created_at?: string
          driver_pct?: number
          facebook_review_url?: string | null
          google_review_url?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          platform_pct?: number
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          sms_template?: string | null
          status?: string
          support_email?: string | null
          support_phone?: string | null
          thank_you_email_subject?: string
          thank_you_email_template?: string
          thank_you_enabled?: boolean
          thank_you_sms_template?: string
          yelp_review_url?: string | null
        }
        Relationships: []
      }
      discrepancy_flags: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          driver_id: string
          id: string
          notes: string | null
          reason: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["flag_status"]
          tip_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          driver_id: string
          id?: string
          notes?: string | null
          reason: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["flag_status"]
          tip_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          driver_id?: string
          id?: string
          notes?: string | null
          reason?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["flag_status"]
          tip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discrepancy_flags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_flags_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_flags_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "tips"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          cashapp_handle: string | null
          company_id: string
          created_at: string
          display_name: string
          email: string | null
          employee_id: string | null
          id: string
          location_id: string | null
          notify_sms: boolean
          paypal_handle: string | null
          phone: string | null
          photo_url: string | null
          slug: string
          status: Database["public"]["Enums"]["driver_status"]
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_onboarded: boolean
          stripe_payouts_enabled: boolean
          user_id: string | null
          venmo_handle: string | null
          zelle_handle: string | null
        }
        Insert: {
          cashapp_handle?: string | null
          company_id: string
          created_at?: string
          display_name: string
          email?: string | null
          employee_id?: string | null
          id?: string
          location_id?: string | null
          notify_sms?: boolean
          paypal_handle?: string | null
          phone?: string | null
          photo_url?: string | null
          slug: string
          status?: Database["public"]["Enums"]["driver_status"]
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_onboarded?: boolean
          stripe_payouts_enabled?: boolean
          user_id?: string | null
          venmo_handle?: string | null
          zelle_handle?: string | null
        }
        Update: {
          cashapp_handle?: string | null
          company_id?: string
          created_at?: string
          display_name?: string
          email?: string | null
          employee_id?: string | null
          id?: string
          location_id?: string | null
          notify_sms?: boolean
          paypal_handle?: string | null
          phone?: string | null
          photo_url?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["driver_status"]
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_onboarded?: boolean
          stripe_payouts_enabled?: boolean
          user_id?: string | null
          venmo_handle?: string | null
          zelle_handle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          body: string
          company_id: string
          created_at: string
          driver_id: string | null
          error: string | null
          id: string
          provider_id: string | null
          rating_id: string | null
          status: string
          subject: string
          to_email: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          driver_id?: string | null
          error?: string | null
          id?: string
          provider_id?: string | null
          rating_id?: string | null
          status?: string
          subject: string
          to_email: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          driver_id?: string | null
          error?: string | null
          id?: string
          provider_id?: string | null
          rating_id?: string | null
          status?: string
          subject?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "ratings"
            referencedColumns: ["id"]
          },
        ]
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
      invites: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          photo_url: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          photo_url?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          photo_url?: string | null
        }
        Relationships: []
      }
      rating_rate_limits: {
        Row: {
          count: number
          driver_id: string
          ip_hash: string
          window_start: string
        }
        Insert: {
          count?: number
          driver_id: string
          ip_hash: string
          window_start: string
        }
        Update: {
          count?: number
          driver_id?: string
          ip_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          admin_notes: string | null
          company_id: string
          created_at: string
          customer_contact: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          driver_id: string
          feedback: string | null
          flagged: boolean
          id: string
          stars: number
        }
        Insert: {
          admin_notes?: string | null
          company_id: string
          created_at?: string
          customer_contact?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          driver_id: string
          feedback?: string | null
          flagged?: boolean
          id?: string
          stars: number
        }
        Update: {
          admin_notes?: string | null
          company_id?: string
          created_at?: string
          customer_contact?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          driver_id?: string
          feedback?: string | null
          flagged?: boolean
          id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_deliveries: {
        Row: {
          body: string
          company_id: string
          created_at: string
          driver_id: string | null
          error: string | null
          id: string
          provider: string
          provider_sid: string | null
          sent_by: string | null
          status: string
          to_phone: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          driver_id?: string | null
          error?: string | null
          id?: string
          provider?: string
          provider_sid?: string | null
          sent_by?: string | null
          status?: string
          to_phone: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          driver_id?: string | null
          error?: string | null
          id?: string
          provider?: string
          provider_sid?: string | null
          sent_by?: string | null
          status?: string
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
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
      tips: {
        Row: {
          amount_cents: number
          company_amount_cents: number
          company_id: string
          created_at: string
          customer_name: string | null
          dispute_reason: string | null
          disputed: boolean
          disputed_at: string | null
          driver_amount_cents: number
          driver_id: string
          id: string
          logged_by: string | null
          note: string | null
          platform_amount_cents: number
          rating_id: string | null
          refund_amount_cents: number | null
          refund_reason: string | null
          refunded_at: string | null
          source: Database["public"]["Enums"]["tip_source"]
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          stripe_status: string | null
          verified: boolean
          verified_at: string | null
        }
        Insert: {
          amount_cents: number
          company_amount_cents: number
          company_id: string
          created_at?: string
          customer_name?: string | null
          dispute_reason?: string | null
          disputed?: boolean
          disputed_at?: string | null
          driver_amount_cents: number
          driver_id: string
          id?: string
          logged_by?: string | null
          note?: string | null
          platform_amount_cents: number
          rating_id?: string | null
          refund_amount_cents?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          source: Database["public"]["Enums"]["tip_source"]
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          stripe_status?: string | null
          verified?: boolean
          verified_at?: string | null
        }
        Update: {
          amount_cents?: number
          company_amount_cents?: number
          company_id?: string
          created_at?: string
          customer_name?: string | null
          dispute_reason?: string | null
          disputed?: boolean
          disputed_at?: string | null
          driver_amount_cents?: number
          driver_id?: string
          id?: string
          logged_by?: string | null
          note?: string | null
          platform_amount_cents?: number
          rating_id?: string | null
          refund_amount_cents?: number | null
          refund_reason?: string | null
          refunded_at?: string | null
          source?: Database["public"]["Enums"]["tip_source"]
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          stripe_status?: string | null
          verified?: boolean
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tips_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "ratings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_company_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_company_admin: {
        Args: { _company_id: string; _user_id: string }
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "super_admin" | "company_admin" | "driver"
      driver_status: "pending" | "active" | "deactivated"
      flag_status: "open" | "resolved" | "violation"
      tip_source:
        | "stripe"
        | "cash"
        | "venmo"
        | "cashapp"
        | "zelle"
        | "paypal"
        | "other"
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
      app_role: ["super_admin", "company_admin", "driver"],
      driver_status: ["pending", "active", "deactivated"],
      flag_status: ["open", "resolved", "violation"],
      tip_source: [
        "stripe",
        "cash",
        "venmo",
        "cashapp",
        "zelle",
        "paypal",
        "other",
      ],
    },
  },
} as const
