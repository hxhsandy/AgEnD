import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
const require = createRequire(process.env.PW_DIR + "/");
const pw = require("playwright-core");
const dir = process.argv[2], out = process.argv[3];
const browser = await pw.chromium.launch();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
  const phone = f.startsWith("phone");
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: 2, colorScheme: f.includes("dark") ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto("file://" + dir + "/" + f);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${f.replace(".html", ".png")}` });
  await ctx.close();
}
await browser.close();
console.log("shot");
