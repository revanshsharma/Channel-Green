/**
 * Renders PNG previews so contributors can see their content without starting the game.
 *   npm run content:preview -- map town-square out.png [scale]
 *   npm run content:preview -- avatars out.png [scale]      (a grid of random avatars, walking down/up/left/right)
 *   npm run content:preview -- tiles out.png [scale]
 *   npm run content:preview -- furniture out.png [scale]
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PixelBuffer, TILE, renderTile, renderFurniture, renderAvatarFrames, randomAvatar, FRAME_W, FRAME_H, hexToRgba, type MapDef, type Registry } from '@channel-green/shared';
import { registry } from '../src/index';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(b: PixelBuffer, scale = 1): Buffer {
  const w = b.w * scale, h = b.h * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const si = (Math.floor(y / scale) * b.w + Math.floor(x / scale)) * 4;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) raw[di + k] = b.data[si + k];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

export function renderMap(map: MapDef, reg: Registry): PixelBuffer {
  const rows = map.tiles.rows.length, cols = Math.max(...map.tiles.rows.map((r) => r.length));
  const buf = new PixelBuffer(cols * TILE, rows * TILE);
  buf.rect(0, 0, buf.w, buf.h, map.background ?? '#000000');
  const cache = new Map<string, PixelBuffer>();
  map.tiles.rows.forEach((row, y) => {
    for (let x = 0; x < cols; x++) {
      const id = map.tiles.legend[row[x]];
      const def = reg.tiles[id];
      if (!def) continue;
      const key = `${id}:${(x * 3 + y * 5) % 3}`;
      if (!cache.has(key)) cache.set(key, renderTile(def, (x * 3 + y * 5) % 3));
      buf.blit(cache.get(key)!, x * TILE, y * TILE);
    }
  });
  const objs = map.objects.map((o) => ({ o, f: reg.furniture[o.furniture] }));
  objs.sort((a, b) => Number(!!b.f.flat) - Number(!!a.f.flat) || a.o.at[1] + a.f.size[1] + (a.o.depth ?? 0) - (b.o.at[1] + b.f.size[1] + (b.o.depth ?? 0)));
  for (const { o, f } of objs) buf.blit(renderFurniture(f), o.at[0], o.at[1]);
  for (const p of map.portals) {
    const [x, y, w, h] = p.rect;
    for (let i = 0; i < w * TILE; i += 2) { buf.set(x * TILE + i, y * TILE, '#9dff6a'); buf.set(x * TILE + i, (y + h) * TILE - 1, '#9dff6a'); }
  }
  for (const [, [x, y]] of Object.entries(map.spawns)) buf.rect(x * TILE + 6, y * TILE + 6, 4, 4, '#ff3b3b');
  if (map.tint) {
    const [r, g, b] = hexToRgba(map.tint.color);
    for (let i = 0; i < buf.data.length; i += 4) {
      buf.data[i] = buf.data[i] * (1 - map.tint.alpha) + r * map.tint.alpha;
      buf.data[i + 1] = buf.data[i + 1] * (1 - map.tint.alpha) + g * map.tint.alpha;
      buf.data[i + 2] = buf.data[i + 2] * (1 - map.tint.alpha) + b * map.tint.alpha;
    }
  }
  return buf;
}

if (process.argv[1]?.endsWith('preview.ts')) {
  const [kind, ...rest] = process.argv.slice(2);
  let buf: PixelBuffer;
  let out: string, scale = 3;
  if (kind === 'map') {
    out = rest[1]; scale = Number(rest[2] ?? 2);
    const m = registry.maps[rest[0]];
    if (!m) throw new Error('unknown map ' + rest[0]);
    buf = renderMap(m, registry);
  } else if (kind === 'avatars') {
    out = rest[0]; scale = Number(rest[1] ?? 4);
    const n = 24;
    const per = 4; // 4 directions side by side, 4 avatars per row
    buf = new PixelBuffer(per * FRAME_W * 4, Math.ceil(n / per) * FRAME_H);
    buf.rect(0, 0, buf.w, buf.h, '#2f5a36');
    for (let i = 0; i < n; i++) {
      const f = renderAvatarFrames(randomAvatar(registry.avatar, i + 1), registry.avatar);
      const ox = (i % per) * FRAME_W * 4, oy = Math.floor(i / per) * FRAME_H;
      (['down', 'up', 'left', 'right'] as const).forEach((d, k) => buf.blit(f[`${d}-walk1`], ox + k * FRAME_W, oy));
    }
  } else if (kind === 'tiles') {
    out = rest[0]; scale = Number(rest[1] ?? 4);
    const ids = Object.keys(registry.tiles);
    buf = new PixelBuffer(6 * 3 * TILE, Math.ceil(ids.length / 6) * TILE);
    ids.forEach((id, i) => { for (let v = 0; v < 3; v++) buf.blit(renderTile(registry.tiles[id], v), ((i % 6) * 3 + v) * TILE, Math.floor(i / 6) * TILE); });
  } else if (kind === 'furniture') {
    out = rest[0]; scale = Number(rest[1] ?? 2);
    const items = Object.values(registry.furniture);
    let x = 4, y = 4, rowH = 0;
    buf = new PixelBuffer(640, 760);
    buf.rect(0, 0, buf.w, buf.h, '#3a5a44');
    for (const f of items) {
      if (x + f.size[0] + 4 > buf.w) { x = 4; y += rowH + 4; rowH = 0; }
      buf.blit(renderFurniture(f), x, y);
      x += f.size[0] + 4; rowH = Math.max(rowH, f.size[1]);
    }
  } else throw new Error('usage: preview.ts map <id> <out.png> | avatars <out.png> | tiles <out.png> | furniture <out.png>');
  writeFileSync(out, encodePng(buf, scale));
  console.log('wrote ' + out);
}
