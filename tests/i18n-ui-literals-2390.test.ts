/**
 * #2390: the web UI's words go through the locale layer (t() / a register() table with en and zh-TW).
 * - The literal scan: English written in place in src/ui — a text node or a literal aria-label / title / placeholder / alt
 *   / label / message / confirmLabel / subtitle / text attribute in an html`` template, or toast / confirmDialog / alert /
 *   setError / setMsg / setMessage called with a string. `${…}` is a value, not wording. The allowlist is wording that is
 *   not a sentence to translate (example placeholders, names, units), each with why.
 * - Key parity: every register() table in src/ui has the same keys in en and zh-TW (parsed with the TypeScript parser).
 * To clear a finding, put the words in the module's register() table and call t(); a name or an example goes on the list.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "src", "ui");
const files = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === "vendor" ? [] : files(p)) : /\.js$/.test(n) && !/\.module\.js$/.test(n) ? [p] : [];
});
/** file<TAB>kind<TAB>text — not a sentence to translate. */
const ALLOWED = new Map<string, string>([
  ["shared/identity-color.js\tplaceholder\t#rrggbb", "a colour format"],
  ["shared/app-shell.js\ttext\tEnglish", "the language's own name in the language menu"],
  ["settings-wizard.js\tplaceholder\t/home/you/projects/app", "an example path"],
  ["settings-mods.js\tplaceholder\tmy-look", "an example mod name"],
  ["settings-effects.js\ttext\tKiB ·", "a unit"],
  ["settings-dialogs.js\tplaceholder\te.g. file:prompts/dev.md", "an example value (file: syntax)"],
  ["panel-settings.js\ttext\tcollab", "the config mode's name (channel collab)"],
  ["panel-settings.js\ttext\tClassicBot", "a product name"],
  ["panel-settings.js\tplaceholder\tagend.example.com", "an example hostname"],
  ["panel-fleet.js\tplaceholder\t/path/to/projects", "an example path"],
  ["backend-signin.js\tlabel\tURL", "an acronym, the same in both languages"],
]);

/** Each html`…` template's static parts, with every ${…} (balanced, nested templates included) replaced by "\u0000". */
function templates(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf("html`", i)) !== -1) {
    let j = i + 5, text = "";
    const skipExpr = (k: number): number => { // k at char after "${"; returns index after matching "}"
      let depth = 1;
      while (k < src.length && depth) {
        const c = src[k];
        if (c === "`") { k = skipTpl(k + 1); continue; }
        if (c === '"' || c === "'") { const q = c; k++; while (k < src.length && src[k] !== q) { if (src[k] === "\\") k++; k++; } k++; continue; }
        if (c === "{") depth++; else if (c === "}") depth--;
        k++;
      }
      return k;
    };
    const skipTpl = (k: number): number => { while (k < src.length && src[k] !== "`") { if (src[k] === "\\") k += 2; else if (src[k] === "$" && src[k + 1] === "{") k = skipExpr(k + 2); else k++; } return k + 1; };
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") { text += src[j + 1]; j += 2; continue; }
      if (src[j] === "$" && src[j + 1] === "{") { j = skipExpr(j + 2); text += "\u0000"; continue; }
      text += src[j++];
    }
    out.push(text); i += 5;
  }
  return out;
}
const english = (s: string) => /[A-Za-z]{3,}/.test(s.replace(/&[a-z]+;/g, ""));

export function uiLiterals(root = ROOT): string[] {
  const out: string[] = [];
  for (const f of files(root)) {
    if (/-strings\.js$/.test(f)) continue;
    const src = readFileSync(f, "utf8"), at = relative(root, f);
    for (const body of templates(src)) {
      for (const t of body.matchAll(/>([^<>]*)</g)) for (const piece of t[1]!.split("\u0000")) { const text = piece.trim(); if (text && english(text)) out.push(`${at}\ttext\t${text}`); }
      for (const a of body.matchAll(/\b(aria-label|title|placeholder|alt|label|message|confirmLabel|subtitle|text)="([^"\u0000]*)"/g)) if (english(a[2]!)) out.push(`${at}\t${a[1]}\t${a[2]}`);
    }
    for (const c of src.matchAll(/\b(toast|confirmDialog|alert|setError|setMsg|setMessage)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) if (english(c[2]!)) out.push(`${at}\t${c[1]}\t${c[2]}`);
  }
  return out;
}

/** Every register("ns", { en: {…}, "zh-TW": {…} }) in src/ui: the keys each language has. */
function registerTables(): Array<{ at: string; ns: string; en: string[]; zh: string[] }> {
  const tables: Array<{ at: string; ns: string; en: string[]; zh: string[] }> = [];
  for (const f of files(ROOT)) {
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const keys = (o: ts.Expression | undefined): string[] | null => (o && ts.isObjectLiteralExpression(o)
      ? o.properties.flatMap((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [p.name.text] : [])) : null);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "register" && n.arguments.length === 2
        && ts.isStringLiteral(n.arguments[0]!) && ts.isObjectLiteralExpression(n.arguments[1]!)) {
        const byLang = new Map(n.arguments[1].properties.flatMap((p) => (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [[p.name.text, p.initializer] as const] : [])));
        const en = keys(byLang.get("en")), zh = keys(byLang.get("zh-TW"));
        if (en && zh) tables.push({ at: `${relative(ROOT, f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, ns: n.arguments[0].text, en, zh });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return tables;
}

describe("#2390 the web UI's words go through the locale layer", () => {
  it("no English written in place in src/ui (allowlist: names, examples, units)", () => {
    expect(uiLiterals().filter((l) => !ALLOWED.has(l))).toEqual([]);
  });

  it("the allowlist is still needed: every entry is wording the scan finds", () => {
    const found = new Set(uiLiterals());
    expect([...ALLOWED.keys()].filter((a) => !found.has(a))).toEqual([]);
  });

  it("every register() table has the same keys in en and zh-TW", () => {
    const tables = registerTables();
    expect(tables.length).toBeGreaterThan(20);
    const gaps = tables.flatMap((t) => [
      ...t.en.filter((k) => !t.zh.includes(k)).map((k) => `${t.at} ${t.ns}.${k}: no zh-TW`),
      ...t.zh.filter((k) => !t.en.includes(k)).map((k) => `${t.at} ${t.ns}.${k}: no en`),
    ]);
    expect(gaps).toEqual([]);
  });

  it("the scan sees each shape (so a pass means something)", () => {
    const sample = (code: string) => templates(code).some((b) => /[A-Za-z]{3,}/.test(b.replace(/\u0000/g, "").replace(/<[^>]*>/g, "")));
    expect(templates("html`<p>${tn(\"x\")}</p>`")).toEqual(["<p>\u0000</p>"]);
    expect(templates("html`<a>${ok ? html`<b>Done</b>` : null}</a>`")).toEqual(["<a>\u0000</a>", "<b>Done</b>"]);
    expect([sample("html`<p>Hello there</p>`"), sample("html`<p>${t(\"x\")}</p>`")]).toEqual([true, false]);
  });
});
