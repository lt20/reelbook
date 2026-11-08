# Reelbook installer for Windows (PowerShell).
#   irm https://lt20.github.io/reelbook/install.ps1 | iex                                       (the hosted backend)
#   $env:REELBOOK_URL = "<project url>"; $env:REELBOOK_KEY = "<anon key>"; irm https://lt20.github.io/reelbook/install.ps1 | iex
# Installs the repository in ~\reelbook, a Python venv with Pillow, copies the Claude Code skill,
# then signs the computer in (email + password). Safe to run again: it updates in place.
# Without REELBOOK_URL / REELBOOK_KEY it signs in to the hosted backend: its url and anon key are read, as text, from
# the app's published config.js (the file is never run). REELBOOK_CONFIG_URL reads another one (a fork, a local path).
# REELBOOK_DRY_RUN=1 shows which backend would be used, then stops: nothing is installed. These variables are cleared
# once read.
$ErrorActionPreference = "Stop"
$Dir = if ($env:REELBOOK_DIR) { $env:REELBOOK_DIR } else { Join-Path $HOME "reelbook" }
$Repo = "https://github.com/lt20/reelbook"

function Say($t) { Write-Host "`n$t" -ForegroundColor White }
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "missing: $cmd. $hint" } }

function Test-ReelbookUrl([string]$u) { $u -match '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?$' }
# a JWT (three base64url parts) or a Supabase publishable key
function Test-ReelbookKey([string]$k) { $k -match '^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$' }

# The hosted backend of a config.js read as text: the `hosted: { ... }` block, then its `url` and `anonKey` string
# values. Nothing in the file is run. $null when the block or a value is missing or malformed.
function Get-HostedBackend([string]$Text) {
  # line comments out (a `//` at the start of a line or after a space, never the one in 'https://'), then one line
  $t = ($Text -replace '(?m)(^|\s)//.*$', '') -replace '[\r\n]', ' '
  if ($t -notmatch '(^|[{,\s])hosted:\s*\{([^}]*)\}') { return $null }
  $block = $Matches[2]
  $url = if ($block -match "(^|[{,\s])url:\s*['""]([^'""]*)['""]") { $Matches[2] -replace '/$', '' } else { "" }
  $key = if ($block -match "(^|[{,\s])anonKey:\s*['""]([^'""]*)['""]") { $Matches[2] } else { "" }
  if ((Test-ReelbookUrl $url) -and (Test-ReelbookKey $key)) { return @{ Url = $url; Key = $key } }
  return $null
}

function Read-ReelbookConfig([string]$Source) {
  if ($Source -match '^https?://') {
    $c = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 $Source).Content
    if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
    return [string]$c
  }
  # a file:// url becomes a local path (file:///D:/reelbook/config.js -> D:\reelbook\config.js); a path stays as is
  if ($Source -match '^file:') { $Source = ([Uri]$Source).LocalPath }
  return Get-Content -Raw -LiteralPath $Source
}

# The arguments given (REELBOOK_URL and REELBOOK_KEY), else the hosted backend of config.js; throws when neither.
function Resolve-ReelbookBackend([string]$Url, [string]$Key, [string]$ConfigUrl) {
  if ($Url -or $Key) {
    if (-not ($Url -and $Key)) { throw "Set both REELBOOK_URL and REELBOOK_KEY (the app's Settings page shows the whole line)." }
    return @{ Url = $Url; Key = $Key }
  }
  try { $text = Read-ReelbookConfig $ConfigUrl }
  catch { throw "Could not read $ConfigUrl to find the hosted backend. Check the connection and try again, or set REELBOOK_URL and REELBOOK_KEY first." }
  $b = Get-HostedBackend $text
  if (-not $b) { throw "No hosted backend is set in $ConfigUrl (an https url and an anon key). Set REELBOOK_URL and REELBOOK_KEY first: the app's Settings page shows that line." }
  $b.Hosted = $true
  return $b
}

# Updates the clone in $Dir. A clone made before the repository was republished with a new history has no common
# ancestor with it: a fast-forward can never succeed, so the clone is moved onto the new history (reset --hard
# origin/main). Files git ignores (work\, .venv\) stay as they are; the session file is outside the folder
# (~\.config\reelbook). The old HEAD is kept first in the branch reelbook-old-history (an existing one is never
# overwritten: a dated name is used instead), so commits of the clone's own are not lost. A tracked file edited or
# staged by hand (app\config.js of a self-hosted app...) would be replaced: the clone does not move until it is set
# aside. $false when the clone was not updated (offline, local commits on the same history, files edited by hand):
# the current version is kept, as before.
function Update-ReelbookRepo([string]$Dir) {
  # git's messages on stderr must not stop the installer (Windows PowerShell turns them into errors under "Stop")
  $ErrorActionPreference = "Continue"
  git -C $Dir pull --ff-only -q 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return $true }
  git -C $Dir fetch -q origin 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  git -C $Dir rev-parse --verify -q origin/main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  # 0: a common ancestor, the usual rule applies (keep the current version); 1: none; anything else: an error
  git -C $Dir merge-base HEAD origin/main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 1) { return $false }
  $dirty = git -C $Dir status --porcelain --untracked-files=no 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  if ($dirty) {
    Write-Host "note: the Reelbook repository has a new history, but $Dir has tracked files edited by hand. Keep a copy of them with  git -C `"$Dir`" stash  (or copy them elsewhere and undo the edits), then run this installer again."
    return $false
  }
  # the old history, with any commits of the clone's own, stays in a branch; an earlier run's branch is kept as it is
  $keep = "reelbook-old-history"
  $head = git -C $Dir rev-parse HEAD 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  $prev = git -C $Dir rev-parse -q --verify "refs/heads/$keep" 2>$null
  if ($LASTEXITCODE -ne 0) {
    git -C $Dir branch $keep HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
  } elseif ("$prev".Trim() -ne "$head".Trim()) {
    $keep = "reelbook-old-history-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    git -C $Dir branch $keep HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
  }
  git -C $Dir reset -q --hard origin/main 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  Write-Host "note: the Reelbook repository has a new history; $Dir now follows it (work\ and .venv\ are kept; the old history, with any commits of your own, is in the branch $keep)."
  return $true
}

# The end of an install that went through: a film reel and REELBOOK in block letters (the brand's coral and blue,
# ANSI 256 colours), then what to do next. Colour only on a terminal that reads escape codes, without NO_COLOR, and
# when TERM is not dumb. French when the UI culture is French, English otherwise. This file stays ASCII (Windows
# PowerShell may read it as Latin-1): the block and the accents are character codes.
function Show-ReelbookWelcome {
  $e = [char]27; $coral = ""; $blue = ""; $bold = ""; $off = ""
  if ($Host.UI.SupportsVirtualTerminal -and -not [Console]::IsOutputRedirected -and -not $env:NO_COLOR -and $env:TERM -ne "dumb") {
    $coral = "$e[38;5;167m"; $blue = "$e[38;5;25m"; $bold = "$e[1m"; $off = "$e[0m"
  }
  $px = [string][char]0x2588
  # a 7 x 7 reel, each dot two columns wide, and 4 x 5 letters
  $reel = @("    ######    ", "  ##########  ", "####  ##  ####", "######  ######", "####  ##  ####", "  ##########  ", "    ######    ")
  $letters = @("",
    "###  #### #### #    ###   ##   ##  #  #",
    "#  # #    #    #    #  # #  # #  # # # ",
    "###  ###  ###  #    ###  #  # #  # ##  ",
    "# #  #    #    #    #  # #  # #  # # # ",
    "#  # #### #### #### ###   ##   ##  #  #",
    "")
  Write-Host ""
  for ($i = 0; $i -lt 7; $i++) {
    Write-Host ("  $coral" + $reel[$i].Replace("#", $px) + "$off   $blue$bold" + $letters[$i].Replace("#", $px) + $off)
  }
  Write-Host ""
  if ([string]$PSUICulture -like "fr*") {
    $ea = [char]0xE0; $ec = [char]0xEA; $ee = [char]0xE9; $ic = [char]0xEE
    Write-Host "${bold}C'est pr${ec}t.$off"
    Write-Host "1. Mets tes vid${ee}os en file d'attente : colle leur lien dans l'app, ou envoie-les avec le raccourci iPhone."
    Write-Host "2. Dans Claude Code, sur ton ordinateur, tape /reelbook, avec Chrome ouvert et l'extension Claude in Chrome install${ee}e."
    Write-Host "3. Claude ouvre les liens en file d'attente, lit les vid${ee}os, cr${ee}e les fiches et les range dans le carnet du sport correspondant."
    Write-Host "Retrouve-les dans l'app : https://lt20.github.io/reelbook/"
  } else {
    Write-Host "${bold}You're all set.$off"
    Write-Host "1. Queue your videos: paste their link in the app, or send them with the iPhone shortcut."
    Write-Host "2. In Claude Code on your computer, type /reelbook, with Chrome open and the Claude in Chrome extension installed."
    Write-Host "3. Claude opens the queued links, reads the videos, writes the sheets and files each one in the notebook of its sport."
    Write-Host "Find them in the app: https://lt20.github.io/reelbook/"
  }
}

function Install-Reelbook {
  # The variables of a line are used once, then cleared: a later line pasted in the same PowerShell window (the short
  # one, for the hosted backend) must not reuse the backend of an earlier one.
  $Url = $env:REELBOOK_URL; $Key = $env:REELBOOK_KEY; $Dry = $env:REELBOOK_DRY_RUN
  $ConfigUrl = if ($env:REELBOOK_CONFIG_URL) { $env:REELBOOK_CONFIG_URL } else { "https://lt20.github.io/reelbook/config.js" }
  Remove-Item Env:REELBOOK_URL, Env:REELBOOK_KEY, Env:REELBOOK_CONFIG_URL, Env:REELBOOK_DRY_RUN -ErrorAction SilentlyContinue
  $Backend = Resolve-ReelbookBackend $Url $Key $ConfigUrl
  if ($Dry) {
    Write-Host "Backend: $($Backend.Url)"
    # masked: a secret key given by mistake must not land in a terminal log
    $k = [string]$Backend.Key
    if ($k.Length -ge 20) { Write-Host "Key: $($k.Substring(0, 10))...$($k.Substring($k.Length - 4)) ($($k.Length) characters)" } else { Write-Host "Key: ($($k.Length) characters)" }
    Write-Host "Folder: $Dir"
    Write-Host "Dry run: nothing installed."
    return
  }

  Say "1/5 Checking the basics"
  Need git "Install it from https://git-scm.com."
  Need python "Install Python 3.9 or newer from https://python.org (tick 'Add to PATH')."
  $v = & python -c "import sys; print(1 if sys.version_info >= (3, 9) else 0)"
  if ($v -ne "1") { throw "Python 3.9 or newer is needed." }
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host "note: Claude Code ('claude') is not on your PATH yet. Install it from https://claude.com/claude-code before running /reelbook." }

  Say "2/5 Getting the code into $Dir"
  if (Test-Path (Join-Path $Dir ".git")) {
    if (-not (Update-ReelbookRepo $Dir)) { Write-Host "note: could not update $Dir, keeping the current version." }
  } else { git clone -q $Repo $Dir }

  Say "3/5 Python tools (Pillow in a private venv)"
  $Py = Join-Path $Dir ".venv\Scripts\python.exe"
  if (-not (Test-Path $Py)) { & python -m venv (Join-Path $Dir ".venv") }
  & $Py -m pip install -q --upgrade pip pillow

  Say "4/5 Installing the Claude Code skill"
  $Skills = Join-Path $HOME ".claude\skills"
  New-Item -ItemType Directory -Force $Skills | Out-Null
  $Dst = Join-Path $Skills "reelbook"
  if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst }
  Copy-Item -Recurse (Join-Path $Dir "skill\reelbook") $Dst
  Write-Host "$Dst (copied; run this installer again after updating the repository)"

  Say "5/5 Signing this computer in to your Reelbook account"
  Write-Host "Use the email and password of your Reelbook account (the ones you chose in the app)."
  # rb.py names the hosted backend as such; an empty value is no variable at all
  $env:REELBOOK_HOSTED_URL = if ($Backend.Hosted) { $Backend.Url } else { "" }
  & python (Join-Path $Dir "tools\rb.py") login --url $Backend.Url --key $Backend.Key
  $rc = $LASTEXITCODE
  Remove-Item Env:REELBOOK_HOSTED_URL -ErrorAction SilentlyContinue
  # a failed sign-in stops here: the welcome below is only for an install that went through
  if ($rc -ne 0) { throw "The sign-in did not go through. Run the same install line again to retry." }

  Show-ReelbookWelcome
}

Install-Reelbook
