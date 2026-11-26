// Builds dist/lotcheck.html: one self-contained page.
//
// The transform is deliberately simple:
//   1. Read the four JavaScript files in dependency order
//      (rational.js, sizing.js, guard.js, app.js).
//   2. Remove their `import ... from "...";` statements.
//   3. Remove the `export` keyword in front of declarations.
//   4. Join them into one inline module script.
// Comments are kept exactly as written (nothing is stripped).
// The build stops with an error if an import or export is left over, or if two
// top-level declarations share a name. It adds a Content-Security-Policy that
// names the SHA-256 hash of the inline script and style.
//
// The output has no timestamps, so building twice gives identical bytes.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..");

export const SCRIPT_FILES = [
  "src/core/rational.js",
  "src/core/sizing.js",
  "src/core/guard.js",
  "src/ui/app.js",
];

// Files a bundled file may import from, as exact paths below the project
// root. All of them are part of the bundle. index.js is not: it re-exports,
// and its VERSION is injected from package.json instead.
const KNOWN_IMPORTS = ["src/core/rational.js", "src/core/sizing.js", "src/core/guard.js"].map((file) =>
  resolve(ROOT, file)
);

function readText(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256Base64(text) {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

// Strips imports and export keywords from one module. Throws on anything the
// simple transform cannot handle. `name` is the path of the module below the
// project root; an import must resolve to exactly one of the three core files.
export function transformModule(source, name) {
  let text = source;

  // Check where each import points before removing it.
  const importPattern = /^import\s+(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']\s*;?[ \t]*$/gm;
  text = text.replace(importPattern, (whole, specifier) => {
    const target = resolve(ROOT, dirname(name), specifier);
    if (!KNOWN_IMPORTS.includes(target)) {
      throw new Error(name + ": unknown import " + JSON.stringify(specifier));
    }
    return "";
  });

  // `export function`, `export class`, `export const` and so on.
  text = text.replace(/^export\s+(?=(?:async\s+function|function|class|const|let|var)\b)/gm, "");

  const left = text.match(/^\s*(import|export)\b.*$/m);
  if (left) {
    throw new Error(name + ": leftover import or export: " + left[0].trim());
  }
  if (/\bimport\s*\(/.test(text) || /\bimport\.meta\b/.test(text)) {
    throw new Error(name + ": dynamic import or import.meta is not allowed");
  }
  return text.trim() + "\n";
}

// True when a "/" at `i` starts a regular expression (the last real
// character before it is an operator or an opening bracket), not a division.
function regexMayStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  return j < 0 || "=(,:[!&|?{};+-*%<>~^".includes(text[j]);
}

// Returns the index of the last character of the regex literal at `i`.
function skipRegex(text, i) {
  let inClass = false;
  let k = i + 1;
  while (k < text.length && text[k] !== "\n") {
    if (text[k] === "\\") k += 1;
    else if (text[k] === "[") inClass = true;
    else if (text[k] === "]") inClass = false;
    else if (text[k] === "/" && !inClass) return k;
    k += 1;
  }
  return i;
}

// Reads one top-level declaration statement starting at `start` (a const,
// let or var at column 0) and returns the names of all its declarators.
function declaratorNames(text, start, name) {
  const names = [];
  let depth = 0;
  let i = text.indexOf(" ", start) + 1;
  let wantName = true;
  while (i < text.length) {
    const c = text[i];
    if (wantName) {
      const found = /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(i, i + 200));
      if (!found) throw new Error(name + ": destructuring at the top level is not supported");
      names.push(found[1]);
      i += found[0].length;
      wantName = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < text.length && text[i] !== c && (c === "`" || text[i] !== "\n")) {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 1;
    } else if (c === "/" && regexMayStart(text, i)) {
      i = skipRegex(text, i);
    } else if (c === "(" || c === "[" || c === "{") {
      depth += 1;
    } else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
    } else if (depth === 0 && c === ";") {
      break;
    } else if (depth === 0 && c === ",") {
      wantName = true;
    }
    i += 1;
  }
  return names;
}

// Names declared at the top level (column 0) of a transformed module. Every
// declarator of a statement like `const a = 1, b = 2;` is returned.
export function topLevelNames(text, name) {
  const names = [];
  const pattern =
    /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1] || match[2]) names.push(match[1] || match[2]);
    else names.push(...declaratorNames(text, match.index, name));
  }
  return names;
}

// Throws when two top-level declarations share a name.
export function assertNoDuplicates(parts) {
  const seen = new Map();
  for (const part of parts) {
    for (const found of topLevelNames(part.text, part.name)) {
      if (seen.has(found)) {
        throw new Error(
          "duplicate top-level name " + JSON.stringify(found) + " in " + part.name + " and " + seen.get(found)
        );
      }
      seen.set(found, part.name);
    }
  }
}

// Runs Node's syntax check on the bundled script, written to a temporary
// .mjs file (a module, so a duplicate top-level name is a syntax error).
export function checkSyntax(script) {
  const dir = mkdtempSync(join(tmpdir(), "lotcheck-build-"));
  try {
    const file = join(dir, "bundle.mjs");
    writeFileSync(file, script);
    const run = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (run.status !== 0) {
      throw new Error("the bundled script failed the syntax check: " + (run.stderr || run.error || "").toString().trim());
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function bundleScript() {
  const parts = SCRIPT_FILES.map((file) => ({
    name: file,
    text: transformModule(readText(file), file),
  }));
  assertNoDuplicates(parts);
  const script = "\n" + parts.map((part) => part.text).join("\n");
  if (/<\/script/i.test(script) || /<!--/.test(script)) {
    throw new Error("the script contains a sequence that would end the script element early");
  }
  checkSyntax(script);
  return script;
}

function version() {
  const pkg = JSON.parse(readText("package.json"));
  return String(pkg.version);
}

// Words and shapes that must never reach the page.
const FORBIDDEN = [
  [/http(?!-equiv)/i, "http (other than the http-equiv attribute of the policy tag)"],
  [/:\/\//, "://"],
  [/\bfetch\s*\(/, "fetch("],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/WebSocket/, "WebSocket"],
  [/sendBeacon/, "sendBeacon"],
  [/innerHTML|outerHTML|insertAdjacentHTML/, "innerHTML"],
  [/\beval\s*\(/, "eval("],
  [/new\s+Function/, "new Function"],
  [/document\s*\.\s*write/, "document.write"],
];

export function build() {
  const style = "\n" + readText("src/ui/styles.css");
  const script = bundleScript();
  const page = readText("src/ui/page.html");

  const csp =
    "default-src 'none'; script-src 'sha256-" +
    sha256Base64(script) +
    "'; style-src 'sha256-" +
    sha256Base64(style) +
    "'; img-src data:; base-uri 'none'; form-action 'none'";
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + csp + '">';

  for (const marker of ["<head>", "{{STYLE}}", "{{SCRIPT}}", "{{VERSION}}"]) {
    if (!page.includes(marker)) throw new Error("page.html is missing " + marker);
  }

  // Replacement functions, so "$" in the code is never treated as a pattern.
  const html = page
    .replace("<head>", () => "<head>\n" + meta)
    .replace("{{STYLE}}", () => style)
    .replace("{{VERSION}}", () => version())
    .replace("{{SCRIPT}}", () => script);

  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(html)) throw new Error("the built page contains forbidden text: " + label);
  }
  return { html, sha256: sha256Hex(html) };
}

export function writeBuild() {
  const { html, sha256 } = build();
  const dist = join(ROOT, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "lotcheck.html"), html);
  writeFileSync(join(dist, "SHA256SUMS"), sha256 + "  lotcheck.html\n");
  return { html, sha256 };
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  const { sha256, html } = writeBuild();
  console.log("Built dist/lotcheck.html (" + Buffer.byteLength(html) + " bytes)");
  console.log(sha256 + "  lotcheck.html");
}
