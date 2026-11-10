/**
 * Reads every pack under packages/content/packs, validates it and writes generated/registry.json.
 *   npm run content:build   writes the registry
 *   npm run content:check   fails if a pack is invalid or the committed registry is out of date
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePacks, type RawPack } from '../src/merge';

const here = dirname(fileURLToPath(import.meta.url));
const packsDir = join(here, '..', 'packs');
const outFile = join(here, '..', 'generated', 'registry.json');

function walk(dir: string, base: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (name.endsWith('.json')) out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

export function loadPacks(): RawPack[] {
  return readdirSync(packsDir)
    .sort()
    .filter((d) => statSync(join(packsDir, d)).isDirectory())
    .map((d) => {
      const files: Record<string, unknown> = {};
      for (const f of walk(join(packsDir, d), join(packsDir, d))) {
        try {
          files[f] = JSON.parse(readFileSync(join(packsDir, d, f), 'utf8'));
        } catch (e) {
          throw new Error(`${d}/${f} is not valid JSON: ${(e as Error).message}`);
        }
      }
      return { dir: d, files };
    });
}

const check = process.argv.includes('--check');
const { registry, errors } = mergePacks(loadPacks());
if (errors.length) {
  console.error(`Content has ${errors.length} problem(s):`);
  for (const e of errors.slice(0, 60)) console.error('  - ' + e);
  process.exit(1);
}
const json = JSON.stringify(registry) + '\n';
if (check) {
  if (!existsSync(outFile) || readFileSync(outFile, 'utf8') !== json) {
    console.error('generated/registry.json is out of date. Run: npm run content:build');
    process.exit(1);
  }
  console.log('Content OK and registry is up to date.');
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, json);
  console.log(`Wrote registry: ${Object.keys(registry.maps).length} maps, ${Object.keys(registry.furniture).length} furniture, ${registry.avatar.parts.length} avatar parts, ${Object.keys(registry.tiles).length} tiles.`);
}
