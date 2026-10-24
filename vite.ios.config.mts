import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const pebbleAssetsDir = fileURLToPath(new URL("./ios/pebble-preview/", import.meta.url));
const pebbleAssets = [
  { fileName: "pebble-ios.css", type: "text/css" },
  { fileName: "pebble-ios.js", type: "text/javascript" },
] as const;

const readPebbleAsset = (fileName: string) => {
  const path = `${pebbleAssetsDir}${fileName}`;
  return existsSync(path) ? readFileSync(path) : "";
};

function iosPebblePreview(): Plugin {
  return {
    name: "ios-pebble-preview",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0].replace(/^\//, "");
        const asset = pebbleAssets.find((item) => item.fileName === url);
        if (!asset) {
          next();
          return;
        }

        const source = readPebbleAsset(asset.fileName);
        if (!source) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        res.setHeader("Content-Type", `${asset.type}; charset=utf-8`);
        res.end(source);
      });
    },
  };
}

function iosPebbleBundle(): Plugin {
  const diagnostics = process.env.STATS_MOTION_DIAGNOSTICS === "1";
  const inject = [
    { tag: "link", attrs: { rel: "stylesheet", href: "./pebble-ios.css" }, injectTo: "head" as const },
    { tag: "script", attrs: { src: "./pebble-ios.js" }, injectTo: "body" as const },
    ...(diagnostics ? [{ tag: "script", attrs: { src: "./menu-motion.js" }, injectTo: "body" as const }] : []),
  ];

  return {
    name: "ios-pebble-bundle",
    transformIndexHtml: { order: "post", handler: () => inject },
    generateBundle() {
      if (diagnostics) {
        this.emitFile({ type: "asset", fileName: "menu-motion.js", source: readFileSync(new URL("./ios/diagnostics/menu-motion.js", import.meta.url), "utf8") });
      }
      for (const asset of pebbleAssets) {
        const source = readPebbleAsset(asset.fileName);
        if (source) {
          this.emitFile({ type: "asset", fileName: asset.fileName, source });
        }
      }
    },
  };
}

function iosViewportLock(): Plugin {
  return {
    name: "ios-viewport-lock",
    transformIndexHtml(html) {
      return html.replace(
        /<meta name="viewport" content="[^"]*"\s*\/>/,
        '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), iosPebblePreview(), iosPebbleBundle(), iosViewportLock()],
  base: "./",
  envDir: process.cwd(),
  define: {
    "import.meta.env.VITE_IOS_APP": JSON.stringify("true"),
    "import.meta.env.VITE_BROWSER_PREVIEW": JSON.stringify(command === "serve" ? "true" : "false"),
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist-ios",
    rollupOptions: { input: { index: "index.html" } },
  },
}));
