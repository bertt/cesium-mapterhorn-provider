// src/MapterhornTerrainProvider.js
import {
  Credit,
  Event,
  HeightmapTerrainData,
  Resource,
  TerrainProvider,
  WebMercatorTilingScheme,
  Ellipsoid,
  WebMercatorProjection,
  Math as CesiumMath
} from "cesium";

// src/GeoidSampler.js
var DEFAULT_GEOID_URL = "https://cdn.proj.org/us_nga_egm08_25.tif";
var TAG = {
  width: 256,
  height: 257,
  bits: 258,
  compression: 259,
  tileWidth: 322,
  tileHeight: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  predictor: 317,
  sampleFormat: 339,
  pixelScale: 33550,
  tiePoint: 33922
};
var TYPE_SIZE = { 1: 1, 3: 2, 4: 4, 12: 8 };
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
var GeoidSampler = class {
  constructor(options = {}) {
    this._url = options.url ?? DEFAULT_GEOID_URL;
    this._headers = options.headers;
    this._maxCachedTiles = options.maxCachedTiles ?? 128;
    this._cache = /* @__PURE__ */ new Map();
    this._info = void 0;
    this._infoSync = void 0;
    this._ready = /* @__PURE__ */ new Map();
  }
  async _range(start, end) {
    const res = await fetch(this._url, {
      headers: { ...this._headers, Range: `bytes=${start}-${end}` }
    });
    if (res.status !== 206 && !(res.status === 200 && start === 0)) {
      throw new Error(`Geoid request failed (${res.status}) for ${this._url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  _init() {
    if (!this._info) {
      this._info = this._readHeader().catch((e) => {
        this._info = void 0;
        throw e;
      });
    }
    return this._info;
  }
  async _readHeader() {
    let buf = await this._range(0, 16383);
    let dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint16(0, true) !== 18761 || dv.getUint16(2, true) !== 42) {
      throw new Error("Geoid file must be a little-endian classic GeoTIFF");
    }
    const ifd = dv.getUint32(4, true);
    const count = dv.getUint16(ifd, true);
    const tags = {};
    for (let i = 0; i < count; i++) {
      const p = ifd + 2 + i * 12;
      const tag = dv.getUint16(p, true);
      const type = dv.getUint16(p + 2, true);
      const n = dv.getUint32(p + 4, true);
      const size = (TYPE_SIZE[type] ?? 1) * n;
      const at = size <= 4 ? p + 8 : dv.getUint32(p + 8, true);
      if (at + size > buf.length) {
        buf = await this._range(0, at + size);
        dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      }
      const read = (k) => type === 3 ? dv.getUint16(at + k * 2, true) : type === 4 ? dv.getUint32(at + k * 4, true) : type === 12 ? dv.getFloat64(at + k * 8, true) : dv.getUint8(at + k);
      tags[tag] = Array.from({ length: n }, (_, k) => read(k));
    }
    const one = (t) => tags[t]?.[0];
    if (one(TAG.compression) !== 8 || one(TAG.predictor) !== 3 || one(TAG.bits) !== 32 || one(TAG.sampleFormat) !== 3 || !tags[TAG.tileOffsets]) {
      throw new Error("Unsupported geoid GeoTIFF (need tiled float32, deflate, predictor 3)");
    }
    const width = one(TAG.width);
    const height = one(TAG.height);
    const tw = one(TAG.tileWidth);
    const th = one(TAG.tileHeight);
    return {
      width,
      height,
      tw,
      th,
      tilesAcross: Math.ceil(width / tw),
      offsets: tags[TAG.tileOffsets],
      counts: tags[TAG.tileByteCounts],
      dx: tags[TAG.pixelScale][0],
      dy: tags[TAG.pixelScale][1],
      ox: tags[TAG.tiePoint][3],
      oy: tags[TAG.tiePoint][4]
    };
  }
  _tile(info, index) {
    let p = this._cache.get(index);
    if (p) {
      this._cache.delete(index);
      this._cache.set(index, p);
      return p;
    }
    p = this._loadTile(info, index);
    p.then((v) => this._ready.set(index, v), () => this._cache.delete(index));
    this._cache.set(index, p);
    if (this._cache.size > this._maxCachedTiles) {
      const old = this._cache.keys().next().value;
      this._cache.delete(old);
      this._ready.delete(old);
    }
    return p;
  }
  async _loadTile(info, index) {
    const start = info.offsets[index];
    const raw = await inflate(await this._range(start, start + info.counts[index] - 1));
    const { tw, th } = info;
    const out = new Float32Array(tw * th);
    const bytes = new Uint8Array(out.buffer);
    for (let r = 0; r < th; r++) {
      const row = raw.subarray(r * tw * 4, (r + 1) * tw * 4);
      for (let i = 1; i < row.length; i++) row[i] = row[i] + row[i - 1] & 255;
      for (let i = 0; i < tw; i++) {
        const o = (r * tw + i) * 4;
        bytes[o] = row[3 * tw + i];
        bytes[o + 1] = row[2 * tw + i];
        bytes[o + 2] = row[tw + i];
        bytes[o + 3] = row[i];
      }
    }
    return out;
  }
  /**
   * Loads the geoid tiles needed by sample() for the given points (degrees),
   * so sample() can afterwards be used synchronously.
   */
  async prepare(lons, lats) {
    const info = await this._init();
    this._infoSync = info;
    const loads = /* @__PURE__ */ new Map();
    for (const lon of lons) {
      for (const lat of lats) {
        const x = Math.floor((lon - info.ox) / info.dx);
        const y = Math.floor((info.oy - lat) / info.dy);
        for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
          const px = (cx % info.width + info.width) % info.width;
          const py = Math.min(info.height - 1, Math.max(0, cy));
          const idx = Math.floor(py / info.th) * info.tilesAcross + Math.floor(px / info.tw);
          if (!loads.has(idx)) loads.set(idx, this._tile(info, idx));
        }
      }
    }
    await Promise.all(loads.values());
  }
  _pixel(info, x, y) {
    const px = (x % info.width + info.width) % info.width;
    const py = Math.min(info.height - 1, Math.max(0, y));
    const tile = this._ready.get(
      Math.floor(py / info.th) * info.tilesAcross + Math.floor(px / info.tw)
    );
    return tile?.[py % info.th * info.tw + px % info.tw];
  }
};
GeoidSampler.prototype.sample = function(lon, lat) {
  const info = this._infoSync;
  if (!info) return void 0;
  const fx = (lon - info.ox) / info.dx;
  const fy = Math.min(info.height - 1, Math.max(0, (info.oy - lat) / info.dy));
  const x = Math.floor(fx);
  const y = Math.min(info.height - 2, Math.floor(fy));
  const tx = fx - x;
  const ty = fy - y;
  const a = this._pixel(info, x, y);
  const b = this._pixel(info, x + 1, y);
  const c = this._pixel(info, x, y + 1);
  const d = this._pixel(info, x + 1, y + 1);
  if (a === void 0 || b === void 0 || c === void 0 || d === void 0) {
    return void 0;
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
};

// src/MapterhornTerrainProvider.js
var DEFAULT_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}
function createCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
var MapterhornTerrainProvider = class {
  constructor(options = {}) {
    this._url = options.url ?? DEFAULT_URL;
    this._maxLevel = options.maxLevel ?? 17;
    this._resolution = options.heightmapResolution ?? 65;
    this._headers = options.headers;
    const ref = options.verticalReference ?? "geoid";
    if (ref !== "geoid" && ref !== "ellipsoid") {
      throw new Error('verticalReference must be "geoid" or "ellipsoid"');
    }
    this._geoid = ref === "ellipsoid" ? new GeoidSampler({ url: options.geoidUrl ?? DEFAULT_GEOID_URL }) : void 0;
    this._tilingScheme = new WebMercatorTilingScheme({
      ellipsoid: options.ellipsoid ?? Ellipsoid.WGS84
    });
    this._levelZeroError = TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
      this._tilingScheme.ellipsoid,
      this._resolution,
      this._tilingScheme.getNumberOfXTilesAtLevel(0)
    );
    const credit = options.credit ?? "Mapterhorn";
    this._credit = typeof credit === "string" ? new Credit(credit) : credit;
    this._errorEvent = new Event();
  }
  get errorEvent() {
    return this._errorEvent;
  }
  get credit() {
    return this._credit;
  }
  get tilingScheme() {
    return this._tilingScheme;
  }
  get hasWaterMask() {
    return false;
  }
  get hasVertexNormals() {
    return false;
  }
  get availability() {
    return void 0;
  }
  getLevelMaximumGeometricError(level) {
    return this._levelZeroError / (1 << level);
  }
  getTileDataAvailable(x, y, level) {
    return level <= this._maxLevel;
  }
  loadTileDataAvailability() {
    return void 0;
  }
  // Coarse geoid grid over the tile (the geoid is smooth); returns a bilinear fn of tile-relative u,v.
  async _undulationGrid(x, y, level) {
    const m = 9;
    const scheme = this._tilingScheme;
    const rect = scheme.tileXYToNativeRectangle(x, y, level);
    const radius = scheme.ellipsoid.maximumRadius;
    const lons = [];
    const lats = [];
    for (let k = 0; k < m; k++) {
      const f = k / (m - 1);
      lons.push(CesiumMath.toDegrees((rect.west + f * (rect.east - rect.west)) / radius));
      const my = rect.north - f * (rect.north - rect.south);
      lats.push(
        CesiumMath.toDegrees(WebMercatorProjection.mercatorAngleToGeodeticLatitude(my / radius))
      );
    }
    try {
      await this._geoid.prepare(lons, lats);
    } catch (e) {
      this._errorEvent.raiseEvent(e);
      throw e;
    }
    const grid = new Float32Array(m * m);
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) {
        grid[r * m + c] = this._geoid.sample(lons[c], lats[r]) ?? 0;
      }
    }
    return (u, v) => {
      const fx = u * (m - 1);
      const fy = v * (m - 1);
      const c0 = Math.min(Math.floor(fx), m - 2);
      const r0 = Math.min(Math.floor(fy), m - 2);
      const tx = fx - c0;
      const ty = fy - r0;
      const g = (r, c) => grid[r * m + c];
      return (g(r0, c0) * (1 - tx) + g(r0, c0 + 1) * tx) * (1 - ty) + (g(r0 + 1, c0) * (1 - tx) + g(r0 + 1, c0 + 1) * tx) * ty;
    };
  }
  async requestTileGeometry(x, y, level, request) {
    if (level > this._maxLevel) return void 0;
    const resource = new Resource({
      url: this._url.replace("{z}", level).replace("{x}", x).replace("{y}", y),
      headers: this._headers,
      request
    });
    const promise = resource.fetchBlob();
    if (!promise) return void 0;
    const blob = await promise;
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none"
    });
    const size = bitmap.width;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const n = this._resolution;
    const undulation = this._geoid ? await this._undulationGrid(x, y, level) : void 0;
    const heights = new Float32Array(n * n);
    const last = size - 1;
    const height = (px, py) => {
      const i = (py * size + px) * 4;
      return decodeTerrarium(pixels[i], pixels[i + 1], pixels[i + 2]);
    };
    for (let j = 0; j < n; j++) {
      const fy = j / (n - 1) * last;
      const y0 = Math.floor(fy);
      const y1 = Math.min(y0 + 1, last);
      const ty = fy - y0;
      for (let i = 0; i < n; i++) {
        const fx = i / (n - 1) * last;
        const x0 = Math.floor(fx);
        const x1 = Math.min(x0 + 1, last);
        const tx = fx - x0;
        const top = height(x0, y0) * (1 - tx) + height(x1, y0) * tx;
        const bottom = height(x0, y1) * (1 - tx) + height(x1, y1) * tx;
        heights[j * n + i] = top * (1 - ty) + bottom * ty;
        if (undulation) heights[j * n + i] += undulation(i / (n - 1), j / (n - 1));
      }
    }
    return new HeightmapTerrainData({
      buffer: heights,
      width: n,
      height: n,
      childTileMask: level < this._maxLevel ? 15 : 0
    });
  }
};
var MapterhornTerrainProvider_default = MapterhornTerrainProvider;
export {
  DEFAULT_URL,
  MapterhornTerrainProvider,
  decodeTerrarium,
  MapterhornTerrainProvider_default as default
};
//# sourceMappingURL=cesium-mapterhorn-provider.esm.js.map
