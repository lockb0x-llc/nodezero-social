[CmdletBinding()]
param(
    [string]$ConfigPath = ".agents/project-manager/parallel-work-items.json",
    [string]$InboxPath = ".agents/shared-inbox/inbox.md",
    [int]$StaleHours = 6,
    [switch]$Loop,
    [int]$LoopIntervalMinutes = 30,
    [int]$MaxIterations = 0,
    [switch]$FollowUp,
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

function Get-InboxMessages {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Missing inbox file: $Path"
    }

    $lines = Get-Content -Path $Path -Encoding utf8
    $messages = @()
    $current = $null

    foreach ($line in $lines) {
        if ($line -match '^\[(?<timestamp>[^\]]+) UTC\] \[(?<from>[A-Z_]+)->(?<to>[A-Z_]+|ALL)\] \[(?<priority>P\d)\] \[(?<status>OPEN|DONE|NEEDS-INFO)\]$') {
            if ($null -ne $current) {
                $messages += [pscustomobject]$current
            }

            $current = [ordered]@{
                Timestamp = $Matches.timestamp
                From = $Matches.from
                To = $Matches.to
                Priority = $Matches.priority
                Status = $Matches.status
                Context = @()
                Request = @()
                Evidence = @()
                Due = @()
            }

            continue
        }

        if ($null -eq $current) {
            continue
        }

        foreach ($field in @('Context', 'Request', 'Evidence', 'Due')) {
            $prefix = $field + ': '
            if ($line.StartsWith($prefix)) {
                $current[$field] += $line.Substring($prefix.Length)
            }
        }
    }

    if ($null -ne $current) {
        $messages += [pscustomobject]$current
    }

    return $messages
}

function Get-MessageText {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    if ($Value -is [System.Array]) {
        return [string]$Value[0]
    }

    return [string]$Value
}

function Get-BranchStatus {
    param([string]$WorktreePath)

    if (-not (Test-Path $WorktreePath)) {
        return "missing-worktree"
    }

    $status = (& git -C $WorktreePath status --short)
    if ($LASTEXITCODE -ne 0) {
        return "status-error"
    }

    if (-not $status) {
        return "clean"
    }

    if ($status | Where-Object { $_ -match '^\?\? \.agents/project-manager/active-task\.md$' }) {
        $other = @($status | Where-Object { $_ -notmatch '^\?\? \.agents/project-manager/active-task\.md$' })
        if ($other.Count -eq 0) {
            return "brief-only"
        }

        return "working"
    }

    return "working"
}

function Get-WorkItemMap {
    param(
        [string]$Path,
        [string]$RepoRoot
    )

    if (-not (Test-Path $Path)) {
        throw "Missing work-item config: $Path"
    }

    $raw = Get-Content -Path $Path -Raw -Encoding utf8
    $items = ConvertFrom-Json -InputObject $raw
    if ($items -isnot [System.Array]) {
        $items = @($items)
    }

    $map = @{}
    foreach ($item in $items) {
        $itemId = [string]$item.id
        $agent = [string]$item.agent
        $agentSlug = ($agent.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
        $titleSlug = ([string]$item.title).ToLowerInvariant() -replace '[^a-z0-9]+', '-'
        $titleSlug = $titleSlug.Trim('-')
        $branchName = "agents/$agentSlug/$itemId-$titleSlug"
        $worktreePath = Join-Path $RepoRoot ".agent-worktrees/$itemId-$agentSlug"

        $map[$itemId] = [pscustomobject]@{
            Id = $itemId
            Agent = $agent
            Title = [string]$item.title
            Branch = $branchName
            WorktreePath = $worktreePath
        }
    }

    return $map
}

function Write-StatusMessage {
    param(
        [string]$InboxFile,
        [string]$Agent,
        [string]$ItemId,
        [string]$Title,
        [string]$State,
        [string]$Evidence
    )

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm")
    $entry = @"
[$timestamp UTC] [PROJECT_MANAGER->$Agent] [P1] [OPEN]
Context: PM follow-up on parallel work item $ItemId (`"$Title`") is currently $State.
Request: Post a progress update or blocker before the next coordination checkpoint.
Evidence: $Evidence
Due: Next coordination checkpoint.

"@

    Add-Content -Path $InboxFile -Value $entry -Encoding utf8
}

function Invoke-StatusPass {
    param(
        [string]$RepoRoot,
        [string]$ConfigAbsolute,
        [string]$InboxAbsolute,
        [int]$StaleHours,
        [switch]$FollowUp,
        [switch]$DryRun
    )

    $messages = @(Get-InboxMessages -Path $InboxAbsolute)
    $items = Get-WorkItemMap -Path $ConfigAbsolute -RepoRoot $RepoRoot

    $rows = foreach ($itemId in ($items.Keys | Sort-Object)) {
        $item = $items[$itemId]
        $branchMessages = @($messages | Where-Object { $_.To -eq $item.Agent -and $_.From -eq 'PROJECT_MANAGER' })
        $latestMessage = $branchMessages | Select-Object -Last 1
        $worktreeState = Get-BranchStatus -WorktreePath $item.WorktreePath

        [pscustomobject]@{
            Id = $item.Id
            Agent = $item.Agent
            Title = $item.Title
            Branch = $item.Branch
            Worktree = $worktreeState
            LastPmMessage = if ($latestMessage) { $latestMessage.Timestamp } else { 'none' }
        }
    }

    foreach ($row in $rows) {
        Write-Host ("{0} | {1} | {2} | worktree={3} | lastPm={4}" -f $row.Id, $row.Agent, $row.Title, $row.Worktree, $row.LastPmMessage)
    }

    if ($FollowUp) {
        $threshold = (Get-Date).ToUniversalTime().AddHours(-[double]$StaleHours)
        foreach ($row in $rows) {
            $branchMessages = @($messages | Where-Object { $_.To -eq $row.Agent -and $_.From -eq 'PROJECT_MANAGER' })
            $latestMessage = $branchMessages | Select-Object -Last 1
            $latestTime = $null
            if ($latestMessage) {
                $latestTime = [datetime]::ParseExact(
                    $latestMessage.Timestamp,
                    'yyyy-MM-dd HH:mm',
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [System.Globalization.DateTimeStyles]::AssumeUniversal
                )
            }

            $latestContext = if ($latestMessage) { Get-MessageText $latestMessage.Context } else { "" }
            $hasAlreadyFollowedUp = $latestContext.StartsWith('PM follow-up')
            $needsInitialFollowUp = $row.Worktree -eq 'brief-only' -and -not $hasAlreadyFollowedUp
            $needsRepeatFollowUp = $latestTime -and $latestTime -lt $threshold
            $needsFollowUp = $needsInitialFollowUp -or $needsRepeatFollowUp
            if ($needsFollowUp) {
                if ($DryRun) {
                    Write-Host "[DRY RUN] Follow up on $($row.Id) -> $($row.Agent)"
                    continue
                }

                Write-StatusMessage -InboxFile $InboxAbsolute -Agent $row.Agent -ItemId $row.Id -Title $row.Title -State $row.Worktree -Evidence "worktree=$($row.Worktree); lastPmMessage=$($row.LastPmMessage)"
                Write-Host "Followed up on $($row.Id) -> $($row.Agent)"
            }
        }
    }
}

$repoRoot = Get-RepoRoot
Push-Location $repoRoot
try {
    $configAbsolute = Join-Path $repoRoot $ConfigPath
    $inboxAbsolute = Join-Path $repoRoot $InboxPath
    $iteration = 0

    do {
        $iteration += 1
        Invoke-StatusPass -RepoRoot $repoRoot -ConfigAbsolute $configAbsolute -InboxAbsolute $inboxAbsolute -StaleHours $StaleHours -FollowUp:($FollowUp -or $Loop) -DryRun:$DryRun

        if (-not $Loop) {
            break
        }

        if ($MaxIterations -gt 0 -and $iteration -ge $MaxIterations) {
            break
        }

        if ($LoopIntervalMinutes -gt 0) {
            Start-Sleep -Seconds ($LoopIntervalMinutes * 60)
        }
    } while ($true)
}
finally {
    Pop-Location
}
