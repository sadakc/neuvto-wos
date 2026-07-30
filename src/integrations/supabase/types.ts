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
      analytics_events: {
        Row: {
          event: string
          id: string
          occurred_at: string
          organization_id: string | null
          properties: Json
          user_id: string | null
        }
        Insert: {
          event: string
          id?: string
          occurred_at?: string
          organization_id?: string | null
          properties?: Json
          user_id?: string | null
        }
        Update: {
          event?: string
          id?: string
          occurred_at?: string
          organization_id?: string | null
          properties?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_chains: {
        Row: {
          approver_role: Database["public"]["Enums"]["app_role"] | null
          approver_rule: Database["public"]["Enums"]["approver_rule"]
          condition_field: string | null
          condition_op: string | null
          condition_value: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_type: string
          escalate_after_days: number | null
          id: string
          level: number
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approver_role?: Database["public"]["Enums"]["app_role"] | null
          approver_rule: Database["public"]["Enums"]["approver_rule"]
          condition_field?: string | null
          condition_op?: string | null
          condition_value?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_type: string
          escalate_after_days?: number | null
          id?: string
          level: number
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approver_role?: Database["public"]["Enums"]["app_role"] | null
          approver_rule?: Database["public"]["Enums"]["approver_rule"]
          condition_field?: string | null
          condition_op?: string | null
          condition_value?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_type?: string
          escalate_after_days?: number | null
          id?: string
          level?: number
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_chains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          completed_at: string | null
          context: Json
          created_at: string
          created_by: string | null
          current_level: number
          deleted_at: string | null
          entity_id: string
          entity_type: string
          id: string
          organization_id: string
          requester_id: string
          required_levels: number
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          completed_at?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          current_level: number
          deleted_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          organization_id: string
          requester_id: string
          required_levels: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          completed_at?: string | null
          context?: Json
          created_at?: string
          created_by?: string | null
          current_level?: number
          deleted_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          organization_id?: string
          requester_id?: string
          required_levels?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_steps: {
        Row: {
          approval_request_id: string
          approver_id: string
          comments: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decision: Database["public"]["Enums"]["approval_decision"]
          deleted_at: string | null
          id: string
          level: number
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_request_id: string
          approver_id: string
          comments?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decision?: Database["public"]["Enums"]["approval_decision"]
          deleted_at?: string | null
          id?: string
          level: number
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_request_id?: string
          approver_id?: string
          comments?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decision?: Database["public"]["Enums"]["approval_decision"]
          deleted_at?: string | null
          id?: string
          level?: number
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_steps_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          organization_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          organization_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          organization_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      demo_requests: {
        Row: {
          company: string | null
          created_at: string
          email: string
          employees: string | null
          id: string
          message: string | null
          name: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          employees?: string | null
          id?: string
          message?: string | null
          name: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          employees?: string | null
          id?: string
          message?: string | null
          name?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          parent_department_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          parent_department_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_department_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_department_id_fkey"
            columns: ["parent_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          holiday_date: string
          id: string
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          holiday_date: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          holiday_date?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holidays_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      module_settings: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          module_key: string
          organization_id: string
          setting_key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          module_key: string
          organization_id: string
          setting_key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          module_key?: string
          organization_id?: string
          setting_key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "module_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          key: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          key: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          key?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_templates: {
        Row: {
          body_template: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          event_key: string
          id: string
          is_active: boolean
          organization_id: string | null
          subject_template: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body_template: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          event_key: string
          id?: string
          is_active?: boolean
          organization_id?: string | null
          subject_template: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body_template?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          event_key?: string
          id?: string
          is_active?: boolean
          organization_id?: string | null
          subject_template?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          event_key: string
          failed_reason: string | null
          id: string
          organization_id: string
          payload: Json
          read_at: string | null
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          subject: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attempts?: number
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          event_key: string
          failed_reason?: string | null
          id?: string
          organization_id: string
          payload?: Json
          read_at?: string | null
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          subject: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          event_key?: string
          failed_reason?: string | null
          id?: string
          organization_id?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          subject?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_modules: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          enabled: boolean
          enabled_at: string | null
          module_key: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          enabled?: boolean
          enabled_at?: string | null
          module_key: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          enabled?: boolean
          enabled_at?: string | null
          module_key?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_modules_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "organization_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          allow_retroactive: boolean
          created_at: string
          created_by: string | null
          default_min_notice_days: number
          deleted_at: string | null
          exclude_holidays: boolean
          exclude_weekends: boolean
          fy_start_day: number
          fy_start_month: number
          notify_on_approve: boolean
          notify_on_reject: boolean
          notify_on_submit: boolean
          organization_id: string
          session_absolute_hours: number
          session_idle_minutes: number
          timezone: string
          updated_at: string
          updated_by: string | null
          weekend_days: number[]
        }
        Insert: {
          allow_retroactive?: boolean
          created_at?: string
          created_by?: string | null
          default_min_notice_days?: number
          deleted_at?: string | null
          exclude_holidays?: boolean
          exclude_weekends?: boolean
          fy_start_day?: number
          fy_start_month?: number
          notify_on_approve?: boolean
          notify_on_reject?: boolean
          notify_on_submit?: boolean
          organization_id: string
          session_absolute_hours?: number
          session_idle_minutes?: number
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekend_days?: number[]
        }
        Update: {
          allow_retroactive?: boolean
          created_at?: string
          created_by?: string | null
          default_min_notice_days?: number
          deleted_at?: string | null
          exclude_holidays?: boolean
          exclude_weekends?: boolean
          fy_start_day?: number
          fy_start_month?: number
          notify_on_approve?: boolean
          notify_on_reject?: boolean
          notify_on_submit?: boolean
          organization_id?: string
          session_absolute_hours?: number
          session_idle_minutes?: number
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekend_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          industry_type: string | null
          name: string
          slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          industry_type?: string | null
          name: string
          slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          industry_type?: string | null
          name?: string
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          department_id: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          joined_date: string
          manager_id: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          joined_date?: string
          manager_id?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          joined_date?: string
          manager_id?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approval_decide: {
        Args: {
          _comments?: string
          _decision: Database["public"]["Enums"]["approval_decision"]
          _request_id: string
        }
        Returns: Database["public"]["Enums"]["approval_status"]
      }
      approval_pending_for: {
        Args: { _user_id?: string }
        Returns: {
          completed_at: string | null
          context: Json
          created_at: string
          created_by: string | null
          current_level: number
          deleted_at: string | null
          entity_id: string
          entity_type: string
          id: string
          organization_id: string
          requester_id: string
          required_levels: number
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "approval_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      approval_submit: {
        Args: { _context?: Json; _entity_id: string; _entity_type: string }
        Returns: string
      }
      assert_own_org: { Args: { _org_id: string }; Returns: undefined }
      calculate_working_days: {
        Args: { _from: string; _org_id: string; _to: string }
        Returns: number
      }
      chain_condition_matches: {
        Args: { _context: Json; _field: string; _op: string; _value: number }
        Returns: boolean
      }
      current_org_id: { Args: never; Returns: string }
      emit_platform_event: {
        Args: { _event_key: string; _payload: Json }
        Returns: undefined
      }
      ensure_system_notification_templates: { Args: never; Returns: undefined }
      escape_html: { Args: { _text: string }; Returns: string }
      get_financial_year: {
        Args: { _org_id: string; _ref?: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_approver_on: { Args: { _request_id: string }; Returns: boolean }
      is_manager_of: { Args: { _employee_id: string }; Returns: boolean }
      is_requester_of: { Args: { _request_id: string }; Returns: boolean }
      module_enabled: { Args: { _module_key: string }; Returns: boolean }
      notification_claim_batch: {
        Args: { _limit?: number }
        Returns: {
          body: string
          event_key: string
          id: string
          organization_id: string
          recipient_email: string
          recipient_name: string
          subject: string
        }[]
      }
      notification_mark_failed: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      notification_mark_sent: { Args: { _id: string }; Returns: undefined }
      notify: {
        Args: { _event_key: string; _payload: Json; _recipient_id: string }
        Returns: string
      }
      org_today: { Args: { _org_id: string }; Returns: string }
      render_template: {
        Args: { _payload: Json; _template: string }
        Returns: string
      }
      resolve_approver: {
        Args: {
          _org_id: string
          _requester_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _rule: Database["public"]["Enums"]["approver_rule"]
        }
        Returns: string
      }
      resolve_notification_recipients: {
        Args: { _event_key: string; _payload: Json }
        Returns: string[]
      }
      signup_organization: {
        Args: { p_full_name: string; p_org_name: string; p_slug: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "org_admin" | "hr_admin" | "manager" | "employee"
      approval_decision: "pending" | "approved" | "rejected"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      approver_rule: "reporting_manager" | "manager_of_manager" | "role"
      notification_channel: "email" | "in_app"
      notification_status: "pending" | "sent" | "failed"
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
      app_role: ["org_admin", "hr_admin", "manager", "employee"],
      approval_decision: ["pending", "approved", "rejected"],
      approval_status: ["pending", "approved", "rejected", "cancelled"],
      approver_rule: ["reporting_manager", "manager_of_manager", "role"],
      notification_channel: ["email", "in_app"],
      notification_status: ["pending", "sent", "failed"],
    },
  },
} as const
