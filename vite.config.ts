import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        
        '@': import.meta.dirname,
      },
    },
    server: {
      /*
       * The Express server owns the public port; Vite runs in middleware
       * mode inside it and does not open its own. This number is only the
       * port Express binds when PORT is unset in development, so both
       * halves agree on where to look.
       */
      port: Number(process.env.PORT ?? 3000),
      strictPort: false,
      /*
       * The dev server is also reached through a hosted preview proxy,
       * whose Host header is not localhost. Vite refuses an unknown host
       * (403 "Blocked request") unless it is listed. This only affects
       * `vite`/`tsx server.ts` in development — `vite build` output and
       * the production Express server never read it.
       *
       * VITE_ALLOWED_HOSTS adds more, comma separated, for any other
       * tunnelling host a developer uses.
       */
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        '.e2b.app',
        ...(process.env.VITE_ALLOWED_HOSTS ?? '')
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      ],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      
    },
  };
});
