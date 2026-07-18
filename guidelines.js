/**
 * Guideline-based color profiles for the ALPSTUGA cards.
 *
 * Each metric's reading is mapped to one of the shared level keys
 * (good / fair / moderate / poor / very_poor) which the cards turn into a
 * color. Thresholds come from published guidelines rather than taste:
 *
 *   - PM2.5       WHO 2021 Global Air Quality Guidelines, 24-hour values:
 *                 AQG 15 and interim targets 25 / 37.5 / 50 µg/m³.
 *   - CO₂         German UBA (Umweltbundesamt) indoor guide values:
 *                 <1000 harmless, 1000–2000 elevated, >2000 unacceptable.
 *                 (WHO sets no indoor CO₂ limit.)
 *   - Temperature WHO Housing & Health Guidelines comfort band 18–24 °C
 *                 (min 18 °C), aligned with ASHRAE 55.
 *   - Humidity    ASHRAE 55 / EPA healthy indoor band 30–60 % RH.
 *
 * Pollutants (CO₂, PM2.5) are monotonic: higher is worse, expressed as
 * ascending `bounds` = upper limits for good/fair/moderate/poor. Comfort
 * metrics (temperature, humidity) are bidirectional — too low and too high are
 * both bad — expressed as nested best-to-worst `[min, max]` ranges.
 *
 * Add a standard by copying the `who` profile; the config `guidelines:` option
 * selects one by name, so new profiles need no card changes.
 */

export const GUIDELINE_PROFILES = {
  who: {
    co2: { type: "bounds", bounds: [800, 1000, 1400, 2000] },
    pm25: { type: "bounds", bounds: [15, 25, 37.5, 50] },
    temperature: {
      type: "comfort",
      good: [18, 24],
      fair: [16, 26],
      poor: [12, 30],
    },
    humidity: {
      type: "comfort",
      good: [30, 60],
      fair: [25, 65],
      poor: [20, 70],
    },
  },
};

// Ascending upper bounds -> level. Anything above the last bound is very_poor.
function levelFromBounds(value, bounds) {
  const [g, f, m, p] = bounds;
  if (value < g) return "good";
  if (value < f) return "fair";
  if (value < m) return "moderate";
  if (value < p) return "poor";
  return "very_poor";
}

// Nested comfort ranges, innermost (best) first. Outside all of them: very_poor.
function comfortLevel(value, spec) {
  const within = (r) => r && value >= r[0] && value <= r[1];
  if (within(spec.good)) return "good";
  if (within(spec.fair)) return "fair";
  if (within(spec.poor)) return "poor";
  return "very_poor";
}

/**
 * Normalizes the `guidelines:` config value to a profile name, or null when
 * coloring is disabled. Coloring is on by default: an unset/true value selects
 * the `who` profile; `none`/`off`/false disables it.
 */
export function resolveGuidelines(value) {
  if (value === undefined || value === null || value === true) return "who";
  if (value === false) return null;
  const name = String(value).toLowerCase();
  if (name === "none" || name === "off" || name === "false") return null;
  return name;
}

/**
 * Level key for `value` of metric `key` under the named `profile`, or undefined
 * when the profile is disabled/unknown, the metric has no bands, or the value
 * is non-numeric. Callers treat undefined as "no tint".
 */
export function guidelineLevel(profile, key, value) {
  if (!profile || !Number.isFinite(value)) return undefined;
  const spec = GUIDELINE_PROFILES[profile]?.[key];
  if (!spec) return undefined;
  if (spec.type === "bounds") return levelFromBounds(value, spec.bounds);
  if (spec.type === "comfort") return comfortLevel(value, spec);
  return undefined;
}
