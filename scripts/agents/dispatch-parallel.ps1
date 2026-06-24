[CmdletBinding()]
param(
    [string]$ConfigPath = ".agents/project-manager/parallel-work-items.json",
    [string]$BaseBranch = "main",
    [string]$WorktreeRoot = ".agent-worktrees",
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

function Assert-CleanWorkingTree {
    $status = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read git status."
    }

    if ($status) {
        throw "Working tree is not clean. Commit/stash changes before dispatching parallel branches."
    }
}

function New-WorkItemBrief {
    param(
        [string]$OutputPath,
        [string]$ItemId,
        [string]$Agent,
        [string]$Title,
        [string]$Objective,
        [string[]]$AcceptanceCriteria,
        [string[]]$DependsOn,
        [string]$BaseBranch,
        [string]$BranchName
    )

    $criteriaBlock = if ($AcceptanceCriteria -and $AcceptanceCriteria.Count -gt 0) {
        ($AcceptanceCriteria | ForEach-Object { "- $_" }) -join "`n"
    }
    else {
        "- Define acceptance criteria before implementation starts."
    }

    $dependencyBlock = if ($DependsOn -and $DependsOn.Count -gt 0) {
        ($DependsOn | ForEach-Object { "- $_" }) -join "`n"
    }
    else {
        "- None"
    }

    $content = @"
# Active Task Brief

## Work item
- ID: $ItemId
- Agent: $Agent
- Title: $Title

## Objective
$Objective

## Acceptance criteria
$criteriaBlock

## Dependencies
$dependencyBlock

## Branch contract
- Base branch: $BaseBranch
- Working branch: $BranchName
- Commit only changes in scope for this work item.
- Post proof to .agents/shared-inbox/inbox.md after each meaningful checkpoint.
"@

    $folder = Split-Path -Path $OutputPath -Parent
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    Set-Content -Path $OutputPath -Value $content -Encoding utf8
}

function Add-InboxMessage {
    param(
        [string]$InboxPath,
        [string]$Agent,
        [string]$ItemId,
        [string]$Title,
        [string]$BranchName,
        [string]$WorktreePath
    )

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm")
    $entry = @"
[$timestamp UTC] [PROJECT_MANAGER->$Agent] [P1] [OPEN]
Context: Parallel dispatch for work item $ItemId.
Request: Deliver `"$Title`" on branch $BranchName using worktree $WorktreePath.
Evidence: Commit history + tests + handoff note in this inbox.
Due: Next coordination checkpoint.

"@

    Add-Content -Path $InboxPath -Value $entry -Encoding utf8
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot
try {
    if (-not $DryRun) {
        Assert-CleanWorkingTree
    }

    $configAbsolute = Join-Path $repoRoot $ConfigPath
    if (-not (Test-Path $configAbsolute)) {
        throw "Missing config file: $ConfigPath"
    }

    $inboxPath = Join-Path $repoRoot ".agents/shared-inbox/inbox.md"
    if (-not (Test-Path $inboxPath)) {
        throw "Missing inbox file: .agents/shared-inbox/inbox.md"
    }

    $worktreeRootAbs = Join-Path $repoRoot $WorktreeRoot
    if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path $worktreeRootAbs | Out-Null
    }

    $raw = Get-Content -Path $configAbsolute -Raw -Encoding utf8
    $items = ConvertFrom-Json -InputObject $raw
    if ($null -eq $items) {
        throw "No work items found in $ConfigPath"
    }

    if ($items -isnot [System.Array]) {
        $items = @($items)
    }

    foreach ($item in $items) {
        foreach ($required in @("id", "agent", "title", "objective")) {
            if ([string]::IsNullOrWhiteSpace($item.$required)) {
                throw "Work item is missing required field '$required'."
            }
        }

        $itemId = [string]$item.id
        $agent = [string]$item.agent
        $title = [string]$item.title
        $objective = [string]$item.objective
        $acceptanceCriteria = @()
        if ($item.PSObject.Properties.Name -contains "acceptanceCriteria" -and $item.acceptanceCriteria) {
            $acceptanceCriteria = @($item.acceptanceCriteria)
        }

        $dependsOn = @()
        if ($item.PSObject.Properties.Name -contains "dependsOn" -and $item.dependsOn) {
            $dependsOn = @($item.dependsOn)
        }

        $agentSlug = ($agent.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
        $titleSlug = ($title.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
        $branchName = "agents/$agentSlug/$itemId-$titleSlug"
        $worktreePath = Join-Path $worktreeRootAbs "$itemId-$agentSlug"

        if ($DryRun) {
            Write-Host "[DRY RUN] Ensure branch: $branchName"
            Write-Host "[DRY RUN] Ensure worktree: $worktreePath"
            continue
        }

        & git show-ref --verify --quiet "refs/heads/$branchName"
        if ($LASTEXITCODE -ne 0) {
            & git branch $branchName $BaseBranch
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to create branch '$branchName' from '$BaseBranch'."
            }
        }

        if (-not (Test-Path $worktreePath)) {
            & git worktree add $worktreePath $branchName
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to create worktree '$worktreePath'."
            }
        }

        $briefPath = Join-Path $worktreePath ".agents/project-manager/active-task.md"
        New-WorkItemBrief -OutputPath $briefPath -ItemId $itemId -Agent $agent -Title $title -Objective $objective -AcceptanceCriteria $acceptanceCriteria -DependsOn $dependsOn -BaseBranch $BaseBranch -BranchName $branchName

        Add-InboxMessage -InboxPath $inboxPath -Agent $agent -ItemId $itemId -Title $title -BranchName $branchName -WorktreePath $worktreePath

        Write-Host "Dispatched $itemId -> $branchName"
    }
}
finally {
    Pop-Location
}
