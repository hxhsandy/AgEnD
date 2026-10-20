/** #2264: share #1804's /run/user/<uid> default with ordinary systemctl. */
import { statSync } from "node:fs";
import { userInfo } from "node:os";
import { shellQuote } from "./backend/types.js";

export function systemdUserEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  uid = process.getuid?.(),
  isOwnedDirectory: (path: string, uid: number) => boolean = (path, owner) => {
    try { const st = statSync(path); return st.isDirectory() && st.uid === owner; } catch { return false; }
  },
): NodeJS.ProcessEnv {
  if (env.XDG_RUNTIME_DIR || uid === undefined) return env;
  const path = `/run/user/${uid}`;
  return isOwnedDirectory(path, uid) ? { ...env, XDG_RUNTIME_DIR: path } : env;
}

export function prepareSystemdUserEnvironment(): void {
  if (process.platform !== "linux") return;
  const env = systemdUserEnvironment();
  if (env.XDG_RUNTIME_DIR) process.env.XDG_RUNTIME_DIR = env.XDG_RUNTIME_DIR;
}

export function systemdUserRecoveryHint(command = "start"): string {
  const uid = process.getuid?.() ?? 0;
  let user = String(uid);
  try { user = userInfo().username; } catch { /* numeric UID is accepted */ }
  const sudo = uid === 0 ? "" : "sudo ";
  return `If the user manager is missing, run: ${sudo}loginctl enable-linger ${shellQuote(user)} && ${sudo}systemctl start user@${uid}.service && XDG_RUNTIME_DIR=/run/user/${uid} agend ${command}`;
}
