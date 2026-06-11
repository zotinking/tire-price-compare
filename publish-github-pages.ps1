$ErrorActionPreference = "Stop"

$repoName = "tire-price-compare"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Checking GitHub CLI..."
gh --version | Out-Host

try {
  gh auth status | Out-Host
} catch {
  Write-Host "GitHub login is required. Starting browser login..."
  gh auth login -h github.com -w --git-protocol https
}

$owner = gh api user --jq ".login"
$repoFullName = "$owner/$repoName"
Write-Host "Using repository: $repoFullName"

if (-not (Test-Path ".git")) {
  git init -b main
}

git add .
$hasChanges = git status --porcelain
if ($hasChanges) {
  git commit -m "Add tire price comparison page"
} else {
  Write-Host "No local changes to commit."
}

$repoExists = $true
try {
  gh repo view $repoFullName | Out-Null
} catch {
  $repoExists = $false
}

if (-not $repoExists) {
  gh repo create $repoFullName --public --source . --remote origin --push
} else {
  $remote = git remote get-url origin 2>$null
  if (-not $remote) {
    git remote add origin "https://github.com/$repoFullName.git"
  }
  git push -u origin main
}

try {
  gh api "repos/$repoFullName/pages" `
    --method POST `
    -f "source[branch]=main" `
    -f "source[path]=/" | Out-Null
} catch {
  Write-Host "Pages may already be enabled. Updating Pages source..."
  gh api "repos/$repoFullName/pages" `
    --method PUT `
    -f "source[branch]=main" `
    -f "source[path]=/" | Out-Null
}

$pageUrl = "https://$owner.github.io/$repoName/"
Write-Host ""
Write-Host "Done."
Write-Host "Repository: https://github.com/$repoFullName"
Write-Host "GitHub Pages: $pageUrl"
Write-Host "Pages deployment can take 1-3 minutes after first setup."
