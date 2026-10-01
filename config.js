// Supabase connection settings.
// Fill these in from your Supabase project: Settings → API.
// The anon (public) key is safe to ship in the browser. Row Level Security protects the data.
// Leave both empty to run the app in local-only mode (data stays on this device).
window.PLANNER_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Show a "Create account" button on the sign-in screen.
  // Keep false for a private board: add users in Supabase under Authentication → Users.
  allowSignup: false,
};
