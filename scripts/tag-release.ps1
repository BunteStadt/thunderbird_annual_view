#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Creates a tag from the manifest.json version and pushes it to origin.
    Only runs on the main branch when it is in sync with origin/main.
#>
$ErrorActionPreference = 'Stop'

$manifest = "manifest.json"
$remote   = "origin"
$branch   = "main"

# 0. Working tree must be clean (no uncommitted changes)
$status = git status --porcelain
if ($status) {
    Write-Host "❌ Working tree is not clean. Commit or stash all changes first." -ForegroundColor Red
    exit 1
}

# 1. Active branch must be main
$activeBranch = git rev-parse --abbrev-ref HEAD
if ($activeBranch -ne $branch) {
    Write-Host "❌ Active branch is '$activeBranch', not '$branch'." -ForegroundColor Red
    exit 1
}

# 2. main must be in sync with origin/main
git fetch $remote $branch 2>&1 | Out-Null
$behind = git rev-list --count "HEAD..$remote/$branch"
$ahead  = git rev-list --count "$remote/$branch..HEAD"
if ($behind -gt 0) {
    Write-Host "❌ '$branch' is $behind commit(s) behind $remote/$branch. Pull first." -ForegroundColor Red
    exit 1
}
if ($ahead -gt 0) {
    Write-Host "❌ '$branch' is $ahead commit(s) ahead of $remote/$branch. Push first." -ForegroundColor Red
    exit 1
}

# 3. Read version from manifest.json
$version = (Get-Content $manifest -Raw | ConvertFrom-Json).version
if (-not $version) {
    Write-Host "❌ Could not read version from $manifest." -ForegroundColor Red
    exit 1
}
$tag = "v$version"

# 4. Check if tag already exists
$tagExists = git tag -l "$tag"
if ($tagExists) {
    Write-Host "❌ Tag '$tag' already exists." -ForegroundColor Red
    exit 1
}

# 5. Create and push tag
Write-Host "✅ All good — creating tag '$tag' and pushing to $remote …" -ForegroundColor Green
git tag "$tag"
git push $remote "$tag"
Write-Host "✅ Tag '$tag' successfully created and pushed." -ForegroundColor Green