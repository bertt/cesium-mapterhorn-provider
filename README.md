# cesium-mapterhorn-provider

A [CesiumJS](https://cesium.com/cesiumjs/) terrain provider for [Mapterhorn](https://mapterhorn.com/) tiles.

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
