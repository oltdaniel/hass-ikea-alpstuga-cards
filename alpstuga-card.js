/**
 * IKEA ALPSTUGA Air Quality Card
 *
 * A custom Lovelace card that visualizes every metric the IKEA ALPSTUGA
 * (Matter air quality sensor, E2495) exposes to Home Assistant in a single card:
 *
 *   - Air Quality  (enum: good / fair / moderate / poor / very_poor / extremely_poor)
 *   - CO2          (ppm)
 *   - PM2.5        (µg/m³)
 *   - Temperature  (°C / °F)
 *   - Humidity     (%)
 *
 * Configuration (Lovelace YAML):
 *
 *   type: custom:alpstuga-card
 *   device: <device_id>          # auto-detects all entities on the device
 *   title: Living Room           # optional, defaults to the device name
 *   entities:                    # optional, override individual auto-detections
 *     co2: sensor.alpstuga_carbon_dioxide
 *     pm25: sensor.alpstuga_pm2_5
 *     temperature: sensor.alpstuga_temperature
 *     humidity: sensor.alpstuga_humidity
 *     air_quality: sensor.alpstuga_air_quality
 *
 * Either `device` or one or more `entities` must be provided.
 */

import { t } from "./translations.js";
import { guidelineLevel, resolveGuidelines } from "./guidelines.js";

const CARD_VERSION = "0.2.0";

/* -------------------------------------------------------------------------- */
/* Metric definitions                                                         */
/* -------------------------------------------------------------------------- */

// Color ramp shared by the AQI badge and the pollutant tiles.
// Ordered from best to worst.
const LEVEL_COLORS = {
  good: "#43a047",
  fair: "#7cb342",
  moderate: "#f9a825",
  poor: "#fb8c00",
  very_poor: "#e53935",
  extremely_poor: "#8e24aa",
  unknown: "var(--disabled-text-color, #9e9e9e)",
};

// Valid Air Quality cluster enum states, best to worst. Display text for each
// (and for "unknown") comes from translations via `t(hass, "aqi.<level>")`.
const AQI_LEVELS = [
  "good",
  "fair",
  "moderate",
  "poor",
  "very_poor",
  "extremely_poor",
];

// The tiles rendered below the AQI banner. `deviceClasses` maps a Home
// Assistant device_class to this metric during auto-detection. Tiles are tinted
// by the active guideline profile (see guidelines.js); which metrics get a
// color is decided there, not here.
const METRICS = [
  {
    key: "co2",
    icon: "mdi:molecule-co2",
    deviceClasses: ["carbon_dioxide"],
  },
  {
    key: "pm25",
    icon: "mdi:blur",
    deviceClasses: ["pm25"],
  },
  {
    key: "temperature",
    icon: "mdi:thermometer",
    deviceClasses: ["temperature"],
  },
  {
    key: "humidity",
    icon: "mdi:water-percent",
    deviceClasses: ["humidity"],
  },
];

const METRIC_KEYS = METRICS.map((m) => m.key);

// AQI states used to recognize the air-quality enum sensor during detection.
const AQI_STATES = AQI_LEVELS;

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

class AlpstugaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = undefined;
    this._built = false;
    this._els = {};
  }

  static getConfigElement() {
    return document.createElement("alpstuga-card-editor");
  }

  static getStubConfig() {
    return { device: "", guidelines: "who", entities: {} };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    const hasEntities =
      config.entities && Object.keys(config.entities).length > 0;
    if (!config.device && !hasEntities) {
      throw new Error(
        "Specify a `device` (the ALPSTUGA device id) or one or more `entities`."
      );
    }
    this._config = config;
    this._profile = resolveGuidelines(config.guidelines); // null when disabled
    this._built = false; // force a structural rebuild
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { rows: 4, columns: 12, min_rows: 3, min_columns: 6 };
  }

  /* --- entity resolution ------------------------------------------------- */

  // Returns { co2, pm25, temperature, humidity, air_quality } -> entity_id.
  // Explicit `entities` overrides win; the rest are auto-detected from the
  // configured device via the entity/state registries.
  _resolveEntities() {
    const hass = this._hass;
    const overrides = this._config.entities || {};
    const resolved = { ...overrides };

    const deviceId = this._config.device;
    if (deviceId && hass && hass.entities) {
      for (const [entityId, entry] of Object.entries(hass.entities)) {
        if (entry.device_id !== deviceId) continue;
        if (entry.disabled_by || entry.hidden_by) continue;
        const state = hass.states[entityId];
        if (!state) continue;
        const dc = state.attributes.device_class;

        // Match a numeric metric by device_class.
        for (const metric of METRICS) {
          if (
            !resolved[metric.key] &&
            metric.deviceClasses.includes(dc)
          ) {
            resolved[metric.key] = entityId;
          }
        }

        // The AQI enum sensor: device_class "enum" (or "aqi") whose state is
        // one of the known air-quality levels.
        if (
          !resolved.air_quality &&
          (dc === "enum" || dc === "aqi") &&
          AQI_STATES.includes(String(state.state).toLowerCase())
        ) {
          resolved.air_quality = entityId;
        }
      }
    }
    return resolved;
  }

  _deviceName() {
    if (this._config.title) return this._config.title;
    const hass = this._hass;
    const deviceId = this._config.device;
    if (deviceId && hass && hass.devices && hass.devices[deviceId]) {
      const d = hass.devices[deviceId];
      return d.name_by_user || d.name || "ALPSTUGA";
    }
    return "ALPSTUGA";
  }

  /* --- rendering --------------------------------------------------------- */

  _render() {
    if (!this._hass) return;
    if (!this._built) this._build();
    this._update();
  }

  _build() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    root.appendChild(this._styles());

    const card = document.createElement("ha-card");
    this._els = { card };

    // Header / AQI banner
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.addEventListener("click", () =>
      this._openEntity(this._els.aqiEntity)
    );

    const bannerIcon = document.createElement("ha-icon");
    bannerIcon.className = "banner-icon";

    const bannerText = document.createElement("div");
    bannerText.className = "banner-text";
    const title = document.createElement("div");
    title.className = "title";
    const aqiLabel = document.createElement("div");
    aqiLabel.className = "aqi-label";
    bannerText.append(title, aqiLabel);

    banner.append(bannerIcon, bannerText);
    card.appendChild(banner);

    this._els.banner = banner;
    this._els.bannerIcon = bannerIcon;
    this._els.title = title;
    this._els.aqiLabel = aqiLabel;

    // Metric tiles
    const grid = document.createElement("div");
    grid.className = "grid";
    this._els.tiles = {};

    for (const metric of METRICS) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.addEventListener("click", () =>
        this._openEntity(this._els.tiles[metric.key]?.entityId)
      );

      const icon = document.createElement("ha-icon");
      icon.icon = metric.icon;
      icon.className = "tile-icon";

      const body = document.createElement("div");
      body.className = "tile-body";
      const value = document.createElement("div");
      value.className = "tile-value";
      const label = document.createElement("div");
      label.className = "tile-label";
      label.textContent = t(this._hass, "metric." + metric.key);
      body.append(value, label);

      tile.append(icon, body);
      grid.appendChild(tile);
      this._els.tiles[metric.key] = { tile, icon, value, entityId: undefined };
    }

    card.appendChild(grid);
    root.appendChild(card);
    this._built = true;
  }

  _update() {
    const hass = this._hass;
    const entities = this._resolveEntities();

    // Title
    this._els.title.textContent = this._deviceName();

    // AQI banner
    const aqiId = entities.air_quality;
    this._els.aqiEntity = aqiId;
    const aqiState = aqiId && hass.states[aqiId];
    let level = "unknown";
    if (aqiState) {
      const s = String(aqiState.state).toLowerCase();
      if (AQI_LEVELS.includes(s)) level = s;
    }
    const color = LEVEL_COLORS[level];
    this._els.aqiLabel.textContent = t(
      this._hass,
      aqiId ? "aqi." + level : "aqi.unavailable"
    );
    this._els.aqiLabel.style.color = color;
    this._els.bannerIcon.icon = this._aqiIcon(level);
    this._els.bannerIcon.style.color = color;
    this._els.banner.style.setProperty("--accent", color);
    this._els.banner.classList.toggle("clickable", !!aqiId);

    // Tiles
    for (const metric of METRICS) {
      const el = this._els.tiles[metric.key];
      const entityId = entities[metric.key];
      el.entityId = entityId;
      const state = entityId && hass.states[entityId];

      if (!state) {
        el.tile.classList.add("missing");
        el.value.textContent = "—";
        el.icon.style.color = "";
        continue;
      }

      el.tile.classList.remove("missing");
      const num = Number(state.state);
      const unit = state.attributes.unit_of_measurement || "";
      if (Number.isFinite(num)) {
        const shown = this._formatNumber(num, metric.key);
        el.value.innerHTML = `${shown}<span class="unit">${unit}</span>`;
      } else {
        el.value.textContent = state.state;
      }

      // Tint the tile icon by the active guideline profile (null = disabled).
      const lvl = guidelineLevel(this._profile, metric.key, num);
      el.icon.style.color = lvl ? LEVEL_COLORS[lvl] : "";
    }
  }

  _formatNumber(num, key) {
    // CO2 and PM2.5 read best as integers; temp/humidity to one decimal.
    if (key === "co2") return Math.round(num).toString();
    if (key === "pm25") return (Math.round(num * 10) / 10).toString();
    return (Math.round(num * 10) / 10).toString();
  }

  _aqiIcon(level) {
    switch (level) {
      case "good":
        return "mdi:emoticon-happy-outline";
      case "fair":
        return "mdi:emoticon-neutral-outline";
      case "moderate":
        return "mdi:weather-hazy";
      case "poor":
        return "mdi:weather-fog";
      case "very_poor":
        return "mdi:emoticon-sad-outline";
      case "extremely_poor":
        return "mdi:skull-outline";
      default:
        return "mdi:help-circle-outline";
    }
  }

  _openEntity(entityId) {
    if (!entityId) return;
    const event = new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    });
    this.dispatchEvent(event);
  }

  _styles() {
    const style = document.createElement("style");
    style.textContent = `
      ha-card {
        overflow: hidden;
      }
      .banner {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        border-left: 6px solid var(--accent, var(--divider-color));
        background: color-mix(in srgb, var(--accent, transparent) 8%, transparent);
      }
      .banner.clickable {
        cursor: pointer;
      }
      .banner-icon {
        --mdc-icon-size: 40px;
        flex: 0 0 auto;
      }
      .banner-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .title {
        font-size: 0.85rem;
        color: var(--secondary-text-color);
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
      .aqi-label {
        font-size: 1.5rem;
        font-weight: 600;
        line-height: 1.2;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1px;
        background: var(--divider-color);
        border-top: 1px solid var(--divider-color);
      }
      .tile {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        background: var(--card-background-color, var(--ha-card-background));
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .tile:hover {
        background: color-mix(in srgb, var(--primary-color) 6%, var(--card-background-color));
      }
      .tile.missing {
        opacity: 0.5;
        cursor: default;
      }
      .tile-icon {
        --mdc-icon-size: 28px;
        color: var(--state-icon-color, var(--paper-item-icon-color));
        flex: 0 0 auto;
      }
      .tile-body {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .tile-value {
        font-size: 1.35rem;
        font-weight: 500;
        line-height: 1.1;
        color: var(--primary-text-color);
      }
      .tile-value .unit {
        font-size: 0.8rem;
        font-weight: 400;
        color: var(--secondary-text-color);
        margin-left: 3px;
      }
      .tile-label {
        font-size: 0.8rem;
        color: var(--secondary-text-color);
        margin-top: 2px;
      }
    `;
    return style;
  }
}

customElements.define("alpstuga-card", AlpstugaCard);

/* -------------------------------------------------------------------------- */
/* Graphical config editor                                                    */
/* -------------------------------------------------------------------------- */

class AlpstugaCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = undefined;
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) {
      this._form.hass = hass;
      this._form.schema = this._schema; // re-localize labels for the new language
    }
  }

  get _schema() {
    return [
      { name: "device", selector: { device: { integration: "matter" } } },
      { name: "title", selector: { text: {} } },
      {
        name: "guidelines",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "who", label: t(this._hass, "editor.guidelines_who") },
              { value: "none", label: t(this._hass, "editor.guidelines_none") },
            ],
          },
        },
      },
      {
        name: "entities",
        type: "expandable",
        title: t(this._hass, "editor.entities"),
        schema: [
          { name: "air_quality", selector: { entity: { domain: "sensor" } } },
          { name: "co2", selector: { entity: { domain: "sensor" } } },
          { name: "pm25", selector: { entity: { domain: "sensor" } } },
          { name: "temperature", selector: { entity: { domain: "sensor" } } },
          { name: "humidity", selector: { entity: { domain: "sensor" } } },
        ],
      },
    ];
  }

  // Maps each ha-form field name to a translation key.
  _computeLabel(schema) {
    const keys = {
      device: "editor.device",
      title: "editor.title",
      guidelines: "editor.guidelines",
      air_quality: "metric.air_quality",
      co2: "metric.co2",
      pm25: "metric.pm25",
      temperature: "metric.temperature",
      humidity: "metric.humidity",
    };
    const key = keys[schema.name];
    return key ? t(this._hass, key) : schema.name;
  }

  _render() {
    if (!this._form) {
      this.innerHTML = "";
      const form = document.createElement("ha-form");
      form.computeLabel = (schema) => this._computeLabel(schema);
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: ev.detail.value },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(form);
      this._form = form;
      if (this._hass) form.hass = this._hass;
    }
    this._form.schema = this._schema;
    this._form.data = this._config;
  }
}

customElements.define("alpstuga-card-editor", AlpstugaCardEditor);

/* -------------------------------------------------------------------------- */
/* Card picker registration                                                   */
/* -------------------------------------------------------------------------- */

window.customCards = window.customCards || [];
window.customCards.push({
  type: "alpstuga-card",
  name: "IKEA ALPSTUGA Air Quality Card",
  description:
    "Visualizes all metrics of the IKEA ALPSTUGA Matter air quality sensor (Air Quality, CO₂, PM2.5, temperature, humidity) in one card.",
  preview: true,
  documentationURL:
    "https://github.com/oltdaniel/hass-ikea-alpstuga-cards",
});

// eslint-disable-next-line no-console
console.info(
  `%c ALPSTUGA-CARD %c v${CARD_VERSION} `,
  "color: white; background: #0058a3; font-weight: 700;",
  "color: #0058a3; background: #ffdb00; font-weight: 700;"
);
