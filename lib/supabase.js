// Single shared Supabase client. Importing this everywhere (instead of
// re-creating clients per module) avoids multiple GoTrue instances racing on
// the same auth token, and lets the @supabase/supabase-js code split into a
// shared chunk that both eager and lazy bundles reference.
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
