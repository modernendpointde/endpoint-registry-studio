export const DEVICE_MARK_HELPER = String.raw`function Write-ErsDeviceMark {
    param([string]$Mark)
    try {
        $directory = Join-Path $env:ProgramData 'Endpoint Registry Studio'
        if (-not (Test-Path -LiteralPath $directory)) {
            New-Item -Path $directory -ItemType Directory -Force | Out-Null
        }
        $path = Join-Path $directory 'ers.log'
        $line = ([datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')) + ' ' + $Mark + [Environment]::NewLine
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::AppendAllText($path, $line, $utf8)
    } catch {
    }
}`;
