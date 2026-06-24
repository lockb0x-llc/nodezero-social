[CmdletBinding()]
param(
    [string]$QueuePath = ".agents/project-manager/merge-queue.txt",
    [string]$BaseBranch = "main",
    [string]$ValidationCommand = "pnpm lint; pnpm type-check; pnpm test; pnpm policy:validate-env",
    [switch]$NoValidation,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $root = (& git rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
        throw "Not inside a git repository."
    }

    return $root.Trim()
}

function Get-MergeQueue {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Missing merge queue file: $Path"
    }

    $branches = @()
    foreach ($line in (Get-Content -Path $Path -Encoding utf8)) {
        $candidate = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if ($candidate.StartsWith("#")) {
            continue
        }

        $branches += $candidate
    }

    return $branches
}

function Add-InboxResult {
    param(
        [string]$InboxPath,
        [string]$Branch,
        [string]$Status,
        [string]$Context,
        [string]$Request,
        [string]$Evidence
    )

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm")
    $priority = if ($Status -eq "DONE") { "P1" } else { "P0" }

    $entry = @"
[$timestamp UTC] [PROJECT_MANAGER->ALL] [$priority] [$Status]
Context: $Context
Request: $Request
Evidence: $Evidence
Due: Next coordination checkpoint.

"@

    Add-Content -Path $InboxPath -Value $entry -Encoding utf8
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot
try {
    $inboxPath = Join-Path $repoRoot ".agents/shared-inbox/inbox.md"
    if (-not (Test-Path $inboxPath)) {
        throw "Missing inbox file: .agents/shared-inbox/inbox.md"
    }

    $queueAbsolute = Join-Path $repoRoot $QueuePath
    $branches = @(Get-MergeQueue -Path $queueAbsolute)
    if ($branches.Count -eq 0) {
        Write-Host "No branches in merge queue."
        exit 0
    }

    foreach ($branch in $branches) {
        if ($DryRun) {
            Write-Host "[DRY RUN] Merge $branch into $BaseBranch"
            continue
        }

        & git show-ref --verify --quiet "refs/heads/$branch"
        if ($LASTEXITCODE -ne 0) {
            Add-InboxResult -InboxPath $inboxPath -Branch $branch -Status "NEEDS-INFO" -Context "Branch '$branch' missing from local repository." -Request "Create/fetch branch and re-run reintegration." -Evidence "git show-ref failed for $branch"
            throw "Branch '$branch' does not exist locally."
        }

        & git checkout $BaseBranch
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to checkout base branch '$BaseBranch'."
        }

        & git merge --no-ff --no-edit $branch
        if ($LASTEXITCODE -ne 0) {
            Add-InboxResult -InboxPath $inboxPath -Branch $branch -Status "NEEDS-INFO" -Context "Merge conflict while integrating '$branch'." -Request "Resolve conflicts and re-run reintegration." -Evidence "git merge failed for $branch"
            throw "Merge failed for '$branch'."
        }

        if (-not $NoValidation) {
            Invoke-Expression $ValidationCommand
            if ($LASTEXITCODE -ne 0) {
                Add-InboxResult -InboxPath $inboxPath -Branch $branch -Status "NEEDS-INFO" -Context "Validation failed after merging '$branch'." -Request "Fix failures or revert merge before proceeding." -Evidence $ValidationCommand
                throw "Validation failed after merging '$branch'."
            }
        }

        Add-InboxResult -InboxPath $inboxPath -Branch $branch -Status "DONE" -Context "Integrated branch '$branch' into '$BaseBranch'." -Request "Proceed with next queued branch." -Evidence "git merge --no-ff --no-edit $branch"
        Write-Host "Integrated $branch"
    }
}
finally {
    Pop-Location
}
