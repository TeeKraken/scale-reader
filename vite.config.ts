import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Writes dist/sw.js: the worker logic from src/sw/worker.js plus the exact list of
 * built files, so the whole app is cached on first visit and keeps working offline.
 * The cache name is a hash of every cached file's contents, so changing anything
 * (even an icon) ships a new cache. Hand-rolled to avoid a plugin dependency.
 */
function serviceWorker(): Plugin {
  const publicFiles = ["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
  return {
    name: "scale-reader-sw",
    apply: "build",
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      const built = Object.keys(bundle).sort();
      for (const name of built) {
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === "chunk" ? item.code : item.source);
      }
      for (const name of publicFiles) {
        hash.update(name);
        hash.update(readFileSync(here(`public/${name}`)));
      }
      const workerSource = readFileSync(here("src/sw/worker.js"), "utf8").replace(/^export /gm, "");
      hash.update(workerSource);

      const precache = [
        "/",
        ...built.filter((f) => f !== "index.html").map((f) => `/${f}`),
        ...publicFiles.map((f) => `/${f}`),
      ];
      const config = { cacheName: `scale-reader-${hash.digest("hex").slice(0, 12)}`, precache };
      const source = `// Generated at build time from src/sw/worker.js.\n${workerSource}\nregisterWorker(self, ${JSON.stringify(config)});\n`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  build: { target: "es2022" },
});
