import {
  Credit,
  Event,
  HeightmapTerrainData,
  Resource,
  TerrainProvider,
  WebMercatorTilingScheme,
  Ellipsoid,
} from "cesium";

export const DEFAULT_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

/**
 * Decodes Terrarium RGB to meters: (R * 256 + G + B / 256) - 32768
 */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

function createCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * CesiumJS terrain provider for Mapterhorn Terrarium-encoded WebP tiles.
 *
 * @param {object} [options]
 * @param {string} [options.url] URL template with {z}, {x}, {y}.
 * @param {number} [options.maxLevel=17] Highest zoom level served.
 * @param {number} [options.heightmapResolution=65] Grid size (vertices per side) of the
 *   heightmap generated for each tile. Use 2^n + 1 (e.g. 33, 65, 129).
 * @param {Ellipsoid} [options.ellipsoid]
 * @param {Credit|string} [options.credit]
 * @param {object} [options.headers] Extra request headers.
 */
export class MapterhornTerrainProvider {
  constructor(options = {}) {
    this._url = options.url ?? DEFAULT_URL;
    this._maxLevel = options.maxLevel ?? 17;
    this._resolution = options.heightmapResolution ?? 65;
    this._headers = options.headers;
    this._tilingScheme = new WebMercatorTilingScheme({
      ellipsoid: options.ellipsoid ?? Ellipsoid.WGS84,
    });
    this._levelZeroError =
      TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
        this._tilingScheme.ellipsoid,
        this._resolution,
        this._tilingScheme.getNumberOfXTilesAtLevel(0),
      );
    const credit = options.credit ?? "Mapterhorn";
    this._credit = typeof credit === "string" ? new Credit(credit) : credit;
    this._errorEvent = new Event();
  }

  get errorEvent() { return this._errorEvent; }
  get credit() { return this._credit; }
  get tilingScheme() { return this._tilingScheme; }
  get hasWaterMask() { return false; }
  get hasVertexNormals() { return false; }
  get availability() { return undefined; }

  getLevelMaximumGeometricError(level) {
    return this._levelZeroError / (1 << level);
  }

  getTileDataAvailable(x, y, level) {
    return level <= this._maxLevel;
  }

  loadTileDataAvailability() {
    return undefined;
  }

  async requestTileGeometry(x, y, level, request) {
    if (level > this._maxLevel) return undefined;

    const resource = new Resource({
      url: this._url
        .replace("{z}", level)
        .replace("{x}", x)
        .replace("{y}", y),
      headers: this._headers,
      request,
    });

    const promise = resource.fetchBlob();
    if (!promise) return undefined; // request throttled; Cesium will retry
    const blob = await promise;

    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const size = bitmap.width;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const pixels = ctx.getImageData(0, 0, size, size).data;

    const n = this._resolution;
    const heights = new Float32Array(n * n);
    const last = size - 1;
    const height = (px, py) => {
      const i = (py * size + px) * 4;
      return decodeTerrarium(pixels[i], pixels[i + 1], pixels[i + 2]);
    };

    // Bilinear resample of the 512px tile onto an n x n grid whose
    // edge vertices lie on the tile borders.
    for (let j = 0; j < n; j++) {
      const fy = (j / (n - 1)) * last;
      const y0 = Math.floor(fy);
      const y1 = Math.min(y0 + 1, last);
      const ty = fy - y0;
      for (let i = 0; i < n; i++) {
        const fx = (i / (n - 1)) * last;
        const x0 = Math.floor(fx);
        const x1 = Math.min(x0 + 1, last);
        const tx = fx - x0;
        const top = height(x0, y0) * (1 - tx) + height(x1, y0) * tx;
        const bottom = height(x0, y1) * (1 - tx) + height(x1, y1) * tx;
        heights[j * n + i] = top * (1 - ty) + bottom * ty;
      }
    }

    return new HeightmapTerrainData({
      buffer: heights,
      width: n,
      height: n,
      childTileMask: level < this._maxLevel ? 15 : 0,
    });
  }
}

export default MapterhornTerrainProvider;
