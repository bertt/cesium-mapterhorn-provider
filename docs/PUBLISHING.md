# Publishing

CesiumJS plugins are distributed as npm packages; the "web store" for JavaScript is the npm registry (CDNs such as unpkg and jsDelivr serve from it automatically).

## 1. Prepare

1. The package is published under the `@bertt` scope: `@bertt/cesium-mapterhorn-provider` (your npm username must be `bertt`, or you must own the `bertt` org).
2. Set `version` (semver) and check `repository`, `author` and `license` in `package.json`.
3. Build: `npm install && npm run build`.
4. Check the package contents: `npm pack --dry-run` (should list `dist/`, `src/`, `README.md`).

## 2. Publish to npm

```bash
npm login
npm publish --access public      # scoped packages need --access public (also set in publishConfig)
```

Subsequent releases: `npm version patch|minor|major && npm publish`.

## 3. Use from a CDN (automatic after npm publish)

```html
<script src="https://cesium.com/downloads/cesiumjs/releases/1.146/Build/Cesium/Cesium.js"></script>
<script src="https://unpkg.com/@bertt/cesium-mapterhorn-provider/dist/cesium-mapterhorn-provider.min.js"></script>
<script>
  const viewer = new Cesium.Viewer("cesiumContainer", {
    terrainProvider: new CesiumMapterhorn.MapterhornTerrainProvider(),
  });
</script>
```

## 4. Alternative: GitHub Packages

Set `"publishConfig": { "registry": "https://npm.pkg.github.com" }` (the name is already scoped as `@bertt/...`), then `npm login --registry=https://npm.pkg.github.com` and `npm publish`.

## 5. Visibility

- Add GitHub topics `cesium`, `cesiumjs`, `terrain`.
- Announce in the [Cesium community forum](https://community.cesium.com/).
