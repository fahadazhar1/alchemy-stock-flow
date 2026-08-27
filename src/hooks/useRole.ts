import { useAuth } from "@/contexts/AuthContext";

export function useRole() {
  const { role, isAdmin, isViewer } = useAuth();
  return { role, isAdmin, isViewer, canEdit: isAdmin };
}
