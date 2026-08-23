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

# Every gate runs in the checkout this script lives in, never in the caller's
# current directory. Invoked by absolute path from another checkout, the
# Python/docs steps used to exercise *that* tree while the npm steps (already
# anchored on $PSScriptRoot) exercised *this* one, and exit 0 certified
# neither. The root is printed so a log shows which tree was checked.
# tests/test_check_script.py runs this script from a foreign directory.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
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
