# IKEA ALPSTUGA Air Quality Cards

Two custom [Lovelace](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card)
cards for the IKEA **ALPSTUGA** (Matter air quality sensor, E2495):

- **`alpstuga-card`** — a compact card showing the current value of every metric.
- **`alpstuga-card-advanced`** — the same, plus 24h history: an air-quality
  timeline strip and per-metric sparklines with hover tooltips.
  See [Advanced card](#advanced-card).

## Basic card

Shows **every metric** the ALPSTUGA exposes to Home Assistant in a single, tidy card:

| Metric        | Unit    | Notes                                                     |
| ------------- | ------- | --------------------------------------------------------- |
| Air Quality   | –       | `good` → `extremely_poor`, shown as a colour-coded banner |
| CO₂           | ppm     | tile tinted by level                                      |
| PM2.5         | µg/m³   | tile tinted by level                                      |
| Temperature   | °C / °F | neutral tile                                              |
| Humidity      | %       | neutral tile                                              |

> The ALPSTUGA has **no VOC sensor** (unlike the older VINDSTYRKA), so tVOC is not shown.

Each tile is clickable and opens the entity's more-info dialog.

## Preview

```
┌────────────────────────────────────────────┐
│ 🙂  Living Room                             │
│     Good                                    │  ← colour-coded AQI banner
├──────────────────────┬─────────────────────┤
│ 🟢 CO₂    612 ppm    │ 🟢 PM2.5   4 µg/m³   │
├──────────────────────┼─────────────────────┤
│ 🌡 Temperature 21.4°C│ 💧 Humidity  46 %    │
└──────────────────────┴─────────────────────┘
```

## Installation

### HACS (recommended)

1. HACS → **⋮** → **Custom repositories**.
2. Add `https://github.com/oltdaniel/hass-ikea-alpstuga-cards` as a **Dashboard** (Lovelace) repository.
3. Install **IKEA ALPSTUGA Air Quality Cards**.
4. HACS registers the resource automatically. Reload your browser (Ctrl/Cmd-Shift-R).

Both `custom:alpstuga-card` and `custom:alpstuga-card-advanced` are registered via
the single `alpstuga-cards.js` entry file, so **no manual resource is needed**.

### Manual

1. Copy all three JS files (`alpstuga-cards.js`, `alpstuga-card.js`,
   `alpstuga-card-advanced.js`) into `config/www/` — keep them side by side, as
   `alpstuga-cards.js` imports the other two.
2. Add **one** dashboard resource — **Settings → Dashboards → ⋮ → Resources → Add**:
   - URL: `/local/alpstuga-cards.js`
   - Type: **JavaScript Module**
3. Hard-reload your browser.

> Only want one card? Add just that file (`/local/alpstuga-card.js` or
> `/local/alpstuga-card-advanced.js`) as the resource instead — each is standalone.

## Configuration

### Via the UI

Add a card → search **ALPSTUGA** → pick the card. In the visual editor, choose your
ALPSTUGA device; the entities are detected automatically.

### Via YAML

Simplest — auto-detect all entities from the device:

```yaml
type: custom:alpstuga-card
device: 1a2b3c4d5e6f...        # the ALPSTUGA device id
title: Living Room             # optional; defaults to the device name
```

With explicit entity overrides (any subset; overrides win over auto-detection):

```yaml
type: custom:alpstuga-card
device: 1a2b3c4d5e6f...
entities:
  air_quality: sensor.alpstuga_air_quality
  co2: sensor.alpstuga_carbon_dioxide
  pm25: sensor.alpstuga_pm2_5
  temperature: sensor.alpstuga_temperature
  humidity: sensor.alpstuga_humidity
```

You can also skip `device` entirely and configure everything through `entities`.

### Options

| Option     | Type   | Required            | Description                                                    |
| ---------- | ------ | ------------------- | -------------------------------------------------------------- |
| `device`   | string | one of `device`/`entities` | ALPSTUGA device id; auto-detects all entities by device_class. |
| `title`    | string | no                  | Header text. Defaults to the device name.                      |
| `entities` | map    | one of `device`/`entities` | Per-metric entity_id overrides: `air_quality`, `co2`, `pm25`, `temperature`, `humidity`. |

> **Finding the device id:** Settings → Devices → your ALPSTUGA → the id is the last
> path segment of the URL (`/config/devices/device/<device_id>`).

## How auto-detection works

Given a `device`, the card walks the entity registry for entities on that device and
classifies each by its `device_class`:

- `carbon_dioxide` → CO₂
- `pm25` → PM2.5
- `temperature` → Temperature
- `humidity` → Humidity
- an `enum` sensor whose state is one of the air-quality levels → Air Quality

Disabled and hidden entities are skipped. Any metric you set in `entities` overrides
the detected one.

## Colour thresholds

The AQI banner uses the device's reported state. Pollutant tiles are tinted locally:

| Level          | CO₂ (ppm) | PM2.5 (µg/m³) |
| -------------- | --------- | ------------- |
| good           | < 800     | < 12          |
| fair           | < 1000    | < 24          |
| moderate       | < 1400    | < 36          |
| poor           | < 2000    | < 50          |
| very poor      | ≥ 2000    | ≥ 50          |

Temperature and humidity are shown without alarm colouring.

## Advanced card

`alpstuga-card-advanced` adds 24-hour history on top of the basic layout:

- an **Air Quality timeline strip** — coloured status segments across the window,
  hover any segment for its state and time range;
- a **sparkline** under each numeric metric (CO₂, PM2.5, temperature, humidity)
  with ▼min / ▲max labels and a hover crosshair + tooltip.

History is fetched from Home Assistant's `history/history_during_period` websocket
command and refreshed every 5 minutes. It shares the basic card's config plus a
`hours` option:

```yaml
type: custom:alpstuga-card-advanced
device: 1a2b3c4d5e6f...
title: Living Room
hours: 24                 # optional history window, 1–168 (default 24)
```

`device`, `title`, and `entities` behave exactly as in the basic card; the same
auto-detection applies.

| Option     | Type   | Required                   | Description                              |
| ---------- | ------ | -------------------------- | ---------------------------------------- |
| `device`   | string | one of `device`/`entities` | ALPSTUGA device id (auto-detect).        |
| `title`    | string | no                         | Header text. Defaults to the device name.|
| `hours`    | number | no                         | History window in hours (1–168, default 24). |
| `entities` | map    | one of `device`/`entities` | Per-metric entity_id overrides.          |

> History depends on Home Assistant's recorder keeping these entities. If a chart is
> empty, check that the entity isn't excluded from `recorder` and that enough time
> has passed to accumulate data.

## License

MIT
