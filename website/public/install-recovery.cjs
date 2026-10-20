"use strict";
// #2264: one non-destructive cleanup policy for update and the official
// installer. Unknown, recent, foreign-owner and live npm files stay put.
var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var crypto = require("crypto");
var MIN_AGE = 15 * 60 * 1000;
// npm exec waits while its target installer runs; it is not a concurrent
// prefix reify. Only that installer's own exec ancestors may be ignored.
function npmIdleFromProcessList(output, ownPid) {
  var rows = String(output).trim().split("\n").map(function (line) {
    var m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return m ? { pid: Number(m[1]), parent: Number(m[2]), args: m[3] } : null;
  });
  if (!rows.length || rows.some(function (row) { return !row; })) return false;
  var ancestors = {};
  var pid = ownPid;
  while (pid > 1 && !ancestors[pid]) {
    ancestors[pid] = true;
    var row = rows.find(function (r) { return r.pid === pid; });
    if (!row) return false;
    pid = row.parent;
  }
  return !rows.some(function (row) {
    var npm = /^(?:\S*\/)?(?:npm|npx)(?:\s|$)/.test(row.args)
      || /^\S*node\s+\S*(?:npm|npx)-cli\.js(?:\s|$)/.test(row.args);
    if (!npm) return false;
    var exec = /^(?:\S*\/)?npm\s+exec(?:\s|$)/.test(row.args)
      || /^\S*node\s+\S*npm-cli\.js\s+exec(?:\s|$)/.test(row.args);
    return !(ancestors[row.pid] && exec);
  });
}
function npmIdle() {
  try {
    var r = cp.spawnSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8", timeout: 5000 });
    return r.status === 0 && npmIdleFromProcessList(r.stdout, process.pid);
  } catch (e) { return false; }
}
function legacyBinConflict(prefix) {
  try {
    var old = path.join(prefix, "lib", "node_modules", "@suzuke", "agend");
    var manifest = JSON.parse(fs.readFileSync(path.join(old, "package.json"), "utf8"));
    var bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin && manifest.bin.agend;
    return manifest.name === "@suzuke/agend" && typeof bin === "string"
      && fs.realpathSync(path.join(prefix, "bin", "agend")) === fs.realpathSync(path.join(old, bin));
  } catch (e) { return false; }
}
function heal(prefix, options) {
  var o = options || {};
  var idle = o.noNpmRunning === undefined ? npmIdle() : o.noNpmRunning;
  var uid = o.uid === undefined && process.getuid ? process.getuid() : o.uid;
  var now = o.now === undefined ? Date.now() : o.now;
  var age = o.minimumAge === undefined ? MIN_AGE : o.minimumAge;
  var scope = path.join(prefix, "lib", "node_modules", "@songsid");
  var moved = [];
  if (!idle || uid === undefined) return moved;
  [".agend-install.lock", ".agend-install.lock.reclaim"].forEach(function (name) {
    var source = path.join(prefix, name);
    try {
      var st = fs.lstatSync(source);
      if (!st.isFile() || st.uid !== uid) return;
      var record = null;
      try { record = JSON.parse(fs.readFileSync(source, "utf8")); } catch (e) { /* abandoned partial write */ }
      if (record && Number.isSafeInteger(record.pid) && record.pid > 0) {
        var alive = true;
        try { process.kill(record.pid, 0); } catch (e) { alive = e.code !== "ESRCH"; }
        if (alive) {
          var boot = null;
          try { boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch (e) { /* not Linux */ }
          // A proven different boot is abandoned. Unknown/live owners stay.
          if (!boot || !record.bootId || boot === record.bootId) return;
        }
      }
      var quarantine = path.join(prefix, ".agend-recovery");
      fs.mkdirSync(quarantine, { recursive: true, mode: 448 });
      var dest = path.join(quarantine, name + "-" + crypto.randomBytes(8).toString("hex"));
      fs.renameSync(source, dest);
      moved.push(dest);
    } catch (e) { /* Preserve unknown permissions or ownership. */ }
  });
  var names;
  try { names = fs.readdirSync(scope); } catch (e) { return moved; }
  names.forEach(function (name) {
    if (!/^\.agend-[A-Za-z0-9_-]+$/.test(name)) return;
    var source = path.join(scope, name);
    try {
      var st = fs.lstatSync(source);
      if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || now - st.mtimeMs < age) return;
      // A manually repaired command may intentionally point at a retained
      // directory. Never move a payload still in the command chain.
      if (["agend", "agend-agent", "agend-install"].some(function (bin) {
        try { var real = fs.realpathSync(path.join(prefix, "bin", bin)); return real === source || real.indexOf(source + path.sep) === 0; } catch (e) { return false; }
      })) return;
      var json = fs.lstatSync(path.join(source, "package.json"));
      if (!json.isFile() || json.isSymbolicLink() || json.size > 65536) return;
      var manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
      if (manifest.name !== "@songsid/agend" || typeof manifest.version !== "string") return;
      var quarantine = path.join(prefix, ".agend-recovery");
      fs.mkdirSync(quarantine, { recursive: true, mode: 448 });
      // Same filesystem, preserve evidence. Never rm -rf a guessed sibling.
      var dest = path.join(quarantine, name + "-" + crypto.randomBytes(8).toString("hex"));
      fs.renameSync(source, dest);
      moved.push(dest);
    } catch (e) { /* Cannot prove ownership/type/age: keep it. */ }
  });
  return moved;
}
module.exports = { heal: heal, npmIdle: npmIdle, npmIdleFromProcessList: npmIdleFromProcessList, legacyBinConflict: legacyBinConflict, MIN_AGE: MIN_AGE };
if (require.main === module) {
  if (!process.argv[2] || !path.isAbsolute(process.argv[2])) process.exit(2);
  if (process.argv[3] === "--legacy-bin-conflict") process.exit(legacyBinConflict(process.argv[2]) ? 0 : 1);
  heal(process.argv[2]).forEach(function (p) { console.log("Preserved abandoned install artifact at " + p); });
}
