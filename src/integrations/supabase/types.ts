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
      ai_recommendations: {
        Row: {
          created_at: string | null
          id: string
          product_id: string | null
          reason: string
          recommendation_type: string
          source_logic: string
          status: string | null
          store_id: string | null
          suggested_discount_percent: number | null
          suggested_new_price: number | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id?: string | null
          reason: string
          recommendation_type: string
          source_logic: string
          status?: string | null
          store_id?: string | null
          suggested_discount_percent?: number | null
          suggested_new_price?: number | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string | null
          reason?: string
          recommendation_type?: string
          source_logic?: string
          status?: string | null
          store_id?: string | null
          suggested_discount_percent?: number | null
          suggested_new_price?: number | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_loser_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ai_recommendations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ai_recommendations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_candidates"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "ai_recommendations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      collections: {
        Row: {
          created_at: string | null
          id: string
          name: string
          shopify_collection_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          shopify_collection_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          shopify_collection_id?: string | null
        }
        Relationships: []
      }
      inventory_batches: {
        Row: {
          batch_code: string | null
          created_at: string | null
          expiry_date: string | null
          id: string
          quantity: number
          store_id: string | null
          variant_id: string
        }
        Insert: {
          batch_code?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          quantity: number
          store_id?: string | null
          variant_id: string
        }
        Update: {
          batch_code?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          quantity?: number
          store_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_batches_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_batches_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_levels: {
        Row: {
          available_quantity: number
          id: string
          master_variant_id: string
          reserved_quantity: number
          updated_at: string | null
        }
        Insert: {
          available_quantity?: number
          id?: string
          master_variant_id: string
          reserved_quantity?: number
          updated_at?: string | null
        }
        Update: {
          available_quantity?: number
          id?: string
          master_variant_id?: string
          reserved_quantity?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_master_variant_id_fkey"
            columns: ["master_variant_id"]
            isOneToOne: true
            referencedRelation: "master_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_master_variant_id_fkey"
            columns: ["master_variant_id"]
            isOneToOne: true
            referencedRelation: "v_central_inventory"
            referencedColumns: ["master_variant_id"]
          },
        ]
      }
      inventory_sync_logs: {
        Row: {
          action_type: string
          campaign_name: string | null
          created_at: string | null
          id: string
          items_affected: number
          metadata: Json
          status: string
          store_id: string | null
        }
        Insert: {
          action_type: string
          campaign_name?: string | null
          created_at?: string | null
          id?: string
          items_affected?: number
          metadata?: Json
          status: string
          store_id?: string | null
        }
        Update: {
          action_type?: string
          campaign_name?: string | null
          created_at?: string | null
          id?: string
          items_affected?: number
          metadata?: Json
          status?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sync_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      master_products: {
        Row: {
          created_at: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      master_variants: {
        Row: {
          base_price: number | null
          created_at: string | null
          id: string
          master_product_id: string
          sku: string
          updated_at: string | null
        }
        Insert: {
          base_price?: number | null
          created_at?: string | null
          id?: string
          master_product_id: string
          sku: string
          updated_at?: string | null
        }
        Update: {
          base_price?: number | null
          created_at?: string | null
          id?: string
          master_product_id?: string
          sku?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_variants_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_variants_master_product_id_fkey"
            columns: ["master_product_id"]
            isOneToOne: false
            referencedRelation: "v_central_inventory"
            referencedColumns: ["master_product_id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          order_id: string
          product_id: string
          quantity: number
          store_id: string | null
          unit_price: number
          variant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id: string
          product_id: string
          quantity: number
          store_id?: string | null
          unit_price: number
          variant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          store_id?: string | null
          unit_price?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_loser_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_candidates"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          id: string
          order_number: string
          shopify_order_id: string | null
          status: string
          store_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_number: string
          shopify_order_id?: string | null
          status: string
          store_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          order_number?: string
          shopify_order_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_campaign_items: {
        Row: {
          action_status: string
          campaign_id: string
          created_at: string | null
          id: string
          new_compare_at_price: number | null
          new_price: number
          old_compare_at_price: number | null
          old_price: number
          store_id: string | null
          variant_id: string
        }
        Insert: {
          action_status: string
          campaign_id: string
          created_at?: string | null
          id?: string
          new_compare_at_price?: number | null
          new_price: number
          old_compare_at_price?: number | null
          old_price: number
          store_id?: string | null
          variant_id: string
        }
        Update: {
          action_status?: string
          campaign_id?: string
          created_at?: string | null
          id?: string
          new_compare_at_price?: number | null
          new_price?: number
          old_compare_at_price?: number | null
          old_price?: number
          store_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_campaign_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "pricing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_campaign_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "pricing_campaign_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_campaign_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_campaigns: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          discount_percent: number | null
          ended_at: string | null
          fixed_price: number | null
          id: string
          inventory_reduction: number | null
          name: string
          overwrite_existing: boolean
          post_campaign_inventory: number | null
          pre_campaign_inventory: number | null
          rejected_at: string | null
          rejection_reason: string | null
          rounding_mode: string
          sell_through_delta: number | null
          started_at: string | null
          store_id: string | null
          workflow_status: string | null
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          discount_percent?: number | null
          ended_at?: string | null
          fixed_price?: number | null
          id?: string
          inventory_reduction?: number | null
          name: string
          overwrite_existing?: boolean
          post_campaign_inventory?: number | null
          pre_campaign_inventory?: number | null
          rejected_at?: string | null
          rejection_reason?: string | null
          rounding_mode?: string
          sell_through_delta?: number | null
          started_at?: string | null
          store_id?: string | null
          workflow_status?: string | null
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          discount_percent?: number | null
          ended_at?: string | null
          fixed_price?: number | null
          id?: string
          inventory_reduction?: number | null
          name?: string
          overwrite_existing?: boolean
          post_campaign_inventory?: number | null
          pre_campaign_inventory?: number | null
          rejected_at?: string | null
          rejection_reason?: string | null
          rounding_mode?: string
          sell_through_delta?: number | null
          started_at?: string | null
          store_id?: string | null
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_campaigns_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_collections: {
        Row: {
          collection_id: string
          created_at: string | null
          id: string
          product_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string | null
          id?: string
          product_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string | null
          id?: string
          product_id?: string
        }
        Relationships: []
      }
      product_tags: {
        Row: {
          created_at: string | null
          id: string
          product_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id: string
          tag_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_loser_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_candidates"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      product_velocity_metrics: {
        Row: {
          id: string
          last_sale_at: string | null
          product_id: string
          store_id: string | null
          units_sold_14d: number
          units_sold_21d: number
          units_sold_30d: number
          units_sold_7d: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          last_sale_at?: string | null
          product_id: string
          store_id?: string | null
          units_sold_14d?: number
          units_sold_21d?: number
          units_sold_30d?: number
          units_sold_7d?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          last_sale_at?: string | null
          product_id?: string
          store_id?: string | null
          units_sold_14d?: number
          units_sold_21d?: number
          units_sold_30d?: number
          units_sold_7d?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_velocity_metrics_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_velocity_metrics_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_loser_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_velocity_metrics_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_product_inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_velocity_metrics_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_replenishment_candidates"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_velocity_metrics_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          collection_id: string | null
          created_at: string | null
          id: string
          name: string
          product_type: string | null
          shopify_product_id: string | null
          sku: string
          slug: string | null
          status: string
          store_id: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          collection_id?: string | null
          created_at?: string | null
          id?: string
          name: string
          product_type?: string | null
          shopify_product_id?: string | null
          sku: string
          slug?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          collection_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
          product_type?: string | null
          shopify_product_id?: string | null
          sku?: string
          slug?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_connections: {
        Row: {
          access_token: string | null
          auto_sync_enabled: boolean
          connected_at: string | null
          created_at: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          last_sync_records: number | null
          last_sync_status: string | null
          shop_domain: string
          store_id: string | null
          sync_frequency: string
          updated_at: string | null
        }
        Insert: {
          access_token?: string | null
          auto_sync_enabled?: boolean
          connected_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_records?: number | null
          last_sync_status?: string | null
          shop_domain: string
          store_id?: string | null
          sync_frequency?: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string | null
          auto_sync_enabled?: boolean
          connected_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_records?: number | null
          last_sync_status?: string | null
          shop_domain?: string
          store_id?: string | null
          sync_frequency?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_connections_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync_logs: {
        Row: {
          completed_at: string | null
          connection_id: string | null
          created_at: string | null
          current_page: number | null
          current_stage: string | null
          cursor: string | null
          error_message: string | null
          id: string
          metadata: Json
          records_synced: number
          status: string
          store_id: string | null
          sync_time: string
        }
        Insert: {
          completed_at?: string | null
          connection_id?: string | null
          created_at?: string | null
          current_page?: number | null
          current_stage?: string | null
          cursor?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          records_synced?: number
          status: string
          store_id?: string | null
          sync_time?: string
        }
        Update: {
          completed_at?: string | null
          connection_id?: string | null
          created_at?: string | null
          current_page?: number | null
          current_stage?: string | null
          cursor?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          records_synced?: number
          status?: string
          store_id?: string | null
          sync_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "shopify_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_logs: {
        Row: {
          created_at: string | null
          id: string
          input_payload: Json
          result_payload: Json
          simulation_name: string | null
          store_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          input_payload?: Json
          result_payload?: Json
          simulation_name?: string | null
          store_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          input_payload?: Json
          result_payload?: Json
          simulation_name?: string | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_variant_mappings: {
        Row: {
          created_at: string | null
          id: string
          master_variant_id: string
          store_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          master_variant_id: string
          store_id: string
          variant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          master_variant_id?: string
          store_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_variant_mappings_master_variant_id_fkey"
            columns: ["master_variant_id"]
            isOneToOne: false
            referencedRelation: "master_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_variant_mappings_master_variant_id_fkey"
            columns: ["master_variant_id"]
            isOneToOne: false
            referencedRelation: "v_central_inventory"
            referencedColumns: ["master_variant_id"]
          },
          {
            foreignKeyName: "store_variant_mappings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_variant_mappings_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          access_token: string | null
          connected_at: string | null
          created_at: string | null
          currency: string | null
          currency_symbol: string | null
          id: string
          is_active: boolean
          platform: string | null
          shopify_store_id: string | null
          store_code: string
          store_name: string
          store_url: string | null
          updated_at: string | null
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string | null
          currency?: string | null
          currency_symbol?: string | null
          id?: string
          is_active?: boolean
          platform?: string | null
          shopify_store_id?: string | null
          store_code: string
          store_name: string
          store_url?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string | null
          currency?: string | null
          currency_symbol?: string | null
          id?: string
          is_active?: boolean
          platform?: string | null
          shopify_store_id?: string | null
          store_code?: string
          store_name?: string
          store_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variants: {
        Row: {
          campaign_name: string | null
          committed_quantity: number
          compare_at_price: number | null
          created_at: string | null
          expiry_date: string | null
          id: string
          inventory_quantity: number
          last_discounted_at: string | null
          price: number
          product_id: string
          shopify_inventory_item_id: string | null
          shopify_variant_id: string | null
          size: string
          store_id: string | null
          updated_at: string | null
          variant_sku: string
        }
        Insert: {
          campaign_name?: string | null
          committed_quantity?: number
          compare_at_price?: number | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          inventory_quantity?: number
          last_discounted_at?: string | null
          price: number
          product_id: string
          shopify_inventory_item_id?: string | null
          shopify_variant_id?: string | null
          size: string
          store_id?: string | null
          updated_at?: string | null
          variant_sku: string
        }
        Update: {
          campaign_name?: string | null
          committed_quantity?: number
          compare_at_price?: number | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string
          inventory_quantity?: number
          last_discounted_at?: string | null
          price?: number
          product_id?: string
          shopify_inventory_item_id?: string | null
          shopify_variant_id?: string | null
          size?: string
          store_id?: string | null
          updated_at?: string | null
          variant_sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_loser_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_inventory_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_candidates"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "variants_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_campaign_performance: {
        Row: {
          average_discount_percent: number | null
          campaign_id: string | null
          campaign_name: string | null
          ended_at: string | null
          inventory_reduction: number | null
          post_campaign_inventory: number | null
          pre_campaign_inventory: number | null
          products_affected: number | null
          sell_through_delta: number | null
          started_at: string | null
          variants_affected: number | null
          workflow_status: string | null
        }
        Relationships: []
      }
      v_central_inventory: {
        Row: {
          available_quantity: number | null
          base_price: number | null
          linked_stores_count: number | null
          master_product_id: string | null
          master_product_name: string | null
          master_variant_id: string | null
          net_available: number | null
          reserved_quantity: number | null
          sku: string | null
        }
        Relationships: []
      }
      v_dashboard_kpis: {
        Row: {
          available_units: number | null
          campaigns_running_count: number | null
          collections_count: number | null
          losers_count: number | null
          low_stock_winners_count: number | null
          near_expiry_products_count: number | null
          on_hand_inventory: number | null
          out_of_stock_products: number | null
          pending_approvals_count: number | null
          pending_order_inventory: number | null
          sell_through_ratio_current_month: number | null
          vendors_count: number | null
          winners_count: number | null
        }
        Relationships: []
      }
      v_loser_products: {
        Row: {
          collection_name: string | null
          days_old: number | null
          product_id: string | null
          product_name: string | null
          sku: string | null
          total_inventory: number | null
          vendor_name: string | null
        }
        Relationships: []
      }
      v_product_inventory_summary: {
        Row: {
          campaign_name: string | null
          collection_name: string | null
          created_at: string | null
          days_old: number | null
          discount_status: string | null
          max_compare_at_price: number | null
          min_current_price: number | null
          near_expiry_status: string | null
          nearest_expiry_date: string | null
          product_id: string | null
          product_name: string | null
          product_status: string | null
          product_type: string | null
          sku: string | null
          total_inventory: number | null
          vendor_name: string | null
        }
        Relationships: []
      }
      v_replenishment_candidates: {
        Row: {
          available_units: number | null
          product_id: string | null
          product_name: string | null
          replenishment_status: string | null
          sku: string | null
          velocity: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_bulk_discount: {
        Args: {
          p_campaign_name?: string
          p_discount_percent?: number
          p_fixed_price?: number
          p_overwrite_existing?: boolean
          p_product_ids: string[]
          p_rounding_mode?: string
        }
        Returns: Json
      }
      approve_and_execute_campaign: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      create_campaign_draft: {
        Args: {
          p_campaign_name?: string
          p_discount_percent?: number
          p_fixed_price?: number
          p_overwrite_existing?: boolean
          p_product_ids?: string[]
          p_rounding_mode?: string
          p_source?: string
          p_variant_ids?: string[]
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      preview_bulk_discount: {
        Args: {
          p_discount_percent?: number
          p_fixed_price?: number
          p_overwrite_existing?: boolean
          p_product_ids: string[]
          p_rounding_mode?: string
        }
        Returns: Json
      }
      preview_what_if_simulation: {
        Args: {
          p_discount_tiers: number[]
          p_product_ids: string[]
          p_rounding_mode?: string
        }
        Returns: Json
      }
      revert_variant_pricing: {
        Args: { p_product_id?: string; p_variant_id?: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "viewer"
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
      app_role: ["admin", "manager", "viewer"],
    },
  },
} as const
