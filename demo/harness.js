/**
 * Shared demo harness for the ALPSTUGA cards.
 *
 * Stubs the two Home Assistant custom elements the cards depend on (ha-card,
 * ha-icon) so the real card code runs unmodified outside HA, and provides
 * helpers to synthesise mock `hass` data. Imported by the demo pages
 * (index.html = header showcase, features.html = guideline-color showcase).
 *
 * Loading the real MDI path data from a CDN keeps icons correct with no
 * vendored font files — the demo is a dev tool, so an internet connection when
 * rendering is fine.
 */

import * as mdiIcons from "https://cdn.jsdelivr.net/npm/@mdi/js@7/+esm";

// "mdi:molecule-co2" -> mdiIcons.mdiMoleculeCo2
function mdiPath(name) {
  if (!name || !name.startsWith("mdi:")) return "";
  const key =
    "mdi" +
    name
      .slice(4)
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("");
  return mdiIcons[key] || "";
}

// ha-card: HA's flat, bordered card surface projecting its children.
class HaCard extends HTMLElement {
  constructor() {
    super();
    const sr = this.attachShadow({ mode: "open" });
    sr.innerHTML = `<style>
      :host {
        display: block;
        background: var(--ha-card-background, var(--card-background-color, #fff));
        border-radius: var(--ha-card-border-radius, 12px);
        border: var(--ha-card-border-width, 1px) solid
          var(--ha-card-border-color, var(--divider-color));
        box-shadow: var(--ha-card-box-shadow, none);
        color: var(--primary-text-color);
      }
    </style><slot></slot>`;
  }
}

// ha-icon: renders the same MDI path data HA does, as an SVG that inherits
// `color` via currentColor (so the cards' level tinting works).
class HaIcon extends HTMLElement {
  set icon(v) {
    this._icon = v;
    this._render();
  }
  get icon() {
    return this._icon;
  }
  connectedCallback() {
    if (!this.firstChild) this._render();
  }
  _render() {
    const d = mdiPath(this._icon);
    this.style.display = "inline-flex";
    this.innerHTML =
      `<svg viewBox="0 0 24 24" focusable="false" ` +
      `style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);` +
      `display:block;fill:currentColor"><path d="${d}"/></svg>`;
  }
}

// Define once, even if several pages import this module.
if (!customElements.get("ha-card")) customElements.define("ha-card", HaCard);
if (!customElements.get("ha-icon")) customElements.define("ha-icon", HaIcon);

/* -------------------------------------------------------------------------- */
/* Mock data helpers                                                          */
/* -------------------------------------------------------------------------- */

export const HOURS = 24;

// Small deterministic wiggle so charts look organic but never change.
export const wig = (i, amp) => Math.sin(i * 1.7) * amp * 0.35;

// Builds a deterministic history series spanning the last HOURS hours as the
// cards' compressed `{ s, lu }` samples. `fn(frac, i)` returns each value.
export function makeSeries(fn, points = 180) {
  const now = Date.now();
  const startMs = now - HOURS * 3600 * 1000;
  const out = [];
  for (let i = 0; i < points; i++) {
    const frac = i / (points - 1);
    const t = startMs + frac * (now - startMs);
    out.push({ s: String(fn(frac, i)), lu: t / 1000 });
  }
  return out;
}

const last = (arr) => arr[arr.length - 1].s;

/**
 * Builds a mock `hass` for a single ALPSTUGA device from a `metrics` map:
 *   { <key>: { dc, unit, data: [{ s, lu }, ...] } }
 * where <key> is air_quality | co2 | pm25 | temperature | humidity. The entity
 * id is `sensor.alpstuga_<key>`; the current state is the last sample.
 */
export function buildHass({ deviceName = "Living Room", deviceId = "alpstuga1", metrics }) {
  const entities = {};
  const states = {};
  const history = {};
  for (const [key, m] of Object.entries(metrics)) {
    const id = `sensor.alpstuga_${key}`;
    entities[id] = { device_id: deviceId };
    states[id] = {
      state: last(m.data),
      attributes: { device_class: m.dc, unit_of_measurement: m.unit },
    };
    history[id] = m.data;
  }
  return {
    devices: { [deviceId]: { name: deviceName } },
    entities,
    states,
    callWS: async ({ entity_ids }) => {
      const res = {};
      for (const id of entity_ids) if (history[id]) res[id] = history[id];
      return res;
    },
  };
}
