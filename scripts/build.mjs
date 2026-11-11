import { build } from 'esbuild';

await build({
  entryPoints: ['src/pr-policy.mjs', 'src/repository-audit.mjs', 'src/branch-cleanup.mjs'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // YAML is CommonJS and imports Node built-ins through require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  outExtension: { '.js': '.mjs' },
  legalComments: 'eof',
});
