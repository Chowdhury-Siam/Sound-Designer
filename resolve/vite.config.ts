import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const emptyNodeModule = "\0sounddesigner-resolve-empty-node";
const emptyCepModule = "\0sounddesigner-resolve-empty-cep";
const nodeExports = ["crypto", "assert", "buffer", "child_process", "cluster", "dgram", "dns", "domain", "events", "fs", "http", "https", "net", "os", "path", "punycode", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "zlib"];

const resolveCompatibility = () => ({
  name: "sounddesigner-resolve-compatibility",
  enforce: "pre" as const,
  resolveId(source: string) {
    const normalized = source.replaceAll("\\", "/");
    if (normalized.endsWith("/lib/cep/node") || normalized.endsWith("/lib/cep/node.ts")) return emptyNodeModule;
    if (normalized.endsWith("/lib/utils/bolt") || normalized.endsWith("/lib/utils/bolt.ts")) return emptyCepModule;
    return null;
  },
  load(id: string) {
    if (id === emptyNodeModule) return nodeExports.map((name) => `export const ${name} = {};`).join("\n");
    if (id === emptyCepModule) return "export const csi = { getSystemPath: () => '' };";
    return null;
  },
});

export default defineConfig({
  root,
  base: "./",
  plugins: [resolveCompatibility(), svelte()],
  build: {
    outDir: path.join(root, "dist", "renderer"),
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome88",
  },
});
