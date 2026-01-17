import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import path from "path";


export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      // Proxy WebSocket connections to the hub server
      '/ws': {
        target: process.env.HUB_URL || 'http://localhost:3456',
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
    noExternal: ['@xyflow/svelte'],
  },
});
