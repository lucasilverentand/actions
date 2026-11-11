import { build } from 'esbuild';

await build({
  entryPoints: ['src/pr-policy.mjs', 'src/repository-audit.mjs', 'src/branch-cleanup.mjs'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  legalComments: 'eof',
});
