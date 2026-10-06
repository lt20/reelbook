# Reelbook installer for Windows (PowerShell).
#   $env:REELBOOK_URL = "<project url>"; $env:REELBOOK_KEY = "<anon key>"; irm https://lt20.github.io/reelbook/install.ps1 | iex
# Installs the repository in ~\reelbook, a Python venv with Pillow, copies the Claude Code skill,
# then signs the computer in (email + password). Safe to run again: it updates in place.
$ErrorActionPreference = "Stop"
$Dir = if ($env:REELBOOK_DIR) { $env:REELBOOK_DIR } else { Join-Path $HOME "reelbook" }
$Repo = "https://github.com/lt20/reelbook"

function Say($t) { Write-Host "`n$t" -ForegroundColor White }
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "missing: $cmd. $hint" } }

Say "1/5 Checking the basics"
Need git "Install it from https://git-scm.com."
Need python "Install Python 3.10 or newer from https://python.org (tick 'Add to PATH')."
$v = & python -c "import sys; print(1 if sys.version_info >= (3, 10) else 0)"
if ($v -ne "1") { throw "Python 3.10 or newer is needed." }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host "note: Claude Code ('claude') is not on your PATH yet. Install it from https://claude.com/claude-code before running /reelbook." }

Say "2/5 Getting the code into $Dir"
if (Test-Path (Join-Path $Dir ".git")) { git -C $Dir pull --ff-only -q } else { git clone -q $Repo $Dir }

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
if ($env:REELBOOK_URL -and $env:REELBOOK_KEY) {
  & python (Join-Path $Dir "tools\rb.py") login --url $env:REELBOOK_URL --key $env:REELBOOK_KEY
} else {
  Write-Host "Paste the command from the app's Settings page later:  python $Dir\tools\rb.py login --url … --key …"
}

Say "Done."
Write-Host "Open Claude Code in any folder, keep Chrome open with the Claude in Chrome extension, and type:  /reelbook"
