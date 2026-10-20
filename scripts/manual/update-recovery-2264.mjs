#!/usr/bin/env node
// Offline, inert npm reify/repair probe. Never touches an existing prefix,
// service, fleet, tmux or vendor. Pass a NEW rehearsal directory under HOME.
import * as fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const base = path.resolve(process.argv[2] || '');
if (!process.argv[2] || fs.existsSync(base)) throw Error('Pass a new, empty rehearsal path');
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const prefix = path.join(base, 'prefix');
const cache = path.join(base, 'cache');
const env = { ...process.env, HOME: base, npm_config_prefix: prefix, npm_config_cache: cache, npm_config_registry: 'http://127.0.0.1:9', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_userconfig: path.join(base, 'npmrc'), npm_config_globalconfig: path.join(base, 'global-npmrc') };
fs.writeFileSync(env.npm_config_userconfig, ''); fs.writeFileSync(env.npm_config_globalconfig, '');
const run = (args, extra = {}) => {
  const result = spawnSync('npm', args, { cwd: base, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  return { code: result.status, signal: result.signal, text: `${result.stdout || ''}${result.stderr || ''}` };
};
const assert = (ok, message) => { if (!ok) throw Error(message); };
function fixture(version) {
  const dir = path.join(base, version); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@songsid/agend', version, bin: { agend: 'agend.cjs' }, scripts: { preinstall: 'node probe.cjs' } }));
  fs.writeFileSync(path.join(dir, 'agend.cjs'), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(version)});\n`); fs.chmodSync(path.join(dir, 'agend.cjs'), 0o755);
  fs.writeFileSync(path.join(dir, 'probe.cjs'), "const fs=require('fs'),path=require('path');const scope=path.join(process.env.npm_config_prefix,'lib/node_modules/@songsid');console.log('RETIRED='+fs.readdirSync(scope).filter(n=>/^\\.agend-/.test(n)).join(','));if(process.env.PROBE_FAIL)process.exit(1);\n");
  const packed = run(['pack', dir, '--ignore-scripts', '--json']); assert(packed.code === 0, packed.text);
  return path.join(base, JSON.parse(packed.text)[0].filename);
}
const old = fixture('2.2.5'), target = fixture('2.3.0-beta.17');
const require = createRequire(import.meta.url);
const recovery = require('../../launcher/install-recovery.cjs');
assert(run(['install', '-g', old]).code === 0, 'base install');
const idleProbe = path.join(base, 'idle.cjs');
fs.writeFileSync(idleProbe, `const r=require(${JSON.stringify(require.resolve('../../launcher/install-recovery.cjs'))});if(!r.npmIdle())throw Error('own npm exec blocked cleanup');console.log('own-exec-idle-ok');`);
const throughExec = run(['exec', '--yes', '--package', target, '--', 'node', idleProbe]);
assert(throughExec.code === 0 && throughExec.text.includes('own-exec-idle-ok'), JSON.stringify(throughExec));

const probe = run(['install', '-g', '--foreground-scripts', target], { PROBE_FAIL: '1' });
fs.writeFileSync(path.join(base, 'lifecycle-failure.log'), probe.text);
const retired = /RETIRED=(\.agend-[A-Za-z0-9_-]+)/.exec(probe.text)?.[1];
assert(probe.code !== 0 && retired, `Could not discover npm retirement path: ${probe.text}`);
const sibling = path.join(prefix, 'lib/node_modules/@songsid', retired); fs.mkdirSync(sibling);
fs.writeFileSync(path.join(sibling, 'package.json'), JSON.stringify({ name: '@songsid/agend', version: '2.2.5' }));
fs.writeFileSync(path.join(sibling, 'evidence'), 'left by an interrupted reify');
fs.utimesSync(sibling, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
const collision = run(['install', '-g', target]); fs.writeFileSync(path.join(base, 'collision.log'), collision.text);
assert(collision.code !== 0 && /ENOTEMPTY|EBUSY|EEXIST/.test(collision.text), collision.text);
const bin = path.join(prefix, 'bin/agend');
const before = spawnSync(bin, ['--version'], { env, encoding: 'utf8', timeout: 5_000 });
// The report's already-broken command chain is a distinct injected precondition.
fs.unlinkSync(bin); fs.writeFileSync(path.join(prefix, '.agend-install.lock'), '{partial');
assert(recovery.npmIdle(), 'Another npm is active; rerun after it exits');
const moved = recovery.heal(prefix);
assert(moved.length === 2, `Expected stale sibling + corrupt lock, got ${JSON.stringify(moved)}`);
const repaired = run(['install', '-g', target]); fs.writeFileSync(path.join(base, 'repair.log'), repaired.text);
assert(repaired.code === 0, repaired.text);
const after = spawnSync(bin, ['--version'], { env, encoding: 'utf8', timeout: 5_000 });
assert(after.status === 0 && after.stdout.trim() === '2.3.0-beta.17', 'repaired command must run');
const evidence = { node: process.version, platform: process.platform, uid: process.getuid?.(), npm: run(['--version']).text.trim(), ownNpmExecPermitsCleanup: true, collision: true, collisionAloneKeptOldCommand: before.status === 0 && before.stdout.trim() === '2.2.5', injectedMissingBinThenRepaired: true, quarantinedArtifacts: moved.length, finalVersion: after.stdout.trim(), scratchPrefixOnly: true, realFleetOperations: 0 };
fs.writeFileSync(path.join(base, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
