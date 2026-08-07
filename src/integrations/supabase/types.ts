export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      approval_entity_labels: {
        Row: {
          created_at: string
          entity_type: string
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
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
      client_errors: {
        Row: {
          fingerprint: string
          first_seen_at: string
          id: string
          last_seen_at: string
          mechanism: string
          message: string
          occurred_on: string
          occurrences: number
          organization_id: string | null
          release: string | null
          route: string | null
          severity: string
          source: string
          stack: string | null
          user_agent: string | null
        }
        Insert: {
          fingerprint: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          mechanism: string
          message: string
          occurred_on?: string
          occurrences?: number
          organization_id?: string | null
          release?: string | null
          route?: string | null
          severity?: string
          source?: string
          stack?: string | null
          user_agent?: string | null
        }
        Update: {
          fingerprint?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          mechanism?: string
          message?: string
          occurred_on?: string
          occurrences?: number
          organization_id?: string | null
          release?: string | null
          route?: string | null
          severity?: string
          source?: string
          stack?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_errors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          department_id: string | null
          email: string
          expires_at: string
          full_name: string | null
          id: string
          joined_date: string | null
          manager_email: string | null
          organization_id: string
          phone: string | null
          phone_normalized: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          joined_date?: string | null
          manager_email?: string | null
          organization_id: string
          phone?: string | null
          phone_normalized?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          joined_date?: string | null
          manager_email?: string | null
          organization_id?: string
          phone?: string | null
          phone_normalized?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          available_days: number | null
          carryforward_days: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          employee_id: string
          entitled_days: number
          fy_label: string
          id: string
          leave_type_id: string
          organization_id: string
          pending_days: number
          reserved_days: number
          updated_at: string
          updated_by: string | null
          used_days: number
        }
        Insert: {
          available_days?: number | null
          carryforward_days?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          employee_id: string
          entitled_days?: number
          fy_label: string
          id?: string
          leave_type_id: string
          organization_id: string
          pending_days?: number
          reserved_days?: number
          updated_at?: string
          updated_by?: string | null
          used_days?: number
        }
        Update: {
          available_days?: number | null
          carryforward_days?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          employee_id?: string
          entitled_days?: number
          fy_label?: string
          id?: string
          leave_type_id?: string
          organization_id?: string
          pending_days?: number
          reserved_days?: number
          updated_at?: string
          updated_by?: string | null
          used_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approval_request_id: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          deleted_at: string | null
          employee_id: string
          from_date: string
          id: string
          leave_type_id: string
          organization_id: string
          reason: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["leave_status"]
          submitted_at: string | null
          to_date: string
          updated_at: string
          updated_by: string | null
          working_days: number
        }
        Insert: {
          approval_request_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          deleted_at?: string | null
          employee_id: string
          from_date: string
          id?: string
          leave_type_id: string
          organization_id: string
          reason?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          submitted_at?: string | null
          to_date: string
          updated_at?: string
          updated_by?: string | null
          working_days: number
        }
        Update: {
          approval_request_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          deleted_at?: string | null
          employee_id?: string
          from_date?: string
          id?: string
          leave_type_id?: string
          organization_id?: string
          reason?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          submitted_at?: string | null
          to_date?: string
          updated_at?: string
          updated_by?: string | null
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          approval_required: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          max_days_per_year: number
          max_per_request: number | null
          min_notice_days: number | null
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_required?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          max_days_per_year?: number
          max_per_request?: number | null
          min_notice_days?: number | null
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_required?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          max_days_per_year?: number
          max_per_request?: number | null
          min_notice_days?: number | null
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_organization_id_fkey"
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
          last_error: string | null
          next_attempt_at: string
          organization_id: string
          payload: Json
          read_at: string | null
          recipient_email: string | null
          recipient_id: string | null
          recipient_name: string | null
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
          last_error?: string | null
          next_attempt_at?: string
          organization_id: string
          payload?: Json
          read_at?: string | null
          recipient_email?: string | null
          recipient_id?: string | null
          recipient_name?: string | null
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
          last_error?: string | null
          next_attempt_at?: string
          organization_id?: string
          payload?: Json
          read_at?: string | null
          recipient_email?: string | null
          recipient_id?: string | null
          recipient_name?: string | null
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
          next_fy_opens_months_before: number
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
          next_fy_opens_months_before?: number
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
          next_fy_opens_months_before?: number
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
          display_name: string | null
          id: string
          industry_type: string | null
          logo_path: string | null
          logo_updated_at: string | null
          name: string
          onboarding_completed_at: string | null
          slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          industry_type?: string | null
          logo_path?: string | null
          logo_updated_at?: string | null
          name: string
          onboarding_completed_at?: string | null
          slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          industry_type?: string | null
          logo_path?: string | null
          logo_updated_at?: string | null
          name?: string
          onboarding_completed_at?: string | null
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          note: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          updated_at?: string
          user_id?: string
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
          phone_normalized: string | null
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
          phone_normalized?: string | null
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
          phone_normalized?: string | null
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
      report_definitions: {
        Row: {
          created_at: string
          description: string | null
          module_key: string
          report_key: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          module_key: string
          report_key: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          module_key?: string
          report_key?: string
          title?: string
        }
        Relationships: []
      }
      report_schedules: {
        Row: {
          cadence: Database["public"]["Enums"]["report_cadence"]
          created_at: string
          created_by: string | null
          day_of_month: number | null
          day_of_week: number | null
          deleted_at: string | null
          id: string
          is_active: boolean
          last_run_on: string | null
          organization_id: string
          recipients: string[]
          report_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cadence: Database["public"]["Enums"]["report_cadence"]
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          last_run_on?: string | null
          organization_id: string
          recipients?: string[]
          report_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cadence?: Database["public"]["Enums"]["report_cadence"]
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          last_run_on?: string | null
          organization_id?: string
          recipients?: string[]
          report_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_report_key_fkey"
            columns: ["report_key"]
            isOneToOne: false
            referencedRelation: "report_definitions"
            referencedColumns: ["report_key"]
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
      admin_set_joined_date: {
        Args: { _employee_id: string; _joined_date: string }
        Returns: undefined
      }
      admin_set_reporting_line: {
        Args: { _employee_id: string; _manager_id: string }
        Returns: undefined
      }
      app_base_url: { Args: never; Returns: string }
      approval_decide: {
        Args: {
          _comments?: string
          _decision: Database["public"]["Enums"]["approval_decision"]
          _request_id: string
        }
        Returns: Database["public"]["Enums"]["approval_status"]
      }
      approval_entity_label: { Args: { _entity_type: string }; Returns: string }
      approval_queue: {
        Args: never
        Returns: {
          approval_request_id: string
          context: Json
          created_at: string
          entity_id: string
          entity_type: string
          level: number
          requester_id: string
          requester_name: string
          required_levels: number
        }[]
      }
      approval_submit: {
        Args: { _context?: Json; _entity_id: string; _entity_type: string }
        Returns: string
      }
      approval_timeline: {
        Args: { _approval_request_id: string }
        Returns: {
          approver_name: string
          comments: string
          decided_at: string
          decision: Database["public"]["Enums"]["approval_decision"]
          level: number
        }[]
      }
      assert_own_org: { Args: { _org_id: string }; Returns: undefined }
      calculate_entitlement: {
        Args: { _employee_id: string; _fy: string; _leave_type_id: string }
        Returns: number
      }
      calculate_working_days: {
        Args: { _from: string; _org_id: string; _to: string }
        Returns: number
      }
      can_approve: { Args: { _user_id: string }; Returns: boolean }
      chain_condition_matches: {
        Args: { _context: Json; _field: string; _op: string; _value: number }
        Returns: boolean
      }
      current_org_id: { Args: never; Returns: string }
      deactivate_employee: {
        Args: { _employee_id: string; _successor_id: string }
        Returns: Json
      }
      deactivation_impact: { Args: { _employee_id: string }; Returns: Json }
      dispatch_notifications: { Args: never; Returns: undefined }
      emit_platform_event: {
        Args: { _event_key: string; _payload: Json }
        Returns: undefined
      }
      ensure_balance: {
        Args: { _employee_id: string; _fy: string; _leave_type_id: string }
        Returns: {
          available_days: number | null
          carryforward_days: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          employee_id: string
          entitled_days: number
          fy_label: string
          id: string
          leave_type_id: string
          organization_id: string
          pending_days: number
          reserved_days: number
          updated_at: string
          updated_by: string | null
          used_days: number
        }
        SetofOptions: {
          from: "*"
          to: "leave_balances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_system_notification_templates: { Args: never; Returns: undefined }
      escape_html: { Args: { _text: string }; Returns: string }
      financial_year_start: {
        Args: { _fy: string; _org_id: string }
        Returns: string
      }
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
      install_default_approval_chain: {
        Args: { _org_id: string }
        Returns: undefined
      }
      invitation_accept: { Args: { _token: string }; Returns: string }
      invitation_create: {
        Args: {
          _department_id?: string
          _email: string
          _full_name?: string
          _joined_date?: string
          _manager_email?: string
          _phone?: string
          _role?: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      invitation_revoke: { Args: { _id: string }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_approver_on: { Args: { _request_id: string }; Returns: boolean }
      is_approver_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_manager_of: { Args: { _employee_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_requester_of: { Args: { _request_id: string }; Returns: boolean }
      leave_all_balances: {
        Args: never
        Returns: {
          available_days: number
          carryforward_days: number
          department_name: string
          employee_id: string
          employee_name: string
          entitled_days: number
          fy_label: string
          leave_type_id: string
          leave_type_name: string
          used_days: number
        }[]
      }
      leave_approval_detail: {
        Args: { _approval_request_id: string }
        Returns: {
          available_days: number
          carryforward_days: number
          employee_name: string
          entitled_days: number
          from_date: string
          fy_label: string
          leave_request_id: string
          leave_type_id: string
          leave_type_name: string
          pending_days: number
          reason: string
          reserved_days: number
          status: Database["public"]["Enums"]["leave_status"]
          to_date: string
          used_days: number
          working_days: number
        }[]
      }
      leave_cancel: { Args: { _request_id: string }; Returns: undefined }
      leave_mark_approved: { Args: { _request_id: string }; Returns: undefined }
      leave_mature_all_balances: { Args: never; Returns: number }
      leave_mature_balances: { Args: { _org_id: string }; Returns: number }
      leave_my_balances: {
        Args: never
        Returns: {
          available_days: number
          carryforward_days: number
          entitled_days: number
          fy_label: string
          leave_type_id: string
          leave_type_name: string
          pending_days: number
          reserved_days: number
          used_days: number
        }[]
      }
      leave_pending_report: {
        Args: never
        Returns: {
          current_level: number
          days_waiting: number
          department_name: string
          employee_name: string
          from_date: string
          leave_request_id: string
          leave_type_name: string
          required_levels: number
          submitted_at: string
          to_date: string
          waiting_on: string
          working_days: number
        }[]
      }
      leave_pending_report_for: {
        Args: { _org: string }
        Returns: {
          current_level: number
          days_waiting: number
          department_name: string
          employee_name: string
          from_date: string
          leave_request_id: string
          leave_type_name: string
          required_levels: number
          submitted_at: string
          to_date: string
          waiting_on: string
          working_days: number
        }[]
      }
      leave_report_schedule_run: { Args: never; Returns: number }
      leave_set_opening_balance: {
        Args: {
          _carryforward: number
          _employee_id: string
          _leave_type_id: string
          _used: number
        }
        Returns: undefined
      }
      leave_submit: {
        Args: {
          _from_date: string
          _leave_type_id: string
          _reason?: string
          _to_date: string
        }
        Returns: string
      }
      leave_summary_days: { Args: { _days: number }; Returns: string }
      leave_summary_lines: {
        Args: { _from: string; _kind: string; _org: string; _to: string }
        Returns: {
          line_count: number
          lines: string
        }[]
      }
      leave_summary_when: {
        Args: { _from: string; _to: string }
        Returns: string
      }
      leave_taken_report: {
        Args: { _from: string; _to: string }
        Returns: {
          decided_at: string
          decided_by: string
          decision_note: string
          department_name: string
          employee_name: string
          from_date: string
          leave_request_id: string
          leave_type_name: string
          reason: string
          status: string
          submitted_at: string
          to_date: string
          working_days: number
        }[]
      }
      leave_taken_report_for: {
        Args: { _from: string; _org: string; _to: string }
        Returns: {
          decided_at: string
          decided_by: string
          decision_note: string
          department_name: string
          employee_name: string
          from_date: string
          leave_request_id: string
          leave_type_name: string
          reason: string
          status: string
          submitted_at: string
          to_date: string
          working_days: number
        }[]
      }
      leave_year_open: {
        Args: { _org_id: string; _ref: string }
        Returns: boolean
      }
      missing_system_notification_templates: { Args: never; Returns: string[] }
      module_enabled_for: {
        Args: { _module_key: string; _org_id: string }
        Returns: boolean
      }
      my_account_status: { Args: never; Returns: string }
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
      notification_mark_retry: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      notification_mark_sent: { Args: { _id: string }; Returns: undefined }
      notification_max_attempts: { Args: never; Returns: number }
      notify: {
        Args: { _event_key: string; _payload: Json; _recipient_id: string }
        Returns: string
      }
      notify_address: {
        Args: {
          _email: string
          _event_key: string
          _name: string
          _org_id: string
          _payload: Json
        }
        Returns: string
      }
      org_today: { Args: { _org_id: string }; Returns: string }
      organization_display_name: { Args: { _org_id: string }; Returns: string }
      platform_client_errors: {
        Args: { p_days?: number }
        Returns: {
          days_seen: number
          fingerprint: string
          first_seen_at: string
          last_seen_at: string
          mechanism: string
          message: string
          occurrences: number
          release: string
          route: string
          severity: string
          stack: string
        }[]
      }
      platform_list_org_modules: {
        Args: { _org_id: string }
        Returns: {
          enabled: boolean
          granted: boolean
          module_key: string
          name: string
          status: string
        }[]
      }
      platform_list_organizations: {
        Args: never
        Returns: {
          admin_accepted: boolean
          admin_email: string
          admin_invite_url: string
          created_at: string
          id: string
          member_count: number
          name: string
          slug: string
        }[]
      }
      platform_mail_health: {
        Args: never
        Returns: {
          failed_24h: number
          healthy: boolean
          last_failure_at: string
          last_failure_reason: string
          last_sent_at: string
          oldest_pending_minutes: number
          pending_now: number
        }[]
      }
      platform_secret: { Args: { _name: string }; Returns: string }
      platform_set_module: {
        Args: { _granted: boolean; _module_key: string; _org_id: string }
        Returns: undefined
      }
      provision_organization: {
        Args: {
          _admin_email: string
          _admin_name?: string
          _admin_phone?: string
          _name: string
          _slug: string
        }
        Returns: string
      }
      reactivate_employee: {
        Args: { _employee_id: string }
        Returns: undefined
      }
      record_client_error: {
        Args: {
          p_fingerprint: string
          p_mechanism: string
          p_message: string
          p_release?: string
          p_route?: string
          p_severity?: string
          p_stack?: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      record_demo_request: {
        Args: {
          p_company?: string
          p_email: string
          p_employees?: string
          p_message?: string
          p_name: string
        }
        Returns: undefined
      }
      record_public_client_error: {
        Args: {
          p_fingerprint: string
          p_mechanism: string
          p_message: string
          p_release?: string
          p_route?: string
          p_severity?: string
          p_stack?: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      render_template: {
        Args: { _payload: Json; _template: string }
        Returns: string
      }
      report_schedule_fires_on: {
        Args: {
          _cadence: Database["public"]["Enums"]["report_cadence"]
          _day_of_month: number
          _day_of_week: number
          _on: string
        }
        Returns: boolean
      }
      report_schedule_mark_run: {
        Args: { _id: string; _on: string }
        Returns: undefined
      }
      report_schedule_remove: { Args: { _id: string }; Returns: undefined }
      report_schedule_save: {
        Args: {
          _cadence: Database["public"]["Enums"]["report_cadence"]
          _day_of_month?: number
          _day_of_week?: number
          _id?: string
          _is_active?: boolean
          _recipients: string[]
          _report_key: string
        }
        Returns: string
      }
      report_schedules_due: {
        Args: { _report_key: string }
        Returns: {
          cadence: Database["public"]["Enums"]["report_cadence"]
          id: string
          local_today: string
          organization_id: string
          recipients: string[]
        }[]
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
      resolve_notification_addresses: {
        Args: { _event_key: string; _payload: Json }
        Returns: {
          email: string
          name: string
        }[]
      }
      resolve_notification_recipients: {
        Args: { _event_key: string; _payload: Json }
        Returns: string[]
      }
      scrub_client_text: {
        Args: { _limit: number; _text: string }
        Returns: string
      }
      session_policy: {
        Args: never
        Returns: {
          absolute_hours: number
          idle_minutes: number
        }[]
      }
      working_days_excluded: {
        Args: { _from: string; _org_id: string; _to: string }
        Returns: {
          day: string
          label: string
          reason: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "org_admin"
        | "hr_admin"
        | "manager"
        | "employee"
        | "supervisor"
        | "coordinator"
      approval_decision: "pending" | "approved" | "rejected"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      approver_rule: "reporting_manager" | "manager_of_manager" | "role"
      leave_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "cancelled"
      notification_channel: "email" | "in_app"
      notification_status: "pending" | "sent" | "failed"
      report_cadence: "weekly" | "monthly"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "org_admin",
        "hr_admin",
        "manager",
        "employee",
        "supervisor",
        "coordinator",
      ],
      approval_decision: ["pending", "approved", "rejected"],
      approval_status: ["pending", "approved", "rejected", "cancelled"],
      approver_rule: ["reporting_manager", "manager_of_manager", "role"],
      leave_status: [
        "draft",
        "pending_approval",
        "approved",
        "rejected",
        "cancelled",
      ],
      notification_channel: ["email", "in_app"],
      notification_status: ["pending", "sent", "failed"],
      report_cadence: ["weekly", "monthly"],
    },
  },
} as const

