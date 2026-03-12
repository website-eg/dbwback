import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Service Role client for admin tasks
let supabaseServiceRoleClient = null;

export function getSupabaseAdmin() {
  if (supabaseServiceRoleClient) return supabaseServiceRoleClient;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }

  supabaseServiceRoleClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return supabaseServiceRoleClient;
}

export async function verifyAdminRole(token) {
  try {
    const supabase = getSupabaseAdmin();
    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return false;

    // Check role in users table
    const { data: userData, error: dbError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (dbError || !userData) return false;

    const role = userData.role;
    // Only admin or teacher can access admin commands
    return role === "admin" || role === "teacher";
  } catch (error) {
    console.error("verifyAdminRole error:", error);
    return false;
  }
}
