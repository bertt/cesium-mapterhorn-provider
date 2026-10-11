import { build } from "esbuild";

// Maps `import ... from "cesium"` to the global `Cesium` in the IIFE build.
const cesiumGlobal = {
  name: "cesium-global",
  setup(b) {
    b.onResolve({ filter: /^cesium$/ }, () => ({ path: "cesium", namespace: "cesium-global" }));
    b.onLoad({ filter: /.*/, namespace: "cesium-global" }, () => ({
      contents: "module.exports = window.Cesium;",
      loader: "js",
    }));
  },
};

const common = { entryPoints: ["src/MapterhornTerrainProvider.js"], bundle: true, sourcemap: true };

await build({ ...common, format: "esm", external: ["cesium"], outfile: "dist/cesium-mapterhorn-provider.esm.js" });
await build({ ...common, format: "esm", external: ["cesium"], minify: true, outfile: "dist/cesium-mapterhorn-provider.esm.min.js" });
await build({
  ...common,
  format: "iife",
  globalName: "CesiumMapterhorn",
  plugins: [cesiumGlobal],
  minify: true,
  outfile: "dist/cesium-mapterhorn-provider.min.js",
});
console.log("Build complete: dist/");
