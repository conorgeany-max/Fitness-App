/** Whether this build is the hosted version. Kept free of imports so local builds stay small. */
export const cloudConfigured = (): boolean => !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
