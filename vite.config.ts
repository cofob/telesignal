import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { NormalizedOutputOptions, OutputBundle, PluginContext } from 'rolldown';
import { bundleStats } from 'rollup-plugin-bundle-stats';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, normalizePath, type Plugin, type PluginOption, type UserConfig } from 'vite';
import { type Target, viteStaticCopy } from 'vite-plugin-static-copy';
import { watchAndRun } from 'vite-plugin-watch-and-run';

import buildCsp from './plugins/csp.ts';
import { DEFAULT_FRONTEND_PATH } from './plugins/frontends.ts';
import buildGitInfoPlugin from './plugins/gitInfo.ts';
import buildWebManifestPlugin from './plugins/webManifest.ts';
import packageJson from './package.json' with { type: 'json' };

const DIR_NAME = dirname(fileURLToPath(import.meta.url));
// The public address of the deployment, for the page's canonical and social metadata; set `BASE_URL` in production
const DEFAULT_BASE_URL = 'http://localhost:1234/';

const { version: APP_VERSION } = packageJson;
const BUNDLE_STATS_OUT_DIR = 'bundle-stats';
// One build holds both frontends: this one, Web A, at `/a/`, and Web K at `/k/` (`webk/`)
const WEB_A_PATH = '/a/';
const WEB_K_PATH = '/k/';
const DEFAULT_DEV_PORT = 1234;
const DEFAULT_BUNDLE_STATS_BASELINE_FILE = 'baseline.json';
const BUNDLE_STATS_VISUALIZER_FILE = 'visualizer.html';
const WORKER_BUNDLE_COLLECTOR_PLUGIN_NAME = 'telegram:collect-worker-report-bundle';
const BUNDLE_REPORT_PLUGIN_SUFFIX = ':with-workers';
const DEV_SERVER_WATCH_IGNORES = [
  // Anchored to this checkout: a worktree's own path contains `.claude/worktrees/<name>/`, so `**/.claude/**` would
  // ignore all of its files. From the main checkout, this leaves out the worktrees inside it: watched, they would reload
  // the pages on every edit there, and polled (`CHOKIDAR_USEPOLLING`), their files would keep the server too busy to
  // proxy Web K's modules
  `${DIR_NAME}/.claude/**`,
  '**/.cache/**',
  '**/webk/**',
  '**/dist/**',
  '**/tauri/target/**',
];
const DEV_BUNDLE_WARMUP_CLIENT_FILES = [
  'src/bundles/auth.ts',
  'src/bundles/main.ts',
  'src/bundles/extra.ts',
];
const IMAGE_ASSET_RE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const WATCHED_STATIC_COPY_TARGETS: Target[] = [
  {
    src: normalizePath(resolve(DIR_NAME, 'node_modules/opus-recorder/dist/decoderWorker.min.wasm')),
    dest: 'assets',
    rename: { stripBase: true },
  },
];
const UNWATCHED_STATIC_COPY_TARGETS: Target[] = [
  {
    src: normalizePath(resolve(DIR_NAME, 'node_modules/emoji-data-ios/img-apple-64/**/*')),
    dest: '.',
    rename: { stripBase: 2 },
  },
  {
    src: normalizePath(resolve(DIR_NAME, 'node_modules/emoji-data-ios/img-apple-160/**/*')),
    dest: '.',
    rename: { stripBase: 2 },
  },
];

type BundleReportPlugin = {
  name: string;
  generateBundle?: unknown;
};

type BundleReportHook = (
  this: PluginContext,
  outputOptions: NormalizedOutputOptions,
  bundle: OutputBundle,
  isWrite: boolean,
) => void | Promise<void>;

export default defineConfig(({ command, mode }): UserConfig => {
  const env = loadEnv(mode, process.cwd(), '');
  setViteEnv(env);
  const {
    HEAD = '',
    BUNDLE_STATS: bundleStatsValue = '',
    BUNDLE_STATS_BASELINE_PATH: bundleStatsBaselinePath = '',
    BUNDLE_STATS_VISUALIZER: bundleStatsVisualizerValue = '',
    HTTPS_CERT_PATH: httpsCertPath = '',
    HTTPS_KEY_PATH: httpsKeyPath = '',
  } = env;
  const appEnv = env.APP_ENV || (mode === 'development' ? 'development' : 'production');
  const defaultAppTitle = `${env.APP_NAME || 'TeleSignal'}${appEnv !== 'production' ? ' Beta' : ''}`;
  const baseUrl = env.BASE_URL || DEFAULT_BASE_URL;
  const appTitle = env.APP_TITLE || defaultAppTitle;
  const isProductionApp = appEnv === 'production';
  const appleIcon = isProductionApp ? 'apple-touch-icon' : 'apple-touch-icon-dev';
  const publicUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  // Web A's files are in its directory of the build
  const socialImageUrl = new URL(
    `${WEB_A_PATH.slice(1)}${isProductionApp ? 'icon-512x512.png' : 'icon-dev-512x512.png'}`, publicUrl,
  ).href;
  const csp = buildCsp(appEnv, env.SIGNAL_TUNNEL_URL);
  const responseHeaders = {
    'Content-Security-Policy': csp,
    'Service-Worker-Allowed': '/',
  };
  const isDevelopmentMode = mode === 'development';
  // `npm run dev` (`dev/dev.ts`) serves both frontends on this port and runs Web K's server on the next one
  const devPort = Number(env.DEV_PORT) || DEFAULT_DEV_PORT;
  const webKDevPort = Number(env.WEBK_DEV_PORT) || devPort + 1;
  const workerReportBundles: OutputBundle[] = [];
  const plugins: PluginOption[] = [
    command === 'serve' && buildDevRootRedirectPlugin(),
    buildGitInfoPlugin({
      appEnv,
      head: HEAD,
      isDevelopmentMode,
      rootDir: DIR_NAME,
    }),
    buildWebManifestPlugin({
      // Matches the identity browsers already derive from `start_url` for installed production apps
      id: isProductionApp ? publicUrl.pathname : undefined,
      isProductionApp,
    }),
    viteStaticCopy({ targets: WATCHED_STATIC_COPY_TARGETS }),
    viteStaticCopy({
      targets: UNWATCHED_STATIC_COPY_TARGETS,
      watch: {
        options: {
          ignored: '**/*',
        },
      },
    }),
    isDevelopmentMode && watchAndRun([
      {
        name: 'lang',
        watch: buildProjectPath('src/assets/localization/fallback.strings'),
        watchFile: (filePath) => Promise.resolve(isProjectFile(filePath, 'src/assets/localization/fallback.strings')),
        run: 'npm run lang:ts',
      },
      {
        name: 'icons',
        watch: buildProjectPath('src/assets/font-icons'),
        watchFile: (filePath) => Promise.resolve(isPathInsideProjectDirectory(filePath, 'src/assets/font-icons')),
        run: 'npm run icons:build',
      },
    ]),
  ];

  if (bundleStatsVisualizerValue === '1') {
    plugins.push(createBundleReportPlugin(visualizer((outputOptions) => ({
      filename: resolve(
        DIR_NAME,
        outputOptions.dir,
        BUNDLE_STATS_OUT_DIR,
        BUNDLE_STATS_VISUALIZER_FILE,
      ),
      open: true,
      template: 'treemap',
    })), workerReportBundles));
  }

  if (bundleStatsValue === '1') {
    plugins.push(createBundleReportPlugin(bundleStats({
      html: true,
      json: true,
      compare: Boolean(bundleStatsBaselinePath),
      baseline: !bundleStatsBaselinePath, // For master branch upload
      baselineFilepath: bundleStatsBaselinePath || DEFAULT_BUNDLE_STATS_BASELINE_FILE,
      outDir: BUNDLE_STATS_OUT_DIR,
    }), workerReportBundles));

    if (bundleStatsBaselinePath) {
      // Write current PR stats for the compact GitHub comment
      plugins.push(createBundleReportPlugin(bundleStats({
        html: false,
        json: false,
        compare: false,
        baseline: true,
        baselineFilepath: DEFAULT_BUNDLE_STATS_BASELINE_FILE,
        outDir: BUNDLE_STATS_OUT_DIR,
        silent: true,
      }), workerReportBundles));
    }
  }

  const shouldCollectWorkerReportBundles = bundleStatsVisualizerValue === '1' || bundleStatsValue === '1';

  setViteEnv({
    TG_APP_ENV: appEnv,
    TG_APP_NAME: env.APP_NAME || '',
    TG_APP_TITLE: appTitle,
    TG_PUBLIC_URL: baseUrl,
    TG_CSP: csp,
    TG_APPLE_ICON: appleIcon,
    TG_SOCIAL_IMAGE_URL: socialImageUrl,
    TG_SIGNAL_TUNNEL_URL: env.SIGNAL_TUNNEL_URL || '',
    TG_SIGNAL_BACKUPS: env.SIGNAL_BACKUPS || '',
  });

  return {
    // The built files refer to each other by relative paths, so the frontend works wherever its directory is served
    base: command === 'serve' ? WEB_A_PATH : './',
    envPrefix: ['VITE_', 'TG_'],
    assetsInclude: ['**/*.tgs'],
    define: {
      APP_VERSION: JSON.stringify(APP_VERSION),
    },
    resolve: {
      tsconfigPaths: true,
      // `lowlight` pins its own nested copy, while `@tiptap/extension-code-block-lowlight` uses the root one
      dedupe: ['highlight.js'],
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: isProductionApp ? '[hash:base64:8]' : '[name]__[local]',
      },
    },
    // Web K (`webk/`) has a page of its own, with its own server and dependencies
    optimizeDeps: {
      entries: ['index.html'],
    },
    server: {
      host: '0.0.0.0',
      port: devPort,
      proxy: {
        [WEB_K_PATH]: { target: `http://127.0.0.1:${webKDevPort}`, ws: true },
      },
      strictPort: true,
      headers: responseHeaders,
      https: getHttpsConfig(httpsCertPath, httpsKeyPath),
      warmup: {
        clientFiles: DEV_BUNDLE_WARMUP_CLIENT_FILES,
      },
      watch: {
        ignored: DEV_SERVER_WATCH_IGNORES,
      },
    },
    preview: {
      headers: responseHeaders,
    },
    build: {
      outDir: resolve(DIR_NAME, env.BUILD_OUT_DIR || 'dist', WEB_A_PATH.slice(1)),
      emptyOutDir: true,
      sourcemap: true,
      assetsInlineLimit: (filePath) => (IMAGE_ASSET_RE.test(filePath) ? false : undefined),
    },
    worker: {
      plugins: () => [
        ...(shouldCollectWorkerReportBundles ? [createWorkerBundleCollectorPlugin(workerReportBundles)] : []),
      ],
      rolldownOptions: {
        output: {
          entryFileNames: '[name]-[hash].js',
        },
      },
    },
    plugins,
  };
});

// The production root page (`dev/build.ts`) and nginx open the default frontend, and so does the dev server
function buildDevRootRedirectPlugin(): Plugin {
  return {
    name: 'dev-root-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query] = (req.url || '').split(/(?=\?)/);
        // `/` opens the default frontend, and `/a` and `/k` their directories, with the query, as nginx does
        const location = pathname === '/' ? `/${DEFAULT_FRONTEND_PATH}`
          : (pathname === WEB_A_PATH.slice(0, -1) || pathname === WEB_K_PATH.slice(0, -1) ? `${pathname}/` : undefined);
        if (!location) {
          next();
          return;
        }

        res.statusCode = 302;
        res.setHeader('Location', `${location}${query || ''}`);
        res.end();
      });
    },
  };
}

function createBundleReportPlugin(plugin: BundleReportPlugin, workerReportBundles: OutputBundle[]): Plugin {
  return {
    name: `${plugin.name}${BUNDLE_REPORT_PLUGIN_SUFFIX}`,
    async generateBundle(outputOptions, bundle, isWrite) {
      const generateBundle = parseBundleReportHook(plugin.generateBundle);

      await generateBundle?.call(
        this,
        outputOptions,
        mergeOutputBundles(bundle, workerReportBundles),
        isWrite,
      );
    },
  };
}

function createWorkerBundleCollectorPlugin(workerReportBundles: OutputBundle[]): Plugin {
  return {
    name: WORKER_BUNDLE_COLLECTOR_PLUGIN_NAME,
    generateBundle(_outputOptions, bundle) {
      workerReportBundles.push({ ...bundle });
    },
  };
}

function mergeOutputBundles(bundle: OutputBundle, workerReportBundles: OutputBundle[]): OutputBundle {
  const result: OutputBundle = {};

  Object.assign(result, bundle, ...workerReportBundles);

  return result;
}

function parseBundleReportHook(hook: unknown): BundleReportHook | undefined {
  if (typeof hook === 'function') {
    return hook as BundleReportHook;
  }

  if (!hook || typeof hook !== 'object' || !('handler' in hook) || typeof hook.handler !== 'function') {
    return undefined;
  }

  return hook.handler as BundleReportHook;
}

function setViteEnv(env: Record<string, string>) {
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

function buildProjectPath(projectPath: string) {
  return normalizePath(resolve(DIR_NAME, projectPath));
}

function isProjectFile(filePath: string, projectPath: string) {
  return normalizePath(filePath) === buildProjectPath(projectPath);
}

function isPathInsideProjectDirectory(filePath: string, projectPath: string) {
  return normalizePath(filePath).startsWith(`${buildProjectPath(projectPath)}/`);
}

function getHttpsConfig(httpsCertPath: string, httpsKeyPath: string) {
  if (!httpsCertPath || !httpsKeyPath) return undefined;

  return {
    cert: readFileSync(httpsCertPath),
    key: readFileSync(httpsKeyPath),
  };
}
