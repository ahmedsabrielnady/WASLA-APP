/**
 * Public browser configuration for WASLA.
 *
 * The publishable key is designed for browser use. It is NOT a service-role key.
 * Row Level Security and database policies remain the actual authorization layer.
 */
import { isPreviewHost } from "./domain.js";

export const CONFIG = Object.freeze({
  supabaseUrl: "https://yfgvimcqbtthnrbzbhft.supabase.co",
  supabasePublishableKey: "sb_publishable_Aej6zAcIojeoTI7GUxcXbA_lSKKqUmh",
  appName: "WASLA",
  appCity: "شبين القناطر",
  appRegion: "القليوبية",
  isPublicPreview: isPreviewHost(window.location.hostname)
});
