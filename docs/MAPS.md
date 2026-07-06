# Orignals Maps — Open Source Now, Our Own Simultaneously

Same strategy as Mitra Brain: ship on open source at ₹0, and let every
user interaction build the asset we'll own.

## Phase 1 — TODAY (shipped, ₹0/month, no API keys)
- **Display:** Leaflet + OpenStreetMap tiles (already live in rides,
  send, delivery tracking; in-house SVG map engine as offline fallback).
  Tile URL lives in `config.js → map.tileUrl` — the entire app switches
  basemap with one line.
- **Search:** `js/geo.js` — address search across all of India.
  Our `geo_places` database is queried FIRST; OSM Nominatim fills gaps.
- **The flywheel:** every address anyone searches, picks, or delivers
  to is upserted into `geo_places` with a popularity counter
  (`supabase/geo_schema.sql`). This is hyperlocal POI data — the exact
  kirana, the blue-gate house, the temple-lane pickup point — that no
  map vendor sells for India. Ranking improves automatically with use.

## Phase 2 — OUR OWN BASEMAP (when we want vendor independence)
- Build an India extract with **Protomaps / OpenMapTiles**: one static
  `.pmtiles` file (~2–3 GB, one-time build from OSM data).
- Host it on any static CDN (Cloudflare R2 free tier works). Cost:
  ~₹0–500/month flat, zero per-request pricing forever.
- Switch: `config.js → map.tileUrl` to our CDN. Done — every map in
  the app renders from OUR tiles.

## Phase 3 — OUR OWN ROUTING + GEOCODER (delivery-grade)
- **Routing/ETA:** self-host **OSRM** or **Valhalla** (open source)
  with the India OSM extract — docker on a small VPS (~$10–20/month).
  Gives real road routes, ETAs and distance for partner dispatch,
  replacing straight-line estimates.
- **Geocoder:** our `geo_places` becomes the primary geocoder — by
  then it holds addresses as *users actually say them* ("Sharma kirana
  ke peeche wali gali"), which beats any formal geocoder for India.
  Optionally add **Pelias/Photon** (open source) over OSM for coverage.

## Cost trajectory
| Stage | Monthly | Stack |
|---|---|---|
| Now | ₹0 | Leaflet + OSM tiles + Nominatim + our geo_places |
| Own basemap | ~₹0–500 flat | Protomaps .pmtiles on CDN |
| Delivery-grade | ~₹800–1600 flat | + self-hosted OSRM/Valhalla routing |

Never: per-request map billing.
