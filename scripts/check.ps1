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

Invoke-Checked uv run ruff check .
Invoke-Checked uv run ruff format --check .
Invoke-Checked uv run mypy
Invoke-Checked uv run pytest --cov=quviz --cov-report=term-missing
Invoke-Checked uv run --group docs python scripts/render_reference_index.py --check
Invoke-Checked uv run --group docs mkdocs build --strict

Push-Location (Join-Path $PSScriptRoot '..\web')
try {
    Invoke-Checked npm run build
}
finally {
    Pop-Location
}
