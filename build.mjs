import * as esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';

// release = minified, no source maps (used by npm run package).
export function buildOptions({ release = false } = {}) {
  return {
    entryPoints: {
      background: 'src/background.js',
      video: 'src/video.js',
      overlay: 'src/overlay.js',
      popup: 'src/popup.js',
    },
    bundle: true,
    outdir: 'extension/dist',
    format: 'iife',
    target: 'chrome116',
    sourcemap: !release,
    minify: release,
    logLevel: 'info',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--watch')) {
    const ctx = await esbuild.context(buildOptions());
    await ctx.watch();
  } else {
    await esbuild.build(buildOptions());
  }
}
