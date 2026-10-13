// Membangun library React di vendor/ menjadi satu file IIFE per library (situs Novelist tidak punya build step).
// Semua bundel memakai React 18 global yang sama (window.React / window.ReactDOM dari vendor/), jadi React
// tetap dimuat sekali. Jalankan: cd tools && npm install && npm run build:vendor
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "tools/node_modules");   // dependensi build ada di tools/ (bukan di root repo)
const pkg = (name) => JSON.parse(fs.readFileSync(path.join(modules, name, "package.json"), "utf8")).version;
const shim = (f) => path.join(root, "tools/shims", f);
const REACT_MAP = {
  "react": shim("react.js"), "react-dom": shim("react-dom.js"), "react-dom/client": shim("react-dom.js"),
  "react/jsx-runtime": shim("jsx-runtime.js"), "react/jsx-dev-runtime": shim("jsx-runtime.js"),
};
const reactGlobals = {
  name: "react-globals",
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => {
      if (REACT_MAP[a.path]) return { path: REACT_MAP[a.path] };
      throw new Error("import React yang belum dipetakan: " + a.path);
    });
  },
};

async function bundle({ name, version, globalName, contents, outfile, url }) {
  await esbuild.build({
    stdin: { contents, resolveDir: root, loader: "tsx" },
    bundle: true, format: "iife", globalName, minify: true, target: ["es2019"], jsx: "automatic",
    alias: { "@": root }, nodePaths: [modules], define: { "process.env.NODE_ENV": '"production"' },
    plugins: [reactGlobals], outfile: path.join(root, outfile), logLevel: "warning",
    banner: { js: `/*! ${name} ${version} — MIT — ${url} — dibundel untuk Novelist (tools/build-vendor.mjs): butuh window.React & window.ReactDOM (18), hasil: window.${globalName} */` },
  });
  console.log(`✓ ${outfile}  (${(fs.statSync(path.join(root, outfile)).size / 1024).toFixed(0)} KB)`);
}

// shadcn/ui: semua komponen di components/ui (kode sumbernya milik proyek ini, gaya Tailwind) + cn()
const uiFiles = fs.readdirSync(path.join(root, "components/ui")).filter((f) => f.endsWith(".tsx")).sort();
const shadcnEntry = uiFiles.map((f) => `export * from "@/components/ui/${f.replace(/\.tsx$/, "")}";`).join("\n") +
  `\nexport { cn } from "@/lib/utils";\n`;

await bundle({ name: "Base UI (@base-ui/react)", version: pkg("@base-ui/react"), globalName: "BaseUI",
  contents: `export * from "@base-ui/react";`, outfile: `vendor/base-ui-${pkg("@base-ui/react")}.min.js`, url: "https://base-ui.com" });
await bundle({ name: "Radix UI (radix-ui)", version: pkg("radix-ui"), globalName: "RadixUI",
  contents: `export * from "radix-ui";`, outfile: `vendor/radix-ui-${pkg("radix-ui")}.min.js`, url: "https://www.radix-ui.com" });
await bundle({ name: "shadcn/ui (components/ui, registry shadcn@4.21.0)", version: "4.21.0", globalName: "ShadcnUI",
  contents: shadcnEntry, outfile: "vendor/shadcn-ui.min.js", url: "https://ui.shadcn.com" });
