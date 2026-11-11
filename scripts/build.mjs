import { build } from 'esbuild';
import { actions } from './actions.mjs';

await build({
  entryPoints: actions.map((action) => ({
    in: `${action}/src/index.mjs`,
    out: `${action}/dist/index`,
  })),
  outdir: '.',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // YAML is CommonJS and imports Node built-ins through require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  outExtension: { '.js': '.mjs' },
  legalComments: 'eof',
});
