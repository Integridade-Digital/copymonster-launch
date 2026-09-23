/**
 * Re-export of the browser Supabase client under the `supabase` alias the
 * admin and billing surfaces import. The canonical client lives in
 * `lib/auth/supabase.client`.
 * @module apps/web/src/lib/supabase/client
 */

export { supabaseClient as supabase } from '../auth/supabase.client';
