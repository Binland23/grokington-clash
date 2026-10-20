// Batch art generator: drives the Grok CLI (headless `grok -p`) to render every
// item in asset-manifest.json into "CLASH - assets/raw/<name>.png".
// Usage: node tools/gen-assets.mjs [shard] [shards] [--only a,b] [--force] [--manifest file.json] [--out folder]
// Run several shards in parallel terminals, e.g. `node tools/gen-assets.mjs 0 3`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mIdx = argv.indexOf('--manifest');
const manifestFile = mIdx >= 0 ? argv[mIdx + 1] : 'asset-manifest.json';
const manifest = JSON.parse(fs.readFileSync(path.join(here, manifestFile), 'utf8'));
const oIdx = argv.indexOf('--out');
const RAW_DIR = path.resolve(here, '..', '..', 'CLASH - assets', oIdx >= 0 ? argv[oIdx + 1] : 'raw');
fs.mkdirSync(RAW_DIR, { recursive: true });

const args = process.argv.slice(2);
const positional = args.filter((a) => /^\d+$/.test(a));
const shard = Number(positional[0] ?? 0);
const shards = Number(positional[1] ?? 1);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
const force = args.includes('--force');
const TIMEOUT_MS = 6 * 60 * 1000;

function buildPrompt(item) {
  const parts = [manifest.styles[item.style], item.subject];
  if (item.frame) parts.push(manifest.styles[item.frame]);
  return parts.join(' ');
}

function runGrok(item) {
  const file = `${item.name}.png`;
  const instruction =
    `Use your GenerateImage tool to generate exactly ONE image (aspect ratio ${item.aspect}) from this prompt:\n\n` +
    `"""${buildPrompt(item)}"""\n\n` +
    `Save the resulting image as a PNG file named ${file} in the current working directory. ` +
    `Do not create or modify any other files. When done, reply with only the saved file path.`;
  return new Promise((resolve) => {
    const child = spawn('grok', ['-p', instruction, '--always-approve', '--max-turns', '12', '--output-format', 'plain'], {
      cwd: RAW_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      out += '\n[timeout]';
      child.kill();
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim() });
    });
  });
}

const items = manifest.items.filter((it, i) => (only ? only.has(it.name) : i % shards === shard));
console.log(`[gen] shard ${shard}/${shards}: ${items.length} item(s) -> ${RAW_DIR}`);
let done = 0;
for (const item of items) {
  const target = path.join(RAW_DIR, `${item.name}.png`);
  if (!force && fs.existsSync(target)) {
    console.log(`[gen] skip ${item.name} (exists)`);
    done++;
    continue;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    console.log(`[gen] ${item.name} (attempt ${attempt}) ...`);
    const { code, out } = await runGrok(item);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (fs.existsSync(target)) {
      console.log(`[gen] OK ${item.name} in ${secs}s`);
      break;
    }
    console.log(`[gen] FAILED ${item.name} (exit ${code}, ${secs}s): ${out.slice(-400)}`);
  }
  done++;
  console.log(`[gen] progress ${done}/${items.length}`);
}
console.log(`[gen] shard ${shard} finished`);
