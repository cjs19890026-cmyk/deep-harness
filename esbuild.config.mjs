import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";
const outdir = "dist";

// Obsidian plugins run inside Electron's main process: Node builtins are
// available at runtime, so they must NOT be bundled.
const nodeBuiltins = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http",
  "https", "net", "os", "path", "stream", "string_decoder", "tls", "url",
  "util", "zlib", "worker_threads", "querystring", "readline", "timers",
  "dgram", "dns", "module", "perf_hooks", "v8", "vm",
]);

if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", ...nodeBuiltins],
  platform: "node",
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: path.join(outdir, "main.js"),
  minify: prod,
  define: {
    __DEV__: prod ? "false" : "true",
  },
}).catch(() => process.exit(1));

const staticFiles = ["manifest.json", "styles.css"];
for (const file of staticFiles) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(outdir, file));
    console.log(`  ${file} copied to ${outdir}/`);
  }
}
