param([string]$Arg = "open")

$Arg = $Arg.TrimStart('@')

$Mode = if     ([string]::IsNullOrEmpty($Arg) -or $Arg -eq 'open') { 'open'  }
        elseif ($Arg -eq 'close')                                   { 'close' }
        else                                                        { 'path'  }

if (-not (Get-Command broot -ErrorAction SilentlyContinue)) {
    Write-Host 'broot がインストールされていません。`winget install dystroy.broot` でインストールできます。'
    exit 1
}

switch ($Mode) {
    'open' {
        if (Get-Process broot -ErrorAction SilentlyContinue) {
            Write-Host 'すでに開いています。Windows Terminal のペインを切り替えてください。'
        } else {
            wt --window 0 split-pane -V -d '.' broot .
            Write-Host '右ペインに broot を開きました。`Alt+→` で移動できます。'
        }
    }
    'close' {
        Stop-Process -Name broot -ErrorAction SilentlyContinue
        Write-Host 'broot を閉じました。'
    }
    'path' {
        $Target = $Arg
        if (-not [System.IO.Path]::IsPathRooted($Target)) {
            $Target = Join-Path (Get-Location) $Target
        }
        if (-not (Test-Path $Target)) {
            Write-Host "`"$Arg`" が見つかりません。"
            exit 1
        }
        $Item = Get-Item $Target
        if ($Item.PSIsContainer) {
            $TargetDir = $Item.FullName
            $Query     = $null
        } else {
            $TargetDir = $Item.DirectoryName
            $Query     = $Item.Name
        }
        Stop-Process -Name broot -ErrorAction SilentlyContinue
        if ($null -eq $Query) {
            wt --window 0 split-pane -V -d $TargetDir broot .
        } else {
            wt --window 0 split-pane -V -d $TargetDir broot . --cmd $Query
        }
        Write-Host "右ペインに broot を開き、``$Arg`` にフォーカスしました。``Alt+→`` で移動できます。"
    }
}
