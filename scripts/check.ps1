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

function Resolve-ScriptsDirectory {
    # PowerShell never dereferences a directory reparse point (junction or
    # symlink) in $PSScriptRoot on its own. ResolveLinkTarget($true) follows
    # one to its final target; it returns $null when the path isn't a link,
    # so the path is used as-is.
    param(
        [Parameter(Mandatory)]
        [string] $Path
    )
    $item = Get-Item -LiteralPath $Path
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
# Without a script root there is no repository to check: the body piped into
# `pwsh -Command -` runs statement by statement, so a failed Join-Path alone
# did not stop the run -- it printed the error, ran no gate and exited 0.
# (Not Write-Error: under $ErrorActionPreference = 'Stop' that terminates the
# statement before `exit 1` runs, and the exit code is 0 again.)
#
# Two more ways the resolved root could still be foreign, closed by the two
# blocks below: (1) scripts/ reached through a directory junction/symlink --
# $PSScriptRoot keeps the alias path, so every gate ran inside whatever
# otherwise-empty directory held the alias, and exit 0 certified it anyway;
# Resolve-ScriptsDirectory follows the reparse point back to this repo's real
# scripts/ first. (2) check.ps1 reached through a hard link -- a second
# directory entry for the same file record, with no reparse point at all to
# follow -- which the marker check below catches instead: it refuses to
# certify a resolved root that doesn't carry this repo's own identity.
if (-not $PSScriptRoot) {
    [Console]::Error.WriteLine('check.ps1 must be run as a file (pwsh -File scripts/check.ps1); $PSScriptRoot is empty')
    exit 1
}
$repoRoot = (Resolve-Path (Join-Path (Resolve-ScriptsDirectory $PSScriptRoot) '..')).Path

$repoMarkers = '.git', 'pyproject.toml'
$missingMarkers = $repoMarkers | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repoRoot $_)) }
if ($missingMarkers) {
    [Console]::Error.WriteLine("check.ps1: resolved root '$repoRoot' is missing $($missingMarkers -join ', ') -- refusing to certify a tree that is not this repo's real checkout")
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
