// #2264: a modern aborted update can leave the same marker as a 2.1 updater.
// A marker never proves that a particular version was removed. Never suggest
// a hardcoded downgrade; manual npm is the recovery path after fixing Node.
"use strict";
var FRESH_MS = 60 * 60 * 1000;
function oldUpdaterState(env) {
  env = env || process.env;
  return env.AGEND_UPDATE_KEEPS_PREVIOUS === "1" ? "kept" : "maybe";
}
function oldUpdaterNote(state, env) {
  if (state === "kept") return "";
  env = env || process.env;
  var version = env.AGEND_PREVIOUS_VERSION || env.npm_package_version || "latest";
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) version = "latest";
  return "  If the agend command is missing, fix the reported cause and restore it without deleting your data:\n" +
    "    npm install -g @songsid/agend@" + version + "\n" +
    "    agend start\n";
}
module.exports = { oldUpdaterState: oldUpdaterState, oldUpdaterNote: oldUpdaterNote, FRESH_MS: FRESH_MS };
