import { discoveryPreview } from "./discovery-preview.mts";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Separate browser build; the Zalo build continues to use vite.config.mts.
export default defineConfig({
  plugins: [react(), discoveryPreview()],
  base: "./",
  // Browser shell uses the same server and persistent cache as the Zalo app.
  define: {
    "import.meta.env.VITE_BROWSER_PREVIEW": JSON.stringify("true"),
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist-web",
    rollupOptions: { input: { index: "index.html", browser: "browser.html", web: "web.html" } },
  },
});
