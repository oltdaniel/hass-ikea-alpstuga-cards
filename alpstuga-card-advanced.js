/**
 * IKEA ALPSTUGA Air Quality Card — Advanced
 *
 * Everything the basic `alpstuga-card` shows, plus history:
 *   - a 24h Air Quality timeline strip (colored status segments)
 *   - a 24h sparkline under each numeric metric (CO2, PM2.5, temperature,
 *     humidity) with min/max labels and a hover crosshair + tooltip.
 *
 * History is pulled from Home Assistant's `history/history_during_period`
 * websocket command and refreshed every 5 minutes.
 *
 * Configuration (Lovelace YAML):
 *
 *   type: custom:alpstuga-card-advanced
 *   device: <device_id>          # auto-detects all entities on the device
 *   title: Living Room           # optional, defaults to the device name
 *   hours: 24                    # optional, history window (default 24)
 *   entities:                    # optional per-metric entity_id overrides
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

const CARD_VERSION = "0.1.0";
const REFRESH_MS = 5 * 60 * 1000; // refetch history every 5 minutes
const SPARK_HEIGHT = 56; // px
const MAX_POINTS = 500; // cap drawn points per sparkline

/* -------------------------------------------------------------------------- */
/* Shared metric / level definitions                                          */
/* -------------------------------------------------------------------------- */

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

// Metrics are tinted by the active guideline profile (see guidelines.js);
// `decimals` controls value/min-max formatting.
const METRICS = [
  {
    key: "co2",
    icon: "mdi:molecule-co2",
    deviceClasses: ["carbon_dioxide"],
    decimals: 0,
  },
  {
    key: "pm25",
    icon: "mdi:blur",
    deviceClasses: ["pm25"],
    decimals: 1,
  },
  {
    key: "temperature",
    icon: "mdi:thermometer",
    deviceClasses: ["temperature"],
    decimals: 1,
  },
  {
    key: "humidity",
    icon: "mdi:water-percent",
    deviceClasses: ["humidity"],
    decimals: 0,
  },
];

const AQI_STATES = AQI_LEVELS;

/* -------------------------------------------------------------------------- */
/* Pure data helpers (unit-tested)                                            */
/* -------------------------------------------------------------------------- */

// Turns a raw history array (compressed `history_during_period` format) into
// ascending [{ t: ms, v: number }] points, dropping non-numeric samples.
function parseNumericSeries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    const ts = p.lu ?? p.lc ?? p.last_updated ?? p.last_changed;
    const s = p.s ?? p.state;
    if (ts == null || s == null) continue;
    const v = Number(s);
    if (!Number.isFinite(v)) continue; // skips unavailable / unknown
    out.push({ t: ts * 1000, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Turns a raw history array into ordered AQI segments spanning [start, end]:
// [{ start: ms, end: ms, level }]. Consecutive equal states are merged.
function buildAqiSegments(raw, startMs, endMs) {
  if (!Array.isArray(raw)) return [];
  const pts = [];
  for (const p of raw) {
    const ts = p.lu ?? p.lc ?? p.last_updated ?? p.last_changed;
    const s = String(p.s ?? p.state ?? "").toLowerCase();
    if (ts == null) continue;
    const level = AQI_LEVELS.includes(s) ? s : "unknown";
    pts.push({ t: ts * 1000, level });
  }
  pts.sort((a, b) => a.t - b.t);
  if (!pts.length) return [];
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const start = Math.max(pts[i].t, startMs);
    const end = i + 1 < pts.length ? pts[i + 1].t : endMs;
    if (end <= start) continue;
    const last = segs[segs.length - 1];
    if (last && last.level === pts[i].level) last.end = end;
    else segs.push({ start, end, level: pts[i].level });
  }
  return segs;
}

// Value extent with symmetric padding so the line never touches the edges.
function paddedExtent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}

// Stride-downsamples to at most `max` points, always keeping first and last.
function downsample(series, max) {
  if (series.length <= max) return series;
  const step = (series.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  return out;
}

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

class AlpstugaAdvancedCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = undefined;
    this._built = false;
    this._els = {};
    this._history = {}; // key -> raw history array
    this._lastFetch = 0;
    this._fetching = false;
    this._resizeObs = new ResizeObserver(() => this._drawAllCharts());
  }

  static getConfigElement() {
    return document.createElement("alpstuga-card-advanced-editor");
  }

  static getStubConfig() {
    return { device: "", hours: 24, guidelines: "who", entities: {} };
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
    this._config = { hours: 24, ...config };
    this._profile = resolveGuidelines(config.guidelines); // null when disabled
    this._built = false;
    this._lastFetch = 0; // force refetch on config change
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._maybeFetchHistory();
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { rows: 9, columns: 12, min_rows: 6, min_columns: 6 };
  }

  disconnectedCallback() {
    this._resizeObs.disconnect();
  }

  connectedCallback() {
    if (this._built) this._observeHosts();
  }

  /* --- entity resolution ------------------------------------------------- */

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
        for (const metric of METRICS) {
          if (!resolved[metric.key] && metric.deviceClasses.includes(dc)) {
            resolved[metric.key] = entityId;
          }
        }
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

  /* --- history ----------------------------------------------------------- */

  async _maybeFetchHistory() {
    if (this._fetching) return;
    if (Date.now() - this._lastFetch < REFRESH_MS) return;
    const entities = this._resolveEntities();
    const ids = Object.values(entities).filter(Boolean);
    if (!ids.length || !this._hass) return;

    this._fetching = true;
    const end = new Date();
    const start = new Date(end.getTime() - this._hours() * 3600 * 1000);
    try {
      const result = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      this._history = result || {};
      this._lastFetch = Date.now();
      this._windowStart = start.getTime();
      this._windowEnd = end.getTime();
      this._drawAllCharts();
    } catch (err) {
      // Keep current values; charts just stay empty.
      // eslint-disable-next-line no-console
      console.warn("alpstuga-card-advanced: history fetch failed", err);
    } finally {
      this._fetching = false;
    }
  }

  _hours() {
    const h = Number(this._config.hours);
    return Number.isFinite(h) && h > 0 ? h : 24;
  }

  /* --- rendering --------------------------------------------------------- */

  _render() {
    if (!this._hass) return;
    if (!this._built) this._build();
    this._update();
  }

  _build() {
    const root = this.shadowRoot;
    this._resizeObs.disconnect();
    root.innerHTML = "";
    root.appendChild(this._styles());

    const card = document.createElement("ha-card");
    this._els = { card };

    // Shared tooltip (positioned over the whole card).
    const tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    tooltip.style.opacity = "0";
    this._els.tooltip = tooltip;

    // AQI banner
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.addEventListener("click", () => this._openEntity(this._els.aqiEntity));
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
    Object.assign(this._els, { banner, bannerIcon, title, aqiLabel });

    // AQI timeline strip
    const stripWrap = document.createElement("div");
    stripWrap.className = "strip-wrap";
    const stripLabel = document.createElement("div");
    stripLabel.className = "strip-label";
    const strip = document.createElement("div");
    strip.className = "strip host";
    const axis = document.createElement("div");
    axis.className = "strip-axis";
    const axL = document.createElement("span");
    const axR = document.createElement("span");
    axis.append(axL, axR);
    stripWrap.append(stripLabel, strip, axis);
    card.appendChild(stripWrap);
    Object.assign(this._els, {
      strip,
      stripLabel,
      stripAxisLeft: axL,
      stripAxisRight: axR,
    });

    // Metric panels
    const grid = document.createElement("div");
    grid.className = "grid";
    this._els.panels = {};
    for (const metric of METRICS) {
      const panel = document.createElement("div");
      panel.className = "panel";

      const head = document.createElement("div");
      head.className = "panel-head";
      head.addEventListener("click", () =>
        this._openEntity(this._els.panels[metric.key]?.entityId)
      );
      const icon = document.createElement("ha-icon");
      icon.icon = metric.icon;
      icon.className = "panel-icon";
      const headText = document.createElement("div");
      headText.className = "panel-head-text";
      const value = document.createElement("div");
      value.className = "panel-value";
      const label = document.createElement("div");
      label.className = "panel-label";
      label.textContent = t(this._hass, "metric." + metric.key);
      headText.append(value, label);
      const minmax = document.createElement("div");
      minmax.className = "panel-minmax";
      head.append(icon, headText, minmax);

      const chartHost = document.createElement("div");
      chartHost.className = "chart host";
      chartHost.style.height = `${SPARK_HEIGHT}px`;

      panel.append(head, chartHost);
      grid.appendChild(panel);
      this._els.panels[metric.key] = {
        panel,
        icon,
        value,
        minmax,
        chartHost,
        entityId: undefined,
      };
    }
    card.appendChild(grid);
    card.appendChild(tooltip);
    root.appendChild(card);

    this._built = true;
    this._observeHosts();
  }

  _observeHosts() {
    this._resizeObs.disconnect();
    if (this._els.strip) this._resizeObs.observe(this._els.strip);
    for (const metric of METRICS) {
      const p = this._els.panels?.[metric.key];
      if (p) this._resizeObs.observe(p.chartHost);
    }
  }

  _update() {
    const hass = this._hass;
    const entities = this._resolveEntities();

    const hours = this._hours();
    this._els.title.textContent = this._deviceName();
    this._els.stripLabel.textContent = t(this._hass, "strip.label", { hours });
    this._els.stripAxisLeft.textContent = t(this._hass, "strip.ago", { hours });
    this._els.stripAxisRight.textContent = t(this._hass, "strip.now");
    this._els.strip.dataset.empty = t(this._hass, "strip.empty");

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

    // Panels: current value + tint
    for (const metric of METRICS) {
      const el = this._els.panels[metric.key];
      const entityId = entities[metric.key];
      el.entityId = entityId;
      const state = entityId && hass.states[entityId];
      if (!state) {
        el.panel.classList.add("missing");
        el.value.textContent = "—";
        el.minmax.textContent = "";
        el.icon.style.color = "";
        el.levelColor = "";
        continue;
      }
      el.panel.classList.remove("missing");
      const num = Number(state.state);
      const unit = state.attributes.unit_of_measurement || "";
      if (Number.isFinite(num)) {
        el.value.innerHTML = `${this._fmt(num, metric)}<span class="unit">${unit}</span>`;
      } else {
        el.value.textContent = state.state;
      }
      // Tint by the active guideline profile; the sparkline reuses levelColor.
      const lvl = guidelineLevel(this._profile, metric.key, num);
      el.levelColor = lvl ? LEVEL_COLORS[lvl] : "";
      el.icon.style.color = el.levelColor;
    }

    this._drawAllCharts();
  }

  _fmt(num, metric) {
    const d = metric.decimals ?? 1;
    const f = Math.pow(10, d);
    return (Math.round(num * f) / f).toFixed(d);
  }

  /* --- charts ------------------------------------------------------------ */

  _drawAllCharts() {
    if (!this._built) return;
    this._drawStrip();
    const entities = this._resolveEntities();
    for (const metric of METRICS) {
      const el = this._els.panels[metric.key];
      const raw = this._history[entities[metric.key]];
      this._drawSparkline(metric, el, parseNumericSeries(raw));
    }
  }

  _drawStrip() {
    const host = this._els.strip;
    if (!host) return;
    host.textContent = "";
    const entities = this._resolveEntities();
    const start = this._windowStart;
    const end = this._windowEnd;
    if (start == null || end == null) return;
    const raw = this._history[entities.air_quality];
    const segs = buildAqiSegments(raw, start, end);
    const span = end - start || 1;
    if (!segs.length) {
      host.classList.add("empty");
      return;
    }
    host.classList.remove("empty");
    for (const seg of segs) {
      const div = document.createElement("div");
      div.className = "seg";
      const left = ((seg.start - start) / span) * 100;
      const width = ((seg.end - seg.start) / span) * 100;
      div.style.left = `${left}%`;
      div.style.width = `${width}%`;
      div.style.background = LEVEL_COLORS[seg.level];
      div.addEventListener("pointerenter", (ev) => {
        const s = new Date(seg.start).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const e = new Date(seg.end).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        this._showTooltip(ev, t(this._hass, "aqi." + seg.level), `${s} – ${e}`);
      });
      div.addEventListener("pointerleave", () => this._hideTooltip());
      host.appendChild(div);
    }
  }

  _drawSparkline(metric, el, series) {
    const host = el.chartHost;
    const W = host.clientWidth;
    const H = SPARK_HEIGHT;
    host.textContent = "";
    if (!series.length || W < 4) {
      el.minmax.textContent = "";
      return;
    }

    // min/max labels from the full-resolution series
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const p of series) {
      if (p.v < vmin) vmin = p.v;
      if (p.v > vmax) vmax = p.v;
    }
    el.minmax.innerHTML =
      `<span>▼ ${this._fmt(vmin, metric)}</span>` +
      `<span>▲ ${this._fmt(vmax, metric)}</span>`;

    const pts = downsample(series, MAX_POINTS);
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const tspan = t1 - t0 || 1;
    const ext = paddedExtent(series.map((p) => p.v));
    const vspan = ext.max - ext.min || 1;
    const pad = 3;
    const xOf = (t) => pad + ((t - t0) / tspan) * (W - 2 * pad);
    const yOf = (v) => H - pad - ((v - ext.min) / vspan) * (H - 2 * pad);

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("class", "spark");

    let d = "";
    for (let i = 0; i < pts.length; i++) {
      d += `${i ? "L" : "M"}${xOf(pts[i].t).toFixed(1)},${yOf(pts[i].v).toFixed(1)}`;
    }
    // Area fill
    const area = document.createElementNS(NS, "path");
    area.setAttribute(
      "d",
      `${d}L${xOf(t1).toFixed(1)},${H - pad}L${xOf(t0).toFixed(1)},${H - pad}Z`
    );
    area.setAttribute("class", "spark-area");
    // Line
    const line = document.createElementNS(NS, "path");
    line.setAttribute("d", d);
    line.setAttribute("class", "spark-line");
    // Crosshair + focus dot (hidden until hover)
    const cross = document.createElementNS(NS, "line");
    cross.setAttribute("class", "spark-cross");
    cross.setAttribute("y1", pad);
    cross.setAttribute("y2", H - pad);
    cross.style.opacity = "0";
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("r", "4");
    dot.setAttribute("class", "spark-dot");
    dot.style.opacity = "0";
    // End marker
    const endDot = document.createElementNS(NS, "circle");
    endDot.setAttribute("r", "3.5");
    endDot.setAttribute("cx", xOf(t1).toFixed(1));
    endDot.setAttribute("cy", yOf(pts[pts.length - 1].v).toFixed(1));
    endDot.setAttribute("class", "spark-end");

    // Guideline tint: recolor the trace to match the tile. Uses inline style
    // (not a presentation attribute) so it overrides the .spark-* CSS rules;
    // when no color is set (guidelines off / neutral metric) CSS applies.
    const col = el.levelColor;
    if (col) {
      line.style.stroke = col;
      area.style.fill = col;
      endDot.style.fill = col;
      dot.style.stroke = col;
    }

    svg.append(area, line, endDot, cross, dot);
    host.appendChild(svg);

    // Hover: nearest point by x
    const onMove = (ev) => {
      const rect = svg.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const tHover = t0 + ((x - pad) / (W - 2 * pad)) * tspan;
      let best = pts[0];
      let bestD = Infinity;
      for (const p of pts) {
        const dd = Math.abs(p.t - tHover);
        if (dd < bestD) {
          bestD = dd;
          best = p;
        }
      }
      const px = xOf(best.t);
      const py = yOf(best.v);
      cross.setAttribute("x1", px);
      cross.setAttribute("x2", px);
      cross.style.opacity = "1";
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      dot.style.opacity = "1";
      const time = new Date(best.t).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      this._showTooltip(
        ev,
        `${this._fmt(best.v, metric)}${
          el.entityId
            ? this._hass.states[el.entityId]?.attributes.unit_of_measurement ||
              ""
            : ""
        }`,
        `${t(this._hass, "metric." + metric.key)} · ${time}`
      );
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", () => {
      cross.style.opacity = "0";
      dot.style.opacity = "0";
      this._hideTooltip();
    });
  }

  /* --- tooltip ----------------------------------------------------------- */

  _showTooltip(ev, big, small) {
    const tip = this._els.tooltip;
    const cardRect = this._els.card.getBoundingClientRect();
    tip.innerHTML = `<div class="tt-big">${big}</div><div class="tt-small">${small}</div>`;
    tip.style.opacity = "1";
    // position after content is set so we know its size
    const x = ev.clientX - cardRect.left;
    const y = ev.clientY - cardRect.top;
    const tw = tip.offsetWidth;
    let left = x + 12;
    if (left + tw > cardRect.width) left = x - tw - 12;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, y - 44)}px`;
  }

  _hideTooltip() {
    if (this._els.tooltip) this._els.tooltip.style.opacity = "0";
  }

  /* --- misc -------------------------------------------------------------- */

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
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
  }

  _styles() {
    const style = document.createElement("style");
    style.textContent = `
      ha-card { overflow: hidden; position: relative; }
      .banner {
        display: flex; align-items: center; gap: 16px; padding: 16px;
        border-left: 6px solid var(--accent, var(--divider-color));
        background: color-mix(in srgb, var(--accent, transparent) 8%, transparent);
      }
      .banner.clickable { cursor: pointer; }
      .banner-icon { --mdc-icon-size: 40px; flex: 0 0 auto; }
      .banner-text { display: flex; flex-direction: column; min-width: 0; }
      .title {
        font-size: 0.85rem; color: var(--secondary-text-color);
        text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
      }
      .aqi-label { font-size: 1.5rem; font-weight: 600; line-height: 1.2; }

      .strip-wrap { padding: 12px 16px 8px; }
      .strip-label {
        font-size: 0.75rem; color: var(--secondary-text-color); margin-bottom: 6px;
      }
      .strip {
        position: relative; height: 14px; border-radius: 7px; overflow: hidden;
        background: var(--divider-color);
      }
      .strip.empty::after {
        content: attr(data-empty); position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 0.7rem; color: var(--secondary-text-color);
      }
      .seg { position: absolute; top: 0; bottom: 0; cursor: pointer; }
      .seg:hover { filter: brightness(1.1); }
      .strip-axis {
        display: flex; justify-content: space-between;
        font-size: 0.68rem; color: var(--secondary-text-color); margin-top: 4px;
      }

      .grid {
        display: grid; grid-template-columns: repeat(2, 1fr);
        gap: 1px; background: var(--divider-color);
        border-top: 1px solid var(--divider-color);
      }
      .panel {
        background: var(--card-background-color, var(--ha-card-background));
        padding: 12px 14px 6px; display: flex; flex-direction: column;
      }
      .panel.missing { opacity: 0.5; }
      .panel-head { display: flex; align-items: center; gap: 10px; cursor: pointer; }
      .panel.missing .panel-head { cursor: default; }
      .panel-icon {
        --mdc-icon-size: 24px; flex: 0 0 auto;
        color: var(--state-icon-color, var(--paper-item-icon-color));
      }
      .panel-head-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
      .panel-value { font-size: 1.25rem; font-weight: 500; line-height: 1.1; }
      .panel-value .unit {
        font-size: 0.75rem; font-weight: 400;
        color: var(--secondary-text-color); margin-left: 3px;
      }
      .panel-label { font-size: 0.75rem; color: var(--secondary-text-color); }
      .panel-minmax {
        display: flex; flex-direction: column; align-items: flex-end;
        font-size: 0.68rem; color: var(--secondary-text-color); line-height: 1.3;
      }
      .chart { width: 100%; margin-top: 4px; }

      .spark { display: block; width: 100%; }
      .spark-line {
        fill: none; stroke: var(--primary-color);
        stroke-width: 2; stroke-linejoin: round; stroke-linecap: round;
      }
      .spark-area { fill: var(--primary-color); opacity: 0.12; stroke: none; }
      .spark-end { fill: var(--primary-color); }
      .spark-cross {
        stroke: var(--secondary-text-color); stroke-width: 1;
        stroke-dasharray: 2 2; pointer-events: none;
      }
      .spark-dot {
        fill: var(--card-background-color); stroke: var(--primary-color);
        stroke-width: 2; pointer-events: none;
      }

      .tooltip {
        position: absolute; pointer-events: none; z-index: 10;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color); border-radius: 8px;
        padding: 6px 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        transition: opacity 0.1s ease; white-space: nowrap;
      }
      .tt-big { font-size: 0.95rem; font-weight: 600; }
      .tt-small { font-size: 0.72rem; color: var(--secondary-text-color); }
    `;
    return style;
  }
}

customElements.define("alpstuga-card-advanced", AlpstugaAdvancedCard);

/* -------------------------------------------------------------------------- */
/* Graphical config editor                                                    */
/* -------------------------------------------------------------------------- */

class AlpstugaAdvancedCardEditor extends HTMLElement {
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
        name: "hours",
        selector: { number: { min: 1, max: 168, mode: "box", unit_of_measurement: "h" } },
      },
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
      hours: "editor.hours",
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

customElements.define(
  "alpstuga-card-advanced-editor",
  AlpstugaAdvancedCardEditor
);

/* -------------------------------------------------------------------------- */
/* Card picker registration                                                   */
/* -------------------------------------------------------------------------- */

window.customCards = window.customCards || [];
window.customCards.push({
  type: "alpstuga-card-advanced",
  name: "IKEA ALPSTUGA Air Quality Card (Advanced)",
  description:
    "ALPSTUGA metrics with 24h history: an air-quality timeline and per-metric sparklines with hover tooltips.",
  preview: true,
  documentationURL: "https://github.com/oltdaniel/hass-ikea-alpstuga-cards",
});

// eslint-disable-next-line no-console
console.info(
  `%c ALPSTUGA-CARD-ADVANCED %c v${CARD_VERSION} `,
  "color: white; background: #0058a3; font-weight: 700;",
  "color: #0058a3; background: #ffdb00; font-weight: 700;"
);
