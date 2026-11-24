// Builds both frontends into one directory (`BUILD_OUT_DIR`, `dist` by default): Web A in `a/`, Web K (`webk/`) in `k/`,
// and a root page that opens the default frontend (`plugins/frontends.ts`). Arguments go to Web A's build;
// `--sourcemap false` also leaves out Web K's source maps.
import { spawnSync } from 'child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { DEFAULT_FRONTEND_PATH } from '../plugins/frontends.ts';

const ROOT = resolve(import.meta.dirname, '..');
const WEB_K_DIR = join(ROOT, 'webk');
const SOURCE_MAP_RE = /\.map$/;
const SCRIPT_RE = /\.js$/;
// A worker's URL in a chunk (`new URL('index.worker-….js', import.meta.url)`), and a chunk's import of another one
const WORKER_URL_RE = /new URL\(["'`]([^"'`/]+\.js)["'`],\s*import\.meta\.url\)/g;
const RELATIVE_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]\.\/([^"'`]+\.js)["'`]/g;
const ROOT_SCRIPT_NAME = 'root.js';
// The root of the origin has no app of its own: `/` opens the default frontend, on any server and in the desktop app,
// with the query (the account slot, `?account=2`) and the hash. The frontend is in `data-frontend`, which the image's
// nginx redirect reads too (`Dockerfile`); without scripts the page only opens the frontend
const ROOT_PAGE = `<!DOCTYPE html>
<html lang="en" data-frontend="${DEFAULT_FRONTEND_PATH}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'">
  <title>TeleSignal</title>
  <script src="${ROOT_SCRIPT_NAME}"></script>
  <noscript><meta http-equiv="refresh" content="0; url=${DEFAULT_FRONTEND_PATH}"></noscript>
</head>
<body></body>
</html>
`;
const ROOT_SCRIPT = 'location.replace(document.documentElement.dataset.frontend + location.search + location.hash);\n';

const outDir = resolve(ROOT, process.env.BUILD_OUT_DIR || 'dist');
const webAArgs = process.argv.slice(2);
const hasNoSourceMaps = webAArgs.join(' ').includes('--sourcemap false');
// `tsx` turns Node's type stripping off for its children, which Web K's Vite config needs
const env = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS?.replace('--no-experimental-strip-types', '').trim(),
  BUILD_OUT_DIR: outDir,
};

rmSync(outDir, { recursive: true, force: true });
runVite(ROOT, ['build', ...webAArgs], {});
runVite(WEB_K_DIR, ['build'], { NODE_ENV: 'production' });
checkWorkerEntryImports(join(outDir, 'k'));
if (hasNoSourceMaps) removeSourceMaps(join(outDir, 'k'));
writeFileSync(join(outDir, 'index.html'), ROOT_PAGE);
writeFileSync(join(outDir, ROOT_SCRIPT_NAME), ROOT_SCRIPT);

// Each frontend builds with the Vite of its own dependencies
function runVite(cwd: string, args: string[], extraEnv: Record<string, string>) {
  const vite = join(cwd, 'node_modules/vite/bin/vite.js');
  const { status } = spawnSync(process.execPath, [vite, ...args], {
    cwd, env: { ...env, ...extraEnv }, stdio: 'inherit',
  });
  if (status !== 0) process.exit(status ?? 1);
}

// A page opens a worker by its URL with a query (`makeWorkerURL` in Web K), so a chunk that imports the worker's entry
// by its plain URL runs the entry a second time in that worker (`worker.rolldownOptions` in `webk/vite.config.ts`)
function checkWorkerEntryImports(dir: string) {
  const scripts = readdirSync(dir).filter((name) => SCRIPT_RE.test(name));
  const sources = new Map(scripts.map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
  const workerEntries = new Set<string>();
  sources.forEach((source) => {
    for (const [, name] of source.matchAll(WORKER_URL_RE)) workerEntries.add(name);
  });

  const failures = scripts.flatMap((name) => [...sources.get(name)!.matchAll(RELATIVE_IMPORT_RE)]
    .map(([, imported]) => imported)
    .filter((imported) => imported !== name && workerEntries.has(imported))
    .map((imported) => `${name} imports the worker entry ${imported}`));
  if (!failures.length) return;

  // eslint-disable-next-line no-console
  console.error(`Web K's build imports worker entries:\n${failures.join('\n')}`);
  process.exit(1);
}

function removeSourceMaps(dir: string) {
  readdirSync(dir).forEach((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      removeSourceMaps(path);
    } else if (SOURCE_MAP_RE.test(name)) {
      rmSync(path);
    }
  });
}
