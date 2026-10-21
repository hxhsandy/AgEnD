#!/usr/bin/env python3
"""Settings redesign mockups (#2345 design): 4 screens x desk/phone x light(en)/dark(zh-TW). Demo data only."""
import html, os

OUT = os.path.dirname(os.path.abspath(__file__))

T = {
 "en": dict(
  settings="Settings", inst="Instances", find="Search", search="Search settings", searchHint="token, 語言, session…",
  gYou="You", gFleet="Fleet",
  sPrefs="Preferences", sLook="Look", sAgents="Agents", sDefaults="Agent defaults", sChat="Chat & connections",
  sWeb="Web dashboard", sAccess="Access & security", sAdv="Advanced",
  subPrefs="Theme, language, this device", subLook="Themes, colours, CSS, effects", subAgents="Your agents, sign-ins, API keys",
  subDefaults="Backend, model, reply language", subChat="Telegram, Discord, ClassicBot", subWeb="Log tab, usage, app icon",
  subAccess="Sessions, guests, public link", subAdv="fleet.yaml editor",
  accessLead="Who can reach the dashboard and how. Loosening access waits for a fleet admin's OK; tightening applies at once.",
  cSessions="Sign-in sessions", fLen="Session length", fLenH="Hours a sign-in lasts (1–720).", fIdle="Sign out after unused for", fIdleH="Hours without use (1–720).",
  cPublic="Public link & fixed address", cPublicN="A temporary https link for your phone. A fixed address needs a Cloudflare named tunnel.",
  fAllow="Offer temporary public links", fHost="Fixed public address", fHostH="Leave empty for a random quick-tunnel address.",
  fToken="Cloudflare connector token", fTokenH="Write-only: stored privately, never shown again.", tokenSet="Saved · ends in …x7Qa", tokenNew="", tokenNewChip="New", tokenWill="Will be replaced on Save",
  fMin="Public link minutes", fMinH="1–480.", fProto="Tunnel protocol",
  cTerm="Browser terminal", fTerm="Allow the browser terminal", fTtl="Terminal session minutes", fTtlH="1–20.", errTtl="Enter a number from 1 to 20.",
  was="was", def48="48 (default)", h72="72",
  tNow="Applies now", tOk="Needs an admin's OK", tAgent="Restarts 3 agents", tFleet="Restart AgEnD",
  barN="4 unsaved changes", barSum="2 need a fleet admin's OK · 1 field needs fixing", review="Review", discard="Discard", save="Save", fix="Fix 1 field to save",
  banner="1 saved change takes effect after AgEnD restarts.", bannerShort="1 change needs an AgEnD restart.", restartNow="Restart AgEnD now", later="Later",
  sheetT="Saved — 4 changes", sheetN="What happens to each:",
  r1="Session length → 72 h", r1n="Applied", r2="Fixed public address → agend.example.com", r2n="Waiting for a fleet admin's OK in General · Withdraw",
  r3="Cloudflare connector token", r3n="Replaced — the public link reconnects", r4="Bot reply language → 繁體中文", r4n="Takes effect after AgEnD restarts",
  r5="Default model → sonnet", r5n="Restarting dev-1, dev-2, docs-writer…", oneRestart="One restart applies every change waiting for it.",
  q="token", rgAccess="Access & security › Public link & fixed address", rgChat="Chat & connections › Connections", rgAgents="Agents › Sign-ins & API keys",
  h1="Cloudflare connector <mark>token</mark>", h1k="web.public_link · tunnel token (secret)", h2="Bot <mark>token</mark> — Replace", h2k="channels[telegram-main] · token", h3="Provider API keys (OpenAI, Anthropic…)", h3k="matches: key, <mark>token</mark>", h4="Bot <mark>token</mark> — Replace", h4k="channels[discord-home] · token",
  hSetting="Setting", hAction="Opens dialog", foot="↑↓ move · Enter go there · Esc close · also under Ctrl K → Settings",
  tabs=["Chat", "Needs you", "Fleet", "Settings"], back="Settings",
 ),
 "zh": dict(
  settings="設定", inst="Instances", find="搜尋", search="搜尋設定", searchHint="token、語言、session…",
  gYou="你自己", gFleet="整個 Fleet",
  sPrefs="偏好", sLook="外觀", sAgents="Agent", sDefaults="Agent 預設值", sChat="聊天與連線",
  sWeb="網頁儀表板", sAccess="存取與安全", sAdv="進階",
  subPrefs="主題、語言、這台裝置", subLook="主題、顏色、CSS、特效", subAgents="你的 agent、登入、API 金鑰",
  subDefaults="後端、模型、回覆語言", subChat="Telegram、Discord、ClassicBot", subWeb="紀錄分頁、用量、App 圖示",
  subAccess="工作階段、訪客、公開連結", subAdv="fleet.yaml 編輯器",
  accessLead="誰能連到儀表板、怎麼連。放寬存取要等 fleet 管理員同意；收緊則立即生效。",
  cSessions="登入工作階段", fLen="工作階段長度", fLenH="一次登入可維持幾小時（1–720）。", fIdle="閒置多久後登出", fIdleH="未使用的小時數（1–720）。",
  cPublic="公開連結與固定網址", cPublicN="給手機用的暫時 https 連結。固定網址需要 Cloudflare 具名通道。",
  fAllow="提供暫時公開連結", fHost="固定公開網址", fHostH="留空則使用隨機的快速通道網址。",
  fToken="Cloudflare 連接器 token", fTokenH="只寫不讀：私下保存，不會再顯示。", tokenSet="已儲存・結尾為 …x7Qa", tokenNew="", tokenNewChip="新的", tokenWill="按儲存後替換",
  fMin="公開連結分鐘數", fMinH="1–480。", fProto="通道協定",
  cTerm="瀏覽器終端機", fTerm="允許瀏覽器終端機", fTtl="終端機工作階段分鐘數", fTtlH="1–20。", errTtl="請輸入 1 到 20 的數字。",
  was="原本", def48="48（預設）", h72="72",
  tNow="立即生效", tOk="需管理員同意", tAgent="會重啟 3 個 agent", tFleet="需重啟 AgEnD",
  barN="4 項變更未儲存", barSum="2 項需 fleet 管理員同意・1 個欄位需修正", review="檢視", discard="捨棄", save="儲存", fix="修正 1 個欄位後才能儲存",
  banner="有 1 項已儲存的變更，要重新啟動 AgEnD 後才會生效。", bannerShort="1 項變更需重啟 AgEnD。", restartNow="立即重新啟動 AgEnD", later="稍後",
  sheetT="已儲存 —— 4 項變更", sheetN="每一項的狀態：",
  r1="工作階段長度 → 72 小時", r1n="已套用", r2="固定公開網址 → agend.example.com", r2n="等待 fleet 管理員在 General 同意・撤回",
  r3="Cloudflare 連接器 token", r3n="已替換 —— 公開連結會重新連線", r4="Bot 回覆語言 → 繁體中文", r4n="重新啟動 AgEnD 後生效",
  r5="預設模型 → sonnet", r5n="正在重啟 dev-1、dev-2、docs-writer…", oneRestart="重新啟動一次，就會套用所有等待中的變更。",
  q="語言", rgAccess="偏好 › 同步的偏好", rgChat="Agent 預設值 › 回覆", rgAgents="聊天與連線 › ClassicBot",
  h1="儀表板<mark>語言</mark>", h1k="個人偏好 lang · 同義：介面、language", h2="Bot 回覆<mark>語言</mark>", h2k="defaults.locale · 同義：locale、回覆語系", h3="ClassicBot 回覆<mark>語言</mark>（沿用預設值）", h3k="classic.defaults · locale", h4="Agent 的回覆<mark>語言</mark>（各 agent）", h4k="instances.*.locale",
  hSetting="設定", hAction="開啟對話框", foot="↑↓ 移動・Enter 前往・Esc 關閉・也可從 Ctrl K → 設定 找到",
  tabs=["聊天", "等你處理", "Fleet", "設定"], back="設定",
 ),
}
# The search screen in zh-TW uses its own groups (語言 matches other sections).

def esc(s): return html.escape(s, quote=False)

def page(body, theme, phone):
    return f"""<!doctype html><html lang="en" data-theme="{theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>mock</title>
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="mock.css"></head>
<body>{body}</body></html>"""

def app_side(t):
    rows = "".join(f'<div class="mk-row"><span class="mk-dot"></span><span class="mk-grow">{n}</span></div>' for n in ["General", "dev-1", "dev-2", "docs-writer", "reviewer-a"])
    return f"""<aside class="mk-side"><div class="mk-brand">AgEnD</div>
<div class="mk-row">⌂ {t['tabs'][2]}</div><div class="mk-row">• {t['tabs'][1]}</div><div class="mk-row">⌕ {t['find']} <span class="mk-grow"></span><span class="note">Ctrl K</span></div>
<div class="mk-label">{t['inst']}</div>{rows}<div class="mk-grow"></div><div class="mk-row on">⚙ {t['settings']}</div></aside>"""

def nav(t, active, counts=None, search_on=False, q=""):
    counts = counts or {}
    def item(key, label):
        c = counts.get(key)
        return f'<div class="sx-item{" on" if key == active else ""}">{label}{f"<span class=sx-count>{c}</span>" if c else ""}</div>'
    s = f'<div class="sx-search{" on" if search_on else ""}">⌕ <span>{q or t["search"]}</span><kbd>/</kbd></div>'
    return f"""<nav class="sx-nav">{s}
<div class="sx-group">{t['gYou']}</div>{item('prefs', t['sPrefs'])}{item('look', t['sLook'])}
<div class="sx-group">{t['gFleet']}</div>{item('agents', t['sAgents'])}{item('defaults', t['sDefaults'])}{item('chat', t['sChat'])}
{item('web', t['sWeb'])}{item('access', t['sAccess'])}{item('adv', t['sAdv'])}</nav>"""

def field(lab, help_, control, key=None, dirty=None, tags=(), err=None):
    tg = "".join(f'<span class="sx-tag {k}">{v}</span>' for k, v in tags)
    was = f'<div class="sx-was">{dirty}</div>' if dirty else ""
    keyl = f'<div class="sx-key">{key}</div>' if key else ""
    errl = f'<div class="sx-errmsg">⚠ {err}</div>' if err else ""
    return f"""<div class="sx-field{' dirty lbar' if dirty or tags else ''}"><div><div class="sx-lab">{lab}{tg}</div><div class="sx-help">{help_}</div>{was}{keyl}</div>{control}{errl}</div>"""

def inp(v, ph=False, err=False): return f'<div class="sx-input{" ph" if ph else ""}{" err" if err else ""}">{v}</div>'
def tog(on): return f'<div class="sx-toggle{" on" if on else ""}"></div>'

def access_cards(t, dirty):
    D = dirty
    if D:
        # The unsaved frames: only the cards and fields that changed, so all four (and the error) are in view.
        sess = f"""<section class="sx-card"><h3>{t['cSessions']}</h3>
{field(t['fLen'], t['fLenH'], inp(t['h72']), 'web.session.local.absolute_hours', dirty=f"{t['was']} <s>48</s>", tags=(('now', t['tNow']), ('confirm', t['tOk'])))}</section>"""
        term = f"""<section class="sx-card"><h3>{t['cTerm']}</h3>
{field(t['fTtl'], t['fTtlH'], inp('45', err=True), 'web_terminal.ttl_minutes', dirty=f"{t['was']} <s>10</s>", err=t['errTtl'])}</section>"""
        secret = f'<div class="sx-secret"><div class="sx-input">••••••••••••</div><span class="sx-chip">{t["tokenNewChip"]}</span></div>'
        pub = f"""<section class="sx-card"><h3>{t['cPublic']}</h3>
{field(t['fHost'], t['fHostH'], inp('agend.example.com'), 'web.public_link.hostname', dirty=f"{t['was']} <s>—</s>", tags=(('now', t['tNow']), ('confirm', t['tOk'])))}
{field(t['fToken'], t['fTokenH'], secret, None, dirty=t['tokenWill'], tags=(('now', t['tNow']),))}</section>"""
        return sess + term + pub
    sess = f"""<section class="sx-card"><h3>{t['cSessions']}</h3>
{field(t['fLen'], t['fLenH'], inp(t['def48'], ph=True), 'web.session.local.absolute_hours')}
{field(t['fIdle'], t['fIdleH'], inp(t['def48'], ph=True), 'web.session.local.idle_hours')}</section>"""
    secret = f'<div class="sx-secret"><div class="sx-input ph">••••••••</div><span class="sx-chip">{t["tokenSet"]}</span></div>'
    pub = f"""<section class="sx-card"><h3>{t['cPublic']}</h3><p class="sx-cardnote">{t['cPublicN']}</p>
{field(t['fAllow'], '', tog(True), 'web.public_link.allow_public')}
{field(t['fHost'], t['fHostH'], inp('—', ph=True), 'web.public_link.hostname')}
{field(t['fToken'], t['fTokenH'], secret)}</section>"""
    term = f"""<section class="sx-card"><h3>{t['cTerm']}</h3>
{field(t['fTerm'], '', tog(True), 'web_terminal.enabled')}
{field(t['fTtl'], t['fTtlH'], inp('10'), 'web_terminal.ttl_minutes')}</section>"""
    return sess + term + pub

def desk(t, theme, which):
    counts = {"access": 4} if which in ("unsaved",) else {}
    banner = ""
    pop = ""
    q = ""
    if which == "saved":
        banner = f'<div class="sx-banner"><span class="sx-bi"></span><span class="mk-grow">{t["banner"]}</span><button class="btn btn-primary btn-sm">{t["restartNow"]}</button><button class="btn btn-sm">{t["later"]}</button></div>'
    if which == "search":
        q = t["q"]
    content = f'<div class="sx-title">{t["sAccess"]}</div>' + ('' if which == "unsaved" else f'<p class="sx-lead">{t["accessLead"]}</p>')
    if which == "saved":
        content += f"""<div class="sx-sheet"><h3>{t['sheetT']}</h3><p class="sx-sheetnote">{t['sheetN']}</p>
<div class="sx-res"><span class="sx-st ok">✓</span><span>{t['r1']}</span><span class="sx-rnote">{t['r1n']}</span></div>
<div class="sx-res"><span class="sx-st ok">✓</span><span>{t['r3']}</span><span class="sx-rnote">{t['r3n']}</span></div>
<div class="sx-res"><span class="sx-st wait">…</span><span>{t['r2']}</span><span class="sx-rnote">{t['r2n']}</span></div>
<div class="sx-res"><span class="sx-st agent">↻</span><span>{t['r5']}</span><span class="sx-rnote">{t['r5n']}</span></div>
<div class="sx-res"><span class="sx-st fleet">!</span><span>{t['r4']}</span><span class="sx-rnote">{t['r4n']}</span></div>
<p class="sx-sheetnote" style-x="">{t['oneRestart']}</p>
<div class="sx-actions"><button class="btn">{t['later']}</button><button class="btn btn-primary">{t['restartNow']}</button></div></div>"""
        content += access_cards(t, False)
    else:
        content += access_cards(t, which == "unsaved")
    bar = ""
    if which == "unsaved":
        bar = f"""<div class="sx-bar"><strong>{t['barN']}</strong><span class="sx-sum">{t['barSum']}</span><a class="sx-review">{t['review']}</a>
<span class="mk-grow"></span><span class="sx-errs">{t['fix']}</span><button class="btn">{t['discard']}</button><button class="btn btn-primary" disabled>{t['save']}</button></div>"""
    if which == "search":
        groups = [(t["rgAccess"], [(t["h1"], t["h1k"], t["hSetting"], True)]), (t["rgChat"], [(t["h2"], t["h2k"], t["hAction"], False), (t["h4"], t["h4k"], t["hAction"], False)] if t is T["en"] else [(t["h2"], t["h2k"], t["hSetting"], False)]),
                  (t["rgAgents"], [(t["h3"], t["h3k"], t["hSetting"], False)] if t is T["en"] else [(t["h3"], t["h3k"], t["hSetting"], False), (t["h4"], t["h4k"], t["hAction"], False)])]
        rows = "".join(f'<div class="sx-rg">{g}</div>' + "".join(f'<div class="sx-hit{" on" if on else ""}"><span class="sx-hl">{h}</span><span class="sx-kind">{k}</span><span class="sx-hk">{key}</span></div>' for h, key, k, on in hs) for g, hs in groups)
        pop = f'<div class="sx-pop">{rows}<div class="sx-foot">{t["foot"]}</div></div>'
    main = f"""<div class="mk-main">{banner}<div class="mk-head"><h1>{t['settings']}</h1><span class="mk-grow"></span><button class="btn btn-ghost btn-sm">Setup wizard</button></div>
<div class="mk-body">{nav(t, 'access', counts, which == 'search', q)}<div class="sx-content{' sx-dim' if which == 'search' else ''}"><div class="col">{content}</div></div></div>{bar}{pop}</div>"""
    side = app_side(t).replace('<aside class="mk-side">', '<aside class="mk-side sx-dim">') if which == 'search' else app_side(t)
    return page(f'<div class="mk-desk">{side}{main}</div>', theme, False)

def phone(t, theme, which):
    tabs = "".join(f'<span class="{"on" if i == 3 else ""}">{n}</span>' for i, n in enumerate(t["tabs"]))
    if which == "home":
        def it(lab, sub, c=""): return f'<div class="sx-item"><span>{lab}<span class="sx-sub">{sub}</span></span>{c}<span class="sx-chev">›</span></div>'
        body = f"""<div class="mk-ptop">{t['settings']}</div><div class="mk-pbody"><div class="sx-search">⌕ <span>{t['search']} — {t['searchHint']}</span></div>
<div class="sx-group">{t['gYou']}</div><div class="mk-plist">{it(t['sPrefs'], t['subPrefs'])}{it(t['sLook'], t['subLook'])}</div>
<div class="sx-group">{t['gFleet']}</div><div class="mk-plist">{it(t['sAgents'], t['subAgents'])}{it(t['sDefaults'], t['subDefaults'])}{it(t['sChat'], t['subChat'])}{it(t['sWeb'], t['subWeb'])}{it(t['sAccess'], t['subAccess'], '<span class="sx-count" style-x="">4</span>')}{it(t['sAdv'], t['subAdv'])}</div></div>"""
        # The count chip needs the sx-count class inside sx-item.
        body = body.replace('<span class="sx-count" style-x="">4</span>', '<span class="sx-count">4</span>')
        return page(f'<div class="mk-phone">{body}<div class="mk-tabs">{tabs}</div></div>', theme, True)
    if which == "unsaved":
        body = f"""<div class="mk-ptop"><span class="mk-back">‹ {t['back']}</span><span class="mk-grow"></span></div><div class="mk-pbody">
{access_cards(t, True).split('</section>', 1)[1]}</div>
<div class="sx-bar"><div class="mk-grow"><strong>{t['barN']}</strong><div class="sx-errs">{t['fix']}</div></div><button class="btn btn-sm">{t['discard']}</button><button class="btn btn-primary btn-sm" disabled>{t['save']}</button></div>"""
        return page(f'<div class="mk-phone">{body}<div class="mk-tabs">{tabs}</div></div>', theme, True)
    if which == "saved":
        body = f"""<div class="sx-banner"><span class="sx-bi"></span><span class="mk-grow">{t['banner']}</span><button class="btn btn-sm">{t['later']}</button><button class="btn btn-primary btn-sm">{t['restartNow']}</button></div>
<div class="mk-ptop"><span class="mk-back">‹ {t['back']}</span></div><div class="mk-pbody"><div class="sx-sheet"><h3>{t['sheetT']}</h3>
<div class="sx-res"><span class="sx-st ok">✓</span><span>{t['r1']}</span><span></span></div>
<div class="sx-res"><span class="sx-st ok">✓</span><span>{t['r3']}</span><span></span></div>
<div class="sx-res"><span class="sx-st wait">…</span><span>{t['r2']}<div class="sx-rnote">{t['r2n']}</div></span><span></span></div>
<div class="sx-res"><span class="sx-st agent">↻</span><span>{t['r5']}<div class="sx-rnote">{t['r5n']}</div></span><span></span></div>
<div class="sx-res"><span class="sx-st fleet">!</span><span>{t['r4']}<div class="sx-rnote">{t['r4n']}</div></span><span></span></div>
<p class="sx-sheetnote">{t['oneRestart']}</p><div class="sx-actions"><button class="btn">{t['later']}</button><button class="btn btn-primary">{t['restartNow']}</button></div></div></div>"""
        return page(f'<div class="mk-phone">{body}<div class="mk-tabs">{tabs}</div></div>', theme, True)
    if which == "search":
        groups = [(t["rgAccess"], [(t["h1"], t["h1k"])]), (t["rgChat"], [(t["h2"], t["h2k"])]), (t["rgAgents"], [(t["h3"], t["h3k"])])]
        rows = "".join(f'<div class="sx-rg">{g}</div>' + "".join(f'<div class="sx-hit"><span class="sx-hl">{h}</span><span></span><span class="sx-hk">{k}</span></div>' for h, k in hs) for g, hs in groups)
        body = f"""<div class="mk-ptop"><span class="mk-back">‹ {t['back']}</span></div><div class="mk-pbody"><div class="sx-search on">⌕ <span>{t['q']}</span></div><div class="sx-pop">{rows}</div></div>"""
        return page(f'<div class="mk-phone">{body}<div class="mk-tabs">{tabs}</div></div>', theme, True)

pass
for lang, theme in (("en", "light"), ("zh", "dark")):
    t = T[lang]
    for w in ("sections", "unsaved", "saved", "search"):
        open(os.path.join(OUT, f"desk-{theme}-{w}.html"), "w").write(desk(t, theme, w))
    for w, name in (("home", "sections"), ("unsaved", "unsaved"), ("saved", "saved"), ("search", "search")):
        open(os.path.join(OUT, f"phone-{theme}-{name}.html"), "w").write(phone(t, theme, w))
print("ok")
