CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role
CREATE POLICY "user_can_read_own_role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can insert/update roles (managed by admin outside app)
CREATE POLICY "service_role_manage_roles" ON public.user_roles
  FOR ALL USING (auth.role() = 'service_role');
