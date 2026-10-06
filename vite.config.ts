import { defineConfig, type Plugin } from 'vite';

/** Content-Security-Policy injected into the production index.html only (it would break HMR in dev). */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; worker-src 'self'; " +
  "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    // The module-preload polyfill uses fetch(); we never need it and the page must not contain network code.
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
});
