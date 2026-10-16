# cesium-mapterhorn-provider

A [CesiumJS](https://cesium.com/cesiumjs/) terrain provider for [Mapterhorn](https://mapterhorn.com/) tiles.

[![npm](https://img.shields.io/npm/v/@bertt/cesium-mapterhorn-provider)](https://www.npmjs.com/package/@bertt/cesium-mapterhorn-provider)

**[Live demo](https://bertt.github.io/cesium-mapterhorn-provider/)** – Mapterhorn terrain in 3D with CesiumJS.

<img width="1301" height="942" alt="image" src="https://github.com/user-attachments/assets/fc85521c-fd53-4f82-93a6-de44fe4419ff" />

**[Sample: Mapterhorn terrain + GEBCO bathymetry](https://bertt.github.io/cesium-mapterhorn-provider/samples/bathymetry.html)** – land from Mapterhorn, seabed colour map from GEBCO (source: [`samples/bathymetry.html`](samples/bathymetry.html)).

<img width="1298" height="876" alt="image" src="https://github.com/user-attachments/assets/6bcea38f-bbf2-4b4c-8db4-e1726887d5af" />

npm package: <https://www.npmjs.com/package/@bertt/cesium-mapterhorn-provider>

**[Sample: geoid vs. ellipsoid heights](https://bertt.github.io/cesium-mapterhorn-provider/samples/ellipsoid.html)** – toggle `verticalReference` and compare the terrain against a reference plane at ellipsoid height 0 m (source: [`samples/ellipsoid.html`](samples/ellipsoid.html)). Run locally with `npm start` and open <http://localhost:8080/samples/ellipsoid.html>.

Mapterhorn serves global elevation as **Terrarium-encoded** 512 px WebP tiles in the XYZ / Web Mercator scheme:

```
height (m) = R * 256 + G + B / 256 - 32768
```

The provider downloads each tile, decodes the heights, resamples them to a (configurable) heightmap grid and hands them to Cesium.

## Install

```bash
npm install @bertt/cesium-mapterhorn-provider cesium
```

## Usage

### ES module

```js
import { Viewer, ImageryLayer, OpenStreetMapImageryProvider } from "cesium";
import { MapterhornTerrainProvider } from "@bertt/cesium-mapterhorn-provider";

const viewer = new Viewer("cesiumContainer", {
  baseLayer: new ImageryLayer(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })),
  terrainProvider: new MapterhornTerrainProvider({
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", // configurable
  }),
});
```

### Script tag (global build)

```html
<script src="https://cesium.com/downloads/cesiumjs/releases/1.146/Build/Cesium/Cesium.js"></script>
<script src="dist/cesium-mapterhorn-provider.min.js"></script>
<script>
  const viewer = new Cesium.Viewer("cesiumContainer", {
    terrainProvider: new CesiumMapterhorn.MapterhornTerrainProvider(),
  });
</script>
```

The global build requires `window.Cesium` to be loaded first.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `url` | `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` | URL template with `{z}`, `{x}`, `{y}` (point it at a self-hosted mirror if you like). |
| `maxLevel` | `17` | Highest zoom level available. Deeper levels are upsampled by Cesium. |
| `heightmapResolution` | `65` | Vertices per tile side (use `2^n + 1`: 33, 65, 129). Higher = more detail, more CPU/memory. |
| `credit` | `"Mapterhorn"` | Attribution shown in the viewer. |
| `headers` | – | Extra HTTP request headers. |
| `ellipsoid` | `Ellipsoid.WGS84` | Ellipsoid. |
| `verticalReference` | `"geoid"` | `"geoid"`: Mapterhorn heights unchanged (orthometric, above EGM2008 geoid). `"ellipsoid"`: add the EGM2008 geoid undulation → WGS84 ellipsoidal heights. See below. |
| `geoidUrl` | `https://cdn.proj.org/us_nga_egm08_25.tif` | Geoid grid (float32 COG) used when `verticalReference: "ellipsoid"`. |

## Vertical reference (geoid vs. ellipsoid)

Mapterhorn heights are **orthometric** (above the EGM2008 geoid / mean sea level), while Cesium draws the globe on the **WGS84 ellipsoid**. The two differ by the geoid undulation `N` (roughly −106 m … +85 m; ≈ +45 m in the Netherlands), so terrain can appear tens of metres too low or high compared to ellipsoid-referenced data (GNSS, 3D Tiles, ...).

By default nothing is changed. To convert on the fly (same approach as [reearth-terrain](https://github.com/reearth/reearth-terrain)):

```js
new MapterhornTerrainProvider({ verticalReference: "ellipsoid" });
```

`ellipsoidal height = Mapterhorn height + N(lon, lat)`. `N` is read from the EGM2008 2.5′ grid ([PROJ CDN](https://cdn.proj.org/), `us_nga_egm08_25.tif`, ~80 MB) using HTTP Range requests, so only the small grid tiles near the visible terrain are downloaded and cached (LRU). Per terrain tile `N` is sampled on a 9×9 grid and bilinearly interpolated, since the geoid is very smooth. The file must be served with CORS and Range support (the PROJ CDN does); otherwise host a copy and set `geoidUrl`. If the grid cannot be loaded, the tile request fails and the provider's `errorEvent` fires.

Note: with the default `"geoid"` the terrain does not sit on the ellipsoid; use `"ellipsoid"` when combining the terrain with ellipsoid-referenced data.

## Build

Requires Node.js 18+.

```bash
npm install
npm run build
```

Output in `dist/`:

- `cesium-mapterhorn-provider.esm.js` / `.esm.min.js` – ES module (imports `cesium`)
- `cesium-mapterhorn-provider.min.js` – browser global `CesiumMapterhorn` (uses `window.Cesium`)

## Run the demo

```bash
npm run build
npm start
```

Open <http://localhost:8080/index.html> – a 3D view of the Matterhorn using Mapterhorn terrain.

## Publishing

See [docs/PUBLISHING.md](docs/PUBLISHING.md) (npm registry, GitHub Packages, CDN).

## Attribution & license

Terrain data © [Mapterhorn](https://mapterhorn.com/attribution/) and its source data providers – please follow their attribution and usage terms. Code: MIT.
