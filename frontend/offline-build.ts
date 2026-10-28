import type { Plugin } from "vite";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
// Build-owned service worker; no runtime library or CDN is involved.
export function offlineBuild(): Plugin {
  let output = "";
  return {
    name: "sheet-merger-offline",
    apply: "build",
    configResolved(c) {
      output = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const assets = readdirSync(resolve(output, "assets"))
        .filter((p) => /\.(js|css)$/.test(p))
        .map((p) => "/assets/" + p);
      const guide = readdirSync(resolve(output, "guide"))
        .filter((p) => p.endsWith(".webp"))
        .map((p) => "/guide/" + p);
      const paths = [
        "/",
        "/index.html",
        "/manifest.webmanifest",
        "/icon-192.png",
        "/icon-512.png",
        ...assets,
        ...guide,
      ];
      const template = readFileSync(resolve(output, "../sw.js"), "utf8");
      const hash = createHash("sha256");
      hash.update(template);
      for (const path of paths)
        hash.update(
          readFileSync(
            resolve(output, path === "/" ? "index.html" : path.slice(1)),
          ),
        );
      const embedded = paths.map((path) => {
        const file = path === "/" ? "index.html" : path.slice(1);
        return [
          path,
          file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".js")
              ? "text/javascript"
              : file.endsWith(".css")
                ? "text/css"
                : file.endsWith(".png")
                  ? "image/png"
                  : file.endsWith(".webp")
                    ? "image/webp"
                    : "application/manifest+json",
          readFileSync(resolve(output, file)).toString("base64"),
        ];
      });
      const source = template
        .replace("__VERSION__", hash.digest("hex").slice(0, 16))
        .replace("__PRECACHE__", JSON.stringify(paths))
        .replace("__EMBEDDED__", JSON.stringify(embedded));
      writeFileSync(resolve(output, "sw.js"), source);
    },
  };
}
