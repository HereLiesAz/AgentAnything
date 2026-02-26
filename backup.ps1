<#
.SYNOPSIS
    The "Jules-Proof" Backup Script (v2.1 - AIExclude Support).
.DESCRIPTION
    Backs up project content with a visual file tree.
    Aggressively filters external libraries while preserving core source code,
    docs, and build configurations. Now assimilates .aiexclude.
#>

# --- Configuration ---
$ScriptName = "backup.ps1"
$BackupPrefix = "project_backup"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$PSScriptRoot = Get-Location
$BackupFile = Join-Path -Path $PSScriptRoot -ChildPath "${BackupPrefix}_full_${Timestamp}.txt"
$FileSizeLimit = 500KB

# Directories to exclude.
$excludeDirs = @(
    ".git",
    ".gradle",
    ".idea",
    ".vscode",
    ".cxx",
    "build",
    "captures",
    "dist",
    "node_modules",
    "out",
    "coverage",
    ".next",
    "bin",
    "obj",
    "__pycache__",
    "libs",
    "opencv*",
    "*/absl",
    "*/ceres-solver/include",
    "*/ceres-solver/data",
    "*/ceres-solver/ci",
    "*/ceres-solver/internal",
    "*/ceres-solver/include",
    "*/ceres-solver/examples",
    "*/ceres-solver/config",
    "*/eigen/lapack",
    "*/eigen/blas",
    "*/eigen/debug",
    "*/eigen/unsupported",
    "*/eigen/Eigen",
    "*/eigen/test",
    "*/eigen/demos",
    "*/eigen/scripts",
    "*/eigen/failtest",
    "*/eigen/cmake",
    "*/eigen/bench",
    "*/eigen/doc",
    "*/libs/"
)

# File patterns to exclude (Binaries, locks, media).
# NOTE: C++ source files (.cpp, .hpp, .c, .cc, .cxx, CMakeLists.txt) are purposely NOT listed here.
$excludeFiles = @(
    $ScriptName,
    "${BackupPrefix}*.txt",
    "local.properties",
    "gradlew",
    "gradlew.bat",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "*.iml",
    "*.log",
    "*.map",
    "*.so", "lib*.so", "*.dylib", "*.dll", "*.obj", "*.o", "*.a", "*.lib",
    "*.apk", "*.aar", "*.dex", "*.class",
    "*.exe", "*.bin", "*.msi",
    "*.zip", "*.tar", "*.gz", "*.rar", "*.7z", "*.jar",
    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.webp", "*.bmp", "*.tiff",
    "*.mp3", "*.mp4", "*.wav", "*.avi", "*.mov", "*.mkv",
    "*.ttf", "*.otf", "*.woff", "*.woff2", "*.eot",
    ".DS_Store", "Thumbs.db"
)

# --- Helper: Check if Item should be Excluded ---
function Test-IsExcluded {
    param (
        [System.IO.FileInfo]$Item,
        [string]$RootPath
    )

    # 1. Name Check
    foreach ($pattern in $excludeFiles) {
        if ($Item.Name -like $pattern) { return $true }
    }

    # 2. Path Check (Directories)
    # Normalize path for comparison
    $normalizedPath = $Item.FullName.Replace($RootPath, "").TrimStart("\/")
    $pathParts = $normalizedPath -split "[\\/]"

    foreach ($part in $pathParts) {
        if ($excludeDirs -contains $part) { return $true }
    }

    return $false
}

# --- .gitignore Assimilation ---
if (Test-Path "$PSScriptRoot\.gitignore") {
    Write-Host "Parsing .gitignore..." -ForegroundColor Cyan
    $gitIgnoreContent = Get-Content "$PSScriptRoot\.gitignore"
    foreach ($line in $gitIgnoreContent) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#") -or $line.StartsWith("!")) { continue }
        $cleanLine = $line.Trim().Replace('/', [System.IO.Path]::DirectorySeparatorChar)

        # If it ends with slash, it's a dir
        if ($cleanLine.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
            $dirName = $cleanLine.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
            if ($excludeDirs -notcontains $dirName) { $excludeDirs += $dirName }
        } else {
            # It's a file pattern
            if ($excludeFiles -notcontains $cleanLine) { $excludeFiles += $cleanLine }
        }
    }
}

# --- .aiexclude Assimilation ---
if (Test-Path "$PSScriptRoot\.aiexclude") {
    Write-Host "Parsing .aiexclude..." -ForegroundColor Magenta
    $aiExcludeContent = Get-Content "$PSScriptRoot\.aiexclude"
    foreach ($line in $aiExcludeContent) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#") -or $line.StartsWith("!")) { continue }
        $cleanLine = $line.Trim().Replace('/', [System.IO.Path]::DirectorySeparatorChar)

        # If it ends with slash, it's a dir
        if ($cleanLine.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
            $dirName = $cleanLine.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
            if ($excludeDirs -notcontains $dirName) { $excludeDirs += $dirName }
        } else {
            # It's a file pattern
            if ($excludeFiles -notcontains $cleanLine) { $excludeFiles += $cleanLine }
        }
    }
}

# --- Function: Generate File Tree ---
function Write-FileTree {
    param (
        [string]$Path,
        [string]$Indent,
        [bool]$IsLast,
        [string]$RootPath
    )

    $items = Get-ChildItem -Path $Path -Force | Where-Object {
        # Apply strict directory filtering at the tree level too
        $isExcluded = $false

        # Check if this item is a directory in the exclude list
        if ($_.PSIsContainer) {
            if ($excludeDirs -contains $_.Name) { $isExcluded = $true }
        } else {
            # Check file patterns
            foreach ($pattern in $excludeFiles) {
                if ($_.Name -like $pattern) { $isExcluded = $true; break }
            }
        }
        return -not $isExcluded
    }

    $count = $items.Count
    $i = 0

    foreach ($item in $items) {
        $i++
        $isLastItem = ($i -eq $count)

        if ($isLastItem) {
            $marker = "└── "
        } else {
            $marker = "├── "
        }

        $line = "$Indent$marker$($item.Name)"

        # Write to file immediately
        Add-Content -Path $BackupFile -Value $line

        if ($item.PSIsContainer) {
            if ($isLastItem) {
                $nextIndent = "    "
            } else {
                $nextIndent = "│   "
            }
            $newIndent = $Indent + $nextIndent

            Write-FileTree -Path $item.FullName -Indent $newIndent -IsLast $isLastItem -RootPath $RootPath
        }
    }
}

# --- Execution ---
Write-Host "Initializing Backup..." -ForegroundColor Green
Write-Host "Target: $BackupFile"

# Initialize File
Set-Content -Path $BackupFile -Value "# PROJECT BACKUP: $Timestamp"
Add-Content -Path $BackupFile -Value "# NOTE: Binary files and 'libs' directory excluded."
Add-Content -Path $BackupFile -Value "`n# --- PROJECT STRUCTURE ---"

# 1. Generate Tree
Write-Host "Generating File Tree..." -ForegroundColor Cyan
Write-FileTree -Path $PSScriptRoot -Indent "" -IsLast $true -RootPath $PSScriptRoot

Add-Content -Path $BackupFile -Value "`n# --- FILE CONTENTS ---"

# 2. Backup Content
Write-Host "Backing up content..." -ForegroundColor Cyan

Get-ChildItem -Path $PSScriptRoot -Recurse -File | ForEach-Object {
    $file = $_

    # Check Exclusions
    if (Test-IsExcluded -Item $file -RootPath $PSScriptRoot) { return }

    # Check Size
    if ($file.Length -gt $FileSizeLimit) {
        Add-Content -Path $BackupFile -Value "`n## FILE: $($file.FullName.Replace($PSScriptRoot, '.')) [SKIPPED - TOO LARGE]"
        return
    }

    try {
        $content = Get-Content $file.FullName -Raw
    }
    catch {
        Write-Warning "Locked: $($file.Name)"
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($content)) {
        if ($content.Contains("`0")) { return } # Skip binaries missed by extension

        $relativePath = $file.FullName.Replace($PSScriptRoot, '.')
        Write-Host "  + $relativePath"

        Add-Content -Path $BackupFile -Value "`n## FILE: $relativePath"
        Add-Content -Path $BackupFile -Value $content.Trim()
    }
}

Write-Host "---"
Write-Host "✅ Backup complete. Upload this file." -ForegroundColor Green