/**
 * Shared localization for the ALPSTUGA cards.
 *
 * Home Assistant has no built-in translation mechanism for custom Lovelace
 * cards (`hass.localize` only resolves core HA keys), so each card bundles its
 * own string tables here and looks them up via `t(hass, key, vars)`.
 *
 * The active language comes from the user's HA profile, exposed on `hass`:
 *   hass.locale.language (modern) -> hass.language (legacy) -> "en".
 *
 * Lookup falls back full-locale -> base-language -> English -> the raw key, so
 * an untranslated string is never blank. `{name}` placeholders in a string are
 * replaced from `vars`.
 *
 * To add a language, copy the `en` block and translate the values. Metric keys
 * like CO₂ / PM2.5 are intentionally identical across languages.
 */

const TRANSLATIONS = {
  en: {
    aqi: {
      good: "Good",
      fair: "Fair",
      moderate: "Moderate",
      poor: "Poor",
      very_poor: "Very poor",
      extremely_poor: "Extremely poor",
      unknown: "Unknown",
      unavailable: "Air quality unavailable",
    },
    metric: {
      co2: "CO₂",
      pm25: "PM2.5",
      temperature: "Temperature",
      humidity: "Humidity",
      air_quality: "Air Quality",
    },
    strip: {
      label: "Air quality · last {hours}h",
      now: "now",
      ago: "-{hours}h",
      empty: "no history yet",
    },
    editor: {
      device: "ALPSTUGA device",
      title: "Title (optional)",
      hours: "History window (hours)",
      entities: "Entity overrides (optional)",
    },
  },
  de: {
    aqi: {
      good: "Gut",
      fair: "Akzeptabel",
      moderate: "Mäßig",
      poor: "Schlecht",
      very_poor: "Sehr schlecht",
      extremely_poor: "Extrem schlecht",
      unknown: "Unbekannt",
      unavailable: "Luftqualität nicht verfügbar",
    },
    metric: {
      co2: "CO₂",
      pm25: "PM2.5",
      temperature: "Temperatur",
      humidity: "Luftfeuchtigkeit",
      air_quality: "Luftqualität",
    },
    strip: {
      label: "Luftqualität · letzte {hours} h",
      now: "jetzt",
      ago: "-{hours} h",
      empty: "noch kein Verlauf",
    },
    editor: {
      device: "ALPSTUGA-Gerät",
      title: "Titel (optional)",
      hours: "Verlaufszeitraum (Stunden)",
      entities: "Entitäts-Überschreibungen (optional)",
    },
  },
};

// Ordered languages to try for a given hass, e.g. "de-DE" -> ["de-de", "de", "en"].
function langCandidates(hass) {
  const raw = String(
    hass?.locale?.language || hass?.language || "en"
  ).toLowerCase();
  const base = raw.split("-")[0];
  return [...new Set([raw, base, "en"])];
}

// Resolves a dotted key ("aqi.good") within one language table, or undefined.
function resolve(lang, key) {
  return key
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), TRANSLATIONS[lang]);
}

/**
 * Translate `key` for the user's language, interpolating `{name}` from `vars`.
 * Falls back to English and finally the key itself, so it always returns text.
 */
export function t(hass, key, vars) {
  let str;
  for (const lang of langCandidates(hass)) {
    str = resolve(lang, key);
    if (str != null) break;
  }
  if (str == null) str = key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = String(str).split(`{${k}}`).join(String(v));
    }
  }
  return str;
}
