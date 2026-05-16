import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Store {
  id: string;
  store_name: string;
  store_code: string;
  platform: string | null;
  store_url: string | null;
  shopify_store_id: string | null;
  is_active: boolean;
  connected_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  currency: string | null;
  currency_symbol: string | null;
}

interface StoreContextType {
  stores: Store[];
  selectedStoreId: string | null;
  selectedStore: Store | null;
  isAllStores: boolean;
  setSelectedStoreId: (id: string | null) => void;
  setAllStores: () => void;
  isLoading: boolean;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const STORE_KEY = "inventory-alchemist-store-id";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [selectedStoreId, setSelectedStoreIdRaw] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORE_KEY);
    return saved || null;
  });
  const [isAllStores, setIsAllStores] = useState(() => localStorage.getItem(STORE_KEY) === "all");
  const queryClient = useQueryClient();

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ["stores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("*").eq("is_active", true).order("store_name");
      if (error) throw error;
      return (data ?? []) as Store[];
    },
  });

  // Auto-select first store if none selected, or recover an invalid saved store id.
  useEffect(() => {
    if (isLoading || stores.length === 0) return;

    const saved = localStorage.getItem(STORE_KEY);

    if (saved === "all") {
      if (!isAllStores) {
        setIsAllStores(true);
      }
      return;
    }

    const savedStoreExists = saved ? stores.some(s => s.id === saved) : false;
    if (savedStoreExists) {
      if (selectedStoreId !== saved) {
        setSelectedStoreIdRaw(saved);
      }
      return;
    }

    if (!selectedStoreId || !savedStoreExists) {
      setSelectedStoreIdRaw(stores[0].id);
      localStorage.setItem(STORE_KEY, stores[0].id);
    }
  }, [stores, isLoading, selectedStoreId, isAllStores]);

  const setSelectedStoreId = (id: string | null) => {
    setSelectedStoreIdRaw(id);
    setIsAllStores(false);
    if (id) localStorage.setItem(STORE_KEY, id);
    queryClient.invalidateQueries();
  };

  const setAllStores = () => {
    setSelectedStoreIdRaw(null);
    setIsAllStores(true);
    localStorage.setItem(STORE_KEY, "all");
    queryClient.invalidateQueries();
  };

  const selectedStore = stores.find(s => s.id === selectedStoreId) ?? null;

  return (
    <StoreContext.Provider value={{ stores, selectedStoreId, selectedStore, isAllStores, setSelectedStoreId, setAllStores, isLoading }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
