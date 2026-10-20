/** npm fetches the exact release with integrity verification into its cache;
 * that release owns install/upgrade/repair, never the old updater's code. */
export function targetInstallerCommand(version: string, previous: string, force = false): { command: string; args: string[] } {
  const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!exact.test(version) || !exact.test(previous)) throw Error("Installer handoff requires exact versions");
  return { command: "npm", args: ["exec", "--yes", "--package", `@songsid/agend@${version}`, "--", "agend-install", "--upgrade", "--version", version, "--from-version", previous, "--yes", ...(force ? ["--force"] : [])] };
}
