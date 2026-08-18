import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [tailwindcss()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: { port: 8902, strictPort: true },
});
