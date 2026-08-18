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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      acessos: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          id: string
          ip: string | null
          path: string | null
          user_agent: string | null
        }
        Insert: {
          action?: string
          created_at?: string
          detail?: string | null
          id?: string
          ip?: string | null
          path?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          id?: string
          ip?: string | null
          path?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      cotacoes_frete: {
        Row: {
          cep_dest: string
          cep_origin: string
          cpf: string | null
          created_at: string
          days: number
          declared_value: number | null
          height: number | null
          id: string
          length: number | null
          paid: boolean
          price: number
          weight: number
          width: number | null
        }
        Insert: {
          cep_dest: string
          cep_origin: string
          cpf?: string | null
          created_at?: string
          days?: number
          declared_value?: number | null
          height?: number | null
          id?: string
          length?: number | null
          paid?: boolean
          price?: number
          weight?: number
          width?: number | null
        }
        Update: {
          cep_dest?: string
          cep_origin?: string
          cpf?: string | null
          created_at?: string
          days?: number
          declared_value?: number | null
          height?: number | null
          id?: string
          length?: number | null
          paid?: boolean
          price?: number
          weight?: number
          width?: number | null
        }
        Relationships: []
      }
      ml_connections: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string | null
          id: string
          ml_user_id: string
          nickname: string | null
          refresh_token: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at?: string | null
          id?: string
          ml_user_id: string
          nickname?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          ml_user_id?: string
          nickname?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ml_oauth_states: {
        Row: {
          created_at: string
          state: string
        }
        Insert: {
          created_at?: string
          state: string
        }
        Update: {
          created_at?: string
          state?: string
        }
        Relationships: []
      }
      pedidos: {
        Row: {
          cpf: string | null
          created_at: string
          delivery_date: string | null
          dest_address: string | null
          dest_cep: string | null
          dest_city: string
          dest_state: string
          id: string
          invoice_number: string | null
          invoice_series: string | null
          marketplace: string
          notes: string | null
          origin_city: string
          origin_state: string
          product: string | null
          product_value: number | null
          recipient: string
          sender: string
          ship_date: string
          status: string
          tracking_code: string
          updated_at: string
          weight: number | null
        }
        Insert: {
          cpf?: string | null
          created_at?: string
          delivery_date?: string | null
          dest_address?: string | null
          dest_cep?: string | null
          dest_city: string
          dest_state: string
          id?: string
          invoice_number?: string | null
          invoice_series?: string | null
          marketplace?: string
          notes?: string | null
          origin_city?: string
          origin_state?: string
          product?: string | null
          product_value?: number | null
          recipient: string
          sender?: string
          ship_date?: string
          status?: string
          tracking_code: string
          updated_at?: string
          weight?: number | null
        }
        Update: {
          cpf?: string | null
          created_at?: string
          delivery_date?: string | null
          dest_address?: string | null
          dest_cep?: string | null
          dest_city?: string
          dest_state?: string
          id?: string
          invoice_number?: string | null
          invoice_series?: string | null
          marketplace?: string
          notes?: string | null
          origin_city?: string
          origin_state?: string
          product?: string | null
          product_value?: number | null
          recipient?: string
          sender?: string
          ship_date?: string
          status?: string
          tracking_code?: string
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
      }
      reclamacoes: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string
          name: string
          phone: string | null
          tracking_code: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          name: string
          phone?: string | null
          tracking_code: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          name?: string
          phone?: string | null
          tracking_code?: string
        }
        Relationships: []
      }
      solicitacoes_nf: {
        Row: {
          cpf: string
          created_at: string
          doc_type: string
          email: string | null
          full_name: string
          id: string
          order_code: string
          phone: string | null
          status: string
        }
        Insert: {
          cpf: string
          created_at?: string
          doc_type: string
          email?: string | null
          full_name: string
          id?: string
          order_code: string
          phone?: string | null
          status?: string
        }
        Update: {
          cpf?: string
          created_at?: string
          doc_type?: string
          email?: string | null
          full_name?: string
          id?: string
          order_code?: string
          phone?: string | null
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
