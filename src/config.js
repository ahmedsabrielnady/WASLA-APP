/**
 * Public browser configuration for WASLA.
 *
 * The publishable key is designed for browser use. It is NOT a service-role key.
 * Row Level Security and database policies remain the actual authorization layer.
 */
import { TEST_BACKEND, TEST_WRITE_HOST, isPreviewHost } from "./domain.js";

// Only the isolated test preview alias talks to the test backend. All other hosts keep production config.
const HOST = String(window.location.hostname ?? "").trim().toLowerCase();
const ON_TEST_ALIAS = Boolean(TEST_WRITE_HOST) && HOST === TEST_WRITE_HOST;
const SUPABASE_URL = ON_TEST_ALIAS ? TEST_BACKEND : "https://yfgvimcqbtthnrbzbhft.supabase.co";
const TEST_PUBLISHABLE_KEY = "sb_publishable_Z-1vjfz6rsD3an_EP-4wqQ_bglZ_KSx";

export const CONFIG = Object.freeze({
  supabaseUrl: SUPABASE_URL,
  supabasePublishableKey: ON_TEST_ALIAS ? TEST_PUBLISHABLE_KEY : "sb_publishable_Aej6zAcIojeoTI7GUxcXbA_lSKKqUmh",
  // Web Push stays off until a VAPID public key is set here. A sender and the private key do not exist yet.
  pushPublicKey: "",
  appName: "WASLA",
  appCity: "شبين القناطر",
  appRegion: "القليوبية",
  isTestBackend: ON_TEST_ALIAS,
  // Clinic booking needs book_clinic_slot, which is revoked on production on purpose. Closed there until a reviewed replacement is applied.
  clinicBookingEnabled: ON_TEST_ALIAS,
  isPublicPreview: isPreviewHost(window.location.hostname, SUPABASE_URL)
});
