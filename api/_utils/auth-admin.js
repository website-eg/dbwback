import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Service Role client for admin tasks
let supabaseServiceRoleClient = null;

export function getSupabaseAdmin() {
  if (supabaseServiceRoleClient) return supabaseServiceRoleClient;

  // Use ACADEMY database (contains students, users, attendance, progress, etc.)
  // Falls back to generic SUPABASE_URL for backward compatibility
  const url = process.env.ACADEMY_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.ACADEMY_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing ACADEMY_SUPABASE_URL/ACADEMY_SUPABASE_KEY (or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY) environment variables');
  }

  supabaseServiceRoleClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

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
