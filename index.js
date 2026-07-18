/**
 * IKEA ALPSTUGA Air Quality Cards — HACS entry point.
 *
 * HACS (and any Lovelace `module` resource) loads a single file. This entry
 * imports both cards so registering just this one resource makes both
 * `custom:alpstuga-card` and `custom:alpstuga-card-advanced` available.
 *
 * The imports are relative, so they resolve to the sibling files served
 * alongside this one (e.g. /hacsfiles/<repo>/ or /local/).
 */

import "./alpstuga-card.js";
import "./alpstuga-card-advanced.js";
