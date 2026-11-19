import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { extname } from "node:path";
import { isMainThread } from "node:worker_threads";
import ts from "typescript";

// Resolve the same TypeScript source imports that Next.js resolves in the app.
const source = new URL("../src/", import.meta.url);
const scripts = new URL("./", import.meta.url);
const isProjectFile = url => [source.href, scripts.href].some(prefix => url?.startsWith(prefix));

if (isMainThread) {
  if (nodeModule.registerHooks) nodeModule.registerHooks({ resolve, load });
  else nodeModule.register(import.meta.url);
}

export function resolve(specifier, context, nextResolve) {
  if (isProjectFile(context.parentURL)) {
    if (specifier.startsWith("@/")) {
      specifier = new URL(`${specifier.slice(2)}.ts`, source).href;
    } else if (/^\.\.?\//.test(specifier) && !extname(specifier)) {
      specifier += ".ts";
    }
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (!isProjectFile(url) || !url.endsWith(".ts")) return nextLoad(url, context);

  const file = new URL(url);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, inlineSourceMap: true },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
