import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import path from "path";


export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), Icons({ compiler: 'svelte' })],
  server: {
    port: 3000,
    host: true,
    proxy: {
      // Proxy WebSocket connections to the hub server
      '/ws': {
        target: process.env.COCKPIT_HUB_URL || 'http://localhost:3456',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  optimizeDeps: {
    exclude: ['@xyflow/svelte'],
  },
  ssr: {
    // Both ship raw .svelte sources; dev SSR must compile them, not require them.
    // These publish raw .svelte sources, which dev SSR must compile rather
    // than hand to Node — externalizing any of them ends in
    // ERR_UNKNOWN_FILE_EXTENSION on the first server-rendered request.
    noExternal: ['@xyflow/svelte', 'virtua', '@hugeicons/svelte'],
  },
});
