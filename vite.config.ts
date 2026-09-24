import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

const commit =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "local";
    }
  })();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  server: {
    host: "0.0.0.0",
    port: 8888,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 8888,
    strictPort: true,
  },
});
