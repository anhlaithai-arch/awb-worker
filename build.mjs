import { build } from 'esbuild';
await build({
  entryPoints: ['index.js'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  minify: true,
  legalComments: 'linked'
});
console.log('Built dist/index.js');
