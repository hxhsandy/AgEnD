/**
 * #1853 follow-up (the user's real Windows run, 2026-10-20): the Windows installer for people who don't know the console.
 * - Every long step (enabling WSL, updating it, installing the distro, apt, each backend, AgEnD) runs in the background
 *   through Invoke-Watched: its own output is passed through as it comes (a tool's \r progress kept to its last state,
 *   colour codes dropped, wsl.exe's UTF-16 decoded), with a heartbeat — the time so far and how long it usually takes.
 * - While such a step runs, QuickEdit is off (a click no longer freezes it) and Ctrl+C is read as a key: it asks
 *   "stop?" instead of killing the step; both come back as they were when the step ends.
 * - A plain notice at the start says how to copy and paste, and not to press Ctrl+C; the login and quickstart steps say
 *   it again where it matters.
 * The helpers are the installer's own functions, taken from its syntax tree and run in pwsh (GitHub's ubuntu runners
 * have it). The console itself (QuickEdit, the live status line, a real Ctrl+C) is the user's Windows checklist.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const INSTALLER = join(import.meta.dirname, "..", "website", "public", "install-agend.ps1");
const text = readFileSync(INSTALLER, "utf8");
const code = text.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");

describe("the installer's long steps and console guards (static)", () => {
  it("every long step goes through the watched runner — none is silenced any more", () => {
    for (const step of [/Invoke-Watched -Label "啟用 WSL 功能"[^\n]*Microsoft-Windows-Subsystem-Linux/, /Invoke-Watched -Label "啟用虛擬機器平台"[^\n]*VirtualMachinePlatform/,
      /Invoke-Watched -Label "更新 WSL 核心元件"[^\n]*"--update"\)/, /Invoke-Watched -Label "從 GitHub 更新 WSL"[^\n]*"--update", "--web-download"/,
      /Invoke-Watched -Label "安裝 WSL"[^\n]*msiexec\.exe/, /Invoke-Watched -Label "下載並安裝 \$UBUNTU_DISTRO"[^\n]*"--install"/,
      /Invoke-WslStep -Label "安裝必要套件"/, /Invoke-WslStep -Label \("安裝 \{0\}" -f \$b\.Name\)[^\n]*-Script \$cmd/,
      /Invoke-WslStep -Label "安裝 tmux"/, /Invoke-WslStep -Label "安裝 AgEnD 與 Node\.js"/]) expect(code).toMatch(step);
    expect(code).not.toMatch(/wsl --update 2>&1 \| Out-String/);
    expect(code).not.toMatch(/dism\.exe[^\n]*Out-Null/);
    expect(code).not.toMatch(/^\s*wsl --install/m);
    expect(code).not.toMatch(/apt-get install[^\n]*Out-Null/);
  });
  it("QuickEdit off and Ctrl+C read as a key only while a step runs, both put back in a finally", () => {
    const fn = code.slice(code.indexOf("function Invoke-Watched"), code.indexOf("function Confirm-StopInstall"));
    expect(fn).toMatch(/\[Console\]::TreatControlCAsInput = \$true/);
    expect(fn).toMatch(/Set-QuickEdit \$true/);
    const fin = fn.slice(fn.lastIndexOf("} finally {"));
    expect(fin).toMatch(/\[Console\]::TreatControlCAsInput = \$savedCtrlC/);
    expect(fin).toMatch(/Set-QuickEdit \$false/);
    expect(fin).toMatch(/WSL_UTF8/);
    const qe = code.slice(code.indexOf("function Set-QuickEdit"), code.indexOf("function Format-Elapsed"));
    expect(qe).toMatch(/-bor 0x80/);                                         // ENABLE_EXTENDED_FLAGS, or the change is ignored
    expect(qe).toMatch(/if \(\$new -band 0x40\) \{ \$new = \$new - 0x40 \}/);  // ENABLE_QUICK_EDIT_MODE cleared
    expect(qe).toMatch(/\$script:ConsoleModeSaved -bor 0x80/);              // restored to what it was
  });
  it("a plain notice at the start, and again at the login and quickstart steps", () => {
    for (const line of ["複製：用滑鼠選取文字，再按右鍵（或 Enter）。", "貼上：在視窗裡按一下右鍵。", "請不要按 Ctrl+C：在這個視窗裡，它不是「複製」，而是「停止」。",
      "自動安裝時點到視窗也沒關係，不會讓安裝暫停。", "登入時請不要按 Ctrl+C：它會直接關掉登入程式。", "要貼上 Bot Token：在視窗裡按一下右鍵。",
      "設定時請不要按 Ctrl+C：它會直接結束設定。"]) expect(text).toContain(line);
    expect(text.indexOf("使用這個視窗前，先看這幾點")).toBeLessThan(text.indexOf("檢查網路連線"));
  });
  it("still UTF-8 with a BOM (its Chinese renders in Windows PowerShell 5.1)", () => {
    expect([...readFileSync(INSTALLER).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

const pwsh = spawnSync("pwsh", ["-NoProfile", "-c", "1"], { encoding: "utf8" }).status === 0;
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Run a pwsh script with the installer's helper functions loaded (from its syntax tree; nothing else of it runs). */
function withHelpers(body: string, input?: string) {
  const dir = mkdtempSync(join(tmpdir(), "agend-1853ux-")); dirs.push(dir);
  const file = join(dir, "t.ps1");
  writeFileSync(file, `$ErrorActionPreference = 'Stop'
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${INSTALLER}', [ref]$t, [ref]$e)
foreach ($fn in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { . ([scriptblock]::Create($fn.Extent.Text)) }
$script:OnWindows = $false
${body}`);
  const r = spawnSync("pwsh", ["-NoProfile", "-File", file], { encoding: "utf8", timeout: 60_000, input, env: { ...process.env, TMPDIR: dir } });
  return { out: r.stdout + r.stderr, dir };
}

describe.skipIf(!pwsh)("with pwsh: the installer's own helpers", { timeout: 90_000 }, () => {
  it("a tool's output: colour codes dropped, \\r progress kept to its last state, the unfinished tail is the live progress", () => {
    const { out } = withHelpers(`$c = Split-ToolOutput ("one\`n\`e[32m下載中 10%\`r下載中 50%\`r下載中 100%\`e[0m\`n\`r\`nhalf 3\`rhalf 7")
Write-Output ("LINES=" + (($c.Lines -join '|') -replace "\\e", '<ESC>')); Write-Output ("PROGRESS=" + $c.Progress); Write-Output ("REST=" + ($c.Rest -replace "\`r", '<CR>'))`);
    expect(out).toContain("LINES=one|下載中 100%\n");                         // pwsh drops escapes it prints itself: they are shown as <ESC>
    expect(out).toContain("PROGRESS=half 7\n");
    expect(out).toContain("REST=half 3<CR>half 7\n");
  });
  it("wsl.exe's UTF-16LE is read as such, even when it starts with Chinese; UTF-8 split across reads is joined", () => {
    const { out } = withHelpers(`$f = Join-Path $env:TMPDIR 'u16.txt'
[IO.File]::WriteAllBytes($f, [Text.Encoding]::Unicode.GetBytes('正'))
$tail = New-OutputTail $f
$first = Read-OutputTail $tail $false
$s = [IO.File]::Open($f, 'Append', 'Write', 'ReadWrite'); $b = [Text.Encoding]::Unicode.GetBytes("在檢查更新。\`r\`n"); $s.Write($b, 0, $b.Length); $s.Close()
$second = Read-OutputTail $tail $false
Write-Output ("U16=[" + $first + "][" + ($second -replace "\`r\`n", '<CRLF>') + "]")
$g = Join-Path $env:TMPDIR 'u8.txt'; $all = [Text.Encoding]::UTF8.GetBytes("中文輸出完成\`n")
[IO.File]::WriteAllBytes($g, $all[0..3]); $t8 = New-OutputTail $g
$a = Read-OutputTail $t8 $false
$s = [IO.File]::Open($g, 'Append', 'Write', 'ReadWrite'); $s.Write($all, 4, $all.Length - 4); $s.Close()
$b2 = Read-OutputTail $t8 $false
Write-Output ("U8=[" + $a + "][" + ($b2 -replace "\`n", '<LF>') + "]")`);
    expect(out).toContain("U16=[][正在檢查更新。<CRLF>]");                       // nothing decided before the newline: no mojibake
    expect(out).toContain("U8=[][中文輸出完成<LF>]");
  });
  it("a long step: its output as it comes, a heartbeat with the time and how long it usually takes, its exit code; nothing left behind", () => {
    const { out, dir } = withHelpers(`Remove-Item Env:WSL_UTF8 -ErrorAction SilentlyContinue
$code = Invoke-Watched -Label '測試步驟' -Usually '通常需要 1 分鐘' -File 'sh' -Arguments @('-c', 'echo "line one WSL_UTF8=$WSL_UTF8"; sleep 2.6; printf "中文完成"; echo err-line >&2; exit 3') -HeartbeatSeconds 1 -UpperMinutes 0.025
Write-Output "CODE=$code"
Write-Output ("AFTER_UTF8=[" + $env:WSL_UTF8 + "]")
Write-Output ("LEFT=" + @(Get-ChildItem $env:TMPDIR -Filter 'agend-step-*').Count)`);
    expect(out).toContain("    line one WSL_UTF8=1\n");                    // wsl.exe is asked for UTF-8 …
    expect(out).toContain("AFTER_UTF8=[]");                                 // … for that step only
    expect(out).toMatch(/\.\.\. 測試步驟：已經過 1 秒（通常需要 1 分鐘）\n/);
    expect(out).toMatch(/\.\.\. 測試步驟：已經過 2 秒（通常需要 1 分鐘），比平常久，仍在進行中，請不要關閉視窗\n/);
    expect(out).toContain("    中文完成\n");                                 // a last line without a newline is still shown
    expect(out).toContain("    err-line\n");
    expect(out).toMatch(/測試步驟：用了 \d 秒/);
    expect(out).toContain("CODE=3\n");
    expect(out).toContain("LEFT=0\n");
    expect(readFileSync(join(dir, "t.ps1"), "utf8")).toBeTruthy();
  });
  it("a long step's argument with spaces reaches it whole", () => {
    const { out } = withHelpers(`$code = Invoke-Watched -Label 'x' -Usually 'y' -File 'sh' -Arguments @('-c', 'printf "[%s]\\n" "$0"', 'C:\\Users\\Han Sung\\a b.msi')
Write-Output "CODE=$code"`);
    expect(out).toContain("    [C:\\Users\\Han Sung\\a b.msi]\n");
    expect(out).toContain("CODE=0\n");
  });
  it("Ctrl+C during a step asks first: Enter carries on, y stops the step", () => {
    const keep = withHelpers(`$p = Start-Process sleep -ArgumentList 30 -PassThru
$stop = Confirm-StopInstall $p
Write-Output ("STOP=" + $stop + " ALIVE=" + (-not $p.HasExited)); $p.Kill()`, "\n");
    expect(keep.out).toContain("Ctrl+C 是「停止」，不是「複製」");
    expect(keep.out).toContain("安裝還在背景繼續進行，沒有中斷。");
    expect(keep.out).toContain("STOP=False ALIVE=True");
    const stop = withHelpers(`$p = Start-Process sleep -ArgumentList 30 -PassThru
$stop = Confirm-StopInstall $p
Start-Sleep -Milliseconds 300
Write-Output ("STOP=" + $stop + " ALIVE=" + (-not $p.HasExited))`, "y\n");
    expect(stop.out).toContain("STOP=True ALIVE=False");
    expect(stop.out).toContain("之後再執行同一行安裝指令（或此腳本），會從還沒完成的步驟繼續。");
  });
  it("the status line fits the window: Chinese counts as two columns", () => {
    const { out } = withHelpers(`Write-Output ("W=" + (Get-DisplayWidth '安裝 AgEnD') + " CUT=" + (Limit-Width '下載並安裝 Ubuntu-24.04：已經過 3 分 05 秒' 20) + " CUTW=" + (Get-DisplayWidth (Limit-Width '下載並安裝 Ubuntu-24.04：已經過 3 分 05 秒' 20)))
Write-Output ("ELAPSED=" + (Format-Elapsed 59.9) + "|" + (Format-Elapsed 185))
Set-QuickEdit $true; Set-QuickEdit $false; Write-Output "QE-NOOP-OK"`);
    expect(out).toContain("W=10 ");
    expect(out).toMatch(/CUTW=(1\d|20)\n/);
    expect(out).toContain("ELAPSED=59 秒|3 分 05 秒\n");
    expect(out).toContain("QE-NOOP-OK");                                     // not Windows: QuickEdit is left alone, no error
  });
});
