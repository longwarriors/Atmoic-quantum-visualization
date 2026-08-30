$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string] $Program,
        [Parameter(ValueFromRemainingArguments)]
        [string[]] $Arguments
    )

    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

function Resolve-FinalTarget {
    # PowerShell never dereferences a reparse point on its own: neither
    # $PSCommandPath nor $PSScriptRoot is resolved, so a symlinked script file
    # and a junctioned scripts/ directory both keep the alias path.
    # ResolveLinkTarget($true) follows one to its final target; it returns
    # $null when the path isn't a link, so the path is used as-is. It resolves
    # the FINAL component only, which is why the caller applies it to the
    # script file and then to that file's directory in turn.
    param(
        [Parameter(Mandatory)]
        [string] $Path
    )
    $item = Get-Item -LiteralPath $Path -Force
    $target = $item.ResolveLinkTarget($true)
    if ($target) {
        return $target.FullName
    }
    return $item.FullName
}

# Every gate runs in the checkout this script lives in, never in the caller's
# current directory. Invoked by absolute path from another checkout, the
# Python/docs steps used to exercise *that* tree while the npm steps (already
# anchored on $PSScriptRoot) exercised *this* one, and exit 0 certified
# neither. The root is printed so a log shows which tree was checked.
# tests/test_check_script.py runs this script from a foreign directory.
#
# Without a script path there is no repository to check: the body piped into
# `pwsh -Command -` runs statement by statement, so a failed Join-Path alone
# did not stop the run -- it printed the error, ran no gate and exited 0.
# (Not Write-Error: under $ErrorActionPreference = 'Stop' that terminates the
# statement before `exit 1` runs, and the exit code is 0 again.)
if (-not $PSCommandPath) {
    [Console]::Error.WriteLine('check.ps1 must be run as a file (pwsh -File scripts/check.ps1); $PSCommandPath is empty')
    exit 1
}

# Resolve the script FILE, not just the directory it appeared in. Three ways
# the invoked path can differ from where this script really lives, and each is
# handled on its own terms:
#
#   (1) a directory junction or directory symlink at scripts/ -- the alias path
#       survives in $PSScriptRoot, so every gate ran inside whatever
#       otherwise-empty tree held the alias and exit 0 certified it. Followed,
#       below, by resolving the resolved file's DIRECTORY.
#   (2) a file symlink at scripts/check.ps1 -- a reparse point on the file
#       itself. $PSScriptRoot never sees it because it is the directory that is
#       asked, not the file. Followed by resolving the FILE first.
#   (3) a HARD LINK to check.ps1 -- a second directory entry for the same file
#       record. There is no reparse point to follow and nothing in the file
#       says which entry came first, so it cannot be resolved, only refused.
#
# (3) is refused rather than resolved, and the refusal is deliberately blunt:
# Windows reports LinkType 'HardLink' on EVERY entry once a second one exists
# (verified on PowerShell 7.6.5 -- the original path reports it too), so
# hard-linking this script anywhere disables it everywhere, this repo's own
# scripts/check.ps1 included. That is the fail-closed direction. The
# alternative is what used to happen: a hard link in a directory carrying two
# EMPTY files named .git and pyproject.toml satisfied the whole identity check,
# so all eight gates ran against that tree and the script exited 0 announcing
# it (reproduced).
$scriptItem = Get-Item -LiteralPath $PSCommandPath -Force
$scriptPath = $scriptItem.FullName
if ($scriptItem.LinkType -eq 'HardLink') {
    [Console]::Error.WriteLine("check.ps1: '$scriptPath' is a hard link -- a second directory entry for the same file, with no target to resolve and no way to tell which entry is this repo's. Refusing, because the alternative is certifying whichever tree the link was dropped into. Note this also fires on the repo's own scripts/check.ps1 while any hard link to it exists anywhere: delete the link. Run the script by its real path.")
    exit 1
}
$scriptPath = Resolve-FinalTarget $PSCommandPath
if ((Get-Item -LiteralPath $scriptPath -Force).LinkType -eq 'HardLink') {
    [Console]::Error.WriteLine("check.ps1: '$PSCommandPath' resolves to '$scriptPath', which is itself a hard link -- see above. Refusing.")
    exit 1
}
$scriptsDirectory = Resolve-FinalTarget (Split-Path -Parent $scriptPath)

# The identity proof. "Two files named .git and pyproject.toml exist" was the
# whole of it, and two empty files satisfied that, which is bypass (3) above.
# So ask something that cannot be faked by creating empty files: git itself,
# from the RESOLVED scripts directory.
#
#   --show-toplevel  the work tree root git computes for that directory. This
#                    becomes $repoRoot, so the root is git's canonical answer
#                    rather than a string built from '..' -- no separator,
#                    case or 8.3-short-name normalisation to get wrong.
#   --show-prefix    where that directory sits inside the work tree. Requiring
#                    exactly `scripts/` is what ties the two together: it says
#                    the resolved script is <toplevel>/scripts/check.ps1, so
#                    $repoRoot cannot be a parent, a sibling or a subdirectory
#                    of the real checkout.
#
# An empty .git is `fatal: invalid gitfile format`; a .git directory that is
# not a repository is `fatal: not a git repository`; a directory inside some
# other checkout resolves to that checkout's root and fails the prefix check.
# GIT_DIR / GIT_WORK_TREE are cleared for the call because both redirect
# discovery -- an environment that can set them can also shadow uv and npm on
# PATH, so this is tidiness rather than a boundary, but it costs two lines.
$savedGitDir = $env:GIT_DIR
$savedGitWorkTree = $env:GIT_WORK_TREE
$gitLines = @()
$gitFailed = $false
try {
    $env:GIT_DIR = $null
    $env:GIT_WORK_TREE = $null
    $gitLines = @(& git -C $scriptsDirectory rev-parse --show-toplevel --show-prefix 2>$null)
    if ($LASTEXITCODE -ne 0) {
        $gitFailed = $true
    }
}
catch {
    # git absent from PATH, or a non-zero exit raised under
    # $PSNativeCommandUseErrorActionPreference (PowerShell 7.4+).
    $gitFailed = $true
}
finally {
    $env:GIT_DIR = $savedGitDir
    $env:GIT_WORK_TREE = $savedGitWorkTree
}
if ($gitFailed -or $gitLines.Count -lt 2) {
    [Console]::Error.WriteLine("check.ps1: git cannot resolve a work tree for '$scriptsDirectory' -- refusing to certify a tree that is not a real checkout of this repository. (If git is not installed, install it: this check is what stops the script from running every gate in a directory that merely carries files named .git and pyproject.toml.)")
    exit 1
}
if ($gitLines[1] -ne 'scripts/') {
    [Console]::Error.WriteLine("check.ps1: '$scriptsDirectory' is '$($gitLines[1])' inside the work tree at '$($gitLines[0])', not 'scripts/' -- this script must live in <checkout>/scripts/. Refusing.")
    exit 1
}
$repoRoot = [System.IO.Path]::GetFullPath($gitLines[0])

# Any git checkout satisfies the check above; only this project's declares
# itself. Read the value rather than testing for the file, because an empty
# pyproject.toml is exactly what the old marker check accepted.
$pyproject = Join-Path $repoRoot 'pyproject.toml'
if (-not (Test-Path -LiteralPath $pyproject -PathType Leaf)) {
    [Console]::Error.WriteLine("check.ps1: resolved root '$repoRoot' has no pyproject.toml -- refusing to certify a tree that is not this repo's checkout")
    exit 1
}
# The [string] cast is load-bearing, not tidiness: Get-Content -Raw returns
# $null for an EMPTY file, and `$null -notmatch ...` evaluates to $null, not to
# $true -- so without the cast an empty pyproject.toml passed this check
# silently, which is the very bypass it exists to close (measured: exit 0, all
# eight gates run in a `git init`-ed temp directory). [string]$null is '', and
# '' does not match.
$pyprojectText = [string](Get-Content -LiteralPath $pyproject -Raw)
if ($pyprojectText -notmatch '(?im)^\s*name\s*=\s*["'']QuViz["'']\s*$') {
    [Console]::Error.WriteLine("check.ps1: '$pyproject' does not declare name = `"QuViz`" -- the resolved root is some other project's checkout. Refusing.")
    exit 1
}

Write-Host "check.ps1: running every gate in $repoRoot"

Push-Location $repoRoot
try {
    Invoke-Checked uv run ruff check .
    Invoke-Checked uv run ruff format --check .
    Invoke-Checked uv run mypy
    # --group docs is load-bearing: the citation gates import python-markdown
    # plainly, so without it they error. tests/conftest.py additionally fails
    # the session on any skipped test (QUVIZ_ALLOW_SKIPS=1 overrides), so a
    # gate can never be dropped silently.
    Invoke-Checked uv run --group docs pytest --cov=quviz --cov-report=term-missing
    Invoke-Checked uv run --group docs python scripts/render_reference_index.py --check
    Invoke-Checked uv run --group docs python scripts/render_openapi_reference.py --check
    Invoke-Checked uv run --group docs mkdocs build --strict

    Push-Location (Join-Path $repoRoot 'web')
    try {
        Invoke-Checked npm run test
        Invoke-Checked npm run build
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
