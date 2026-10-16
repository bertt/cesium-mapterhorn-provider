export const DEFAULT_GEOID_URL = "https://cdn.proj.org/us_nga_egm08_25.tif";

const TAG = {
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
  tiePoint: 33922,
};

const TYPE_SIZE = { 1: 1, 3: 2, 4: 4, 12: 8 };

async function inflate(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads EGM2008 geoid undulations (meters) from a Cloud Optimized GeoTIFF
 * (float32, deflate, floating point predictor, e.g. PROJ's us_nga_egm08_25.tif)
 * using HTTP Range requests, fetching only the tiles that are needed.
 */
export class GeoidSampler {
  constructor(options = {}) {
    this._url = options.url ?? DEFAULT_GEOID_URL;
    this._headers = options.headers;
    this._maxCachedTiles = options.maxCachedTiles ?? 128;
    this._cache = new Map(); // tile index -> Promise<Float32Array>
    this._info = undefined;
    this._infoSync = undefined;
    this._ready = new Map(); // tile index -> Float32Array (resolved)
  }

  async _range(start, end) {
    const res = await fetch(this._url, {
      headers: { ...this._headers, Range: `bytes=${start}-${end}` },
    });
    if (res.status !== 206 && !(res.status === 200 && start === 0)) {
      throw new Error(`Geoid request failed (${res.status}) for ${this._url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  _init() {
    if (!this._info) {
      this._info = this._readHeader().catch((e) => {
        this._info = undefined;
        throw e;
      });
    }
    return this._info;
  }

  async _readHeader() {
    let buf = await this._range(0, 16383);
    let dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint16(0, true) !== 0x4949 || dv.getUint16(2, true) !== 42) {
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
      const read = (k) =>
        type === 3 ? dv.getUint16(at + k * 2, true)
        : type === 4 ? dv.getUint32(at + k * 4, true)
        : type === 12 ? dv.getFloat64(at + k * 8, true)
        : dv.getUint8(at + k);
      tags[tag] = Array.from({ length: n }, (_, k) => read(k));
    }
    const one = (t) => tags[t]?.[0];
    if (one(TAG.compression) !== 8 || one(TAG.predictor) !== 3 ||
        one(TAG.bits) !== 32 || one(TAG.sampleFormat) !== 3 ||
        !tags[TAG.tileOffsets]) {
      throw new Error("Unsupported geoid GeoTIFF (need tiled float32, deflate, predictor 3)");
    }
    const width = one(TAG.width);
    const height = one(TAG.height);
    const tw = one(TAG.tileWidth);
    const th = one(TAG.tileHeight);
    return {
      width, height, tw, th,
      tilesAcross: Math.ceil(width / tw),
      offsets: tags[TAG.tileOffsets],
      counts: tags[TAG.tileByteCounts],
      dx: tags[TAG.pixelScale][0],
      dy: tags[TAG.pixelScale][1],
      ox: tags[TAG.tiePoint][3],
      oy: tags[TAG.tiePoint][4],
    };
  }

  _tile(info, index) {
    let p = this._cache.get(index);
    if (p) {
      this._cache.delete(index); // refresh LRU order
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
    const bytes = new Uint8Array(out.buffer); // little-endian host assumed
    for (let r = 0; r < th; r++) {
      const row = raw.subarray(r * tw * 4, (r + 1) * tw * 4);
      for (let i = 1; i < row.length; i++) row[i] = (row[i] + row[i - 1]) & 255;
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
    const loads = new Map();
    for (const lon of lons) {
      for (const lat of lats) {
        const x = Math.floor((lon - info.ox) / info.dx);
        const y = Math.floor((info.oy - lat) / info.dy);
        for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
          const px = ((cx % info.width) + info.width) % info.width;
          const py = Math.min(info.height - 1, Math.max(0, cy));
          const idx = Math.floor(py / info.th) * info.tilesAcross + Math.floor(px / info.tw);
          if (!loads.has(idx)) loads.set(idx, this._tile(info, idx));
        }
      }
    }
    await Promise.all(loads.values());
  }

  _pixel(info, x, y) {
    const px = ((x % info.width) + info.width) % info.width;
    const py = Math.min(info.height - 1, Math.max(0, y));
    const tile = this._ready.get(
      Math.floor(py / info.th) * info.tilesAcross + Math.floor(px / info.tw),
    );
    return tile?.[(py % info.th) * info.tw + (px % info.tw)];
  }
}

/**
 * Bilinear geoid undulation (m) at lon/lat in degrees. Call prepare() for the area first.
 * Returns undefined if the required tiles are not loaded.
 */
GeoidSampler.prototype.sample = function (lon, lat) {
  const info = this._infoSync;
  if (!info) return undefined;
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
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return undefined;
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
};

export default GeoidSampler;
