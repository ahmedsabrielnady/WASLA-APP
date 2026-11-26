// Free-only location helpers: Leaflet (vendored) + OpenStreetMap tiles + plain deep links. No API key, no geocoding service.
// OSM tile policy: attribution is required, the browser must send a Referer, no bulk download or prefetch.
// https://operations.osmfoundation.org/policies/tiles/

export const DEFAULT_CENTER = Object.freeze({ lat: 30.2897, lng: 31.3167 }); // Shibin El Qanater (approximate)
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function isValidPoint(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  return lat !== null && lng !== null && lat !== "" && lng !== "" && Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

export function isValidEgyptPhone(value) {
  return /^01[0-9]{9}$/.test(String(value ?? "").trim());
}

export function normalizePlate(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function validateVehicle(vehicle = {}) {
  const make = String(vehicle.make ?? "").trim();
  const model = String(vehicle.model ?? "").trim();
  const plate = normalizePlate(vehicle.plate);
  if (!make || make.length > 40) return "اكتب ماركة السيارة (حتى 40 حرفًا).";
  if (!model || model.length > 40) return "اكتب موديل السيارة (حتى 40 حرفًا).";
  if (plate.length < 2 || plate.length > 20) return "اكتب رقم لوحة السيارة.";
  return "";
}

// Directions and calls are plain links that open the user's own apps, so nothing here needs a key or a paid service.
export function directionsLinks(lat, lng) {
  if (!isValidPoint(lat, lng)) return null;
  const a = Number(lat).toFixed(6);
  const b = Number(lng).toFixed(6);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${a},${b}`,
    osm: `https://www.openstreetmap.org/directions?route=%3B${a}%2C${b}`,
    geo: `geo:${a},${b}?q=${a},${b}`,
    view: `https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=17/${a}/${b}`
  };
}

export function telHref(phone) {
  return isValidEgyptPhone(phone) ? `tel:+2${String(phone).trim()}` : "";
}

let leafletPromise = null;
export function loadLeaflet() {
  if (globalThis.L?.map) return Promise.resolve(globalThis.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "./vendor/leaflet/leaflet.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "./vendor/leaflet/leaflet.js";
    script.onload = () => (globalThis.L?.map ? resolve(globalThis.L) : reject(new Error("map library missing")));
    script.onerror = () => { leafletPromise = null; reject(new Error("map library failed")); };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function pinIcon(L) {
  return L.divIcon({ className: "geo-pin", html: '<span aria-hidden="true"></span>', iconSize: [28, 38], iconAnchor: [14, 36] });
}

// Mounts a map into `el`. editable: the customer can tap or drag the pin; onChange gets {lat, lng}.
export async function mountMap(el, { lat, lng, editable = false, onChange = null, zoom = 16 } = {}) {
  if (!el || !isValidPoint(lat, lng)) return null;
  try {
    const L = await loadLeaflet();
    if (!el.isConnected) return null;
    el.textContent = "";
    const map = L.map(el, { center: [Number(lat), Number(lng)], zoom, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION, crossOrigin: false }).addTo(map);
    const marker = L.marker([Number(lat), Number(lng)], { icon: pinIcon(L), draggable: editable, keyboard: editable }).addTo(map);
    if (editable) {
      const emit = (p) => { if (onChange && isValidPoint(p.lat, p.lng)) onChange({ lat: p.lat, lng: p.lng }); };
      marker.on("dragend", () => emit(marker.getLatLng()));
      map.on("click", (event) => { marker.setLatLng(event.latlng); emit(event.latlng); });
    }
    return { map, marker };
  } catch {
    if (el.isConnected) el.innerHTML = '<p class="geo-map-fallback">تعذر تحميل الخريطة. يمكنك استخدام روابط الاتجاهات.</p>';
    return null;
  }
}
