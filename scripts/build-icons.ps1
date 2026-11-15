$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets'
[System.IO.Directory]::CreateDirectory($assetDirectory) | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$width, [single]$height, [single]$radius) {
    $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $shape.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $shape.AddArc(($x + $width - $diameter), $y, $diameter, $diameter, 270, 90)
    $shape.AddArc(($x + $width - $diameter), ($y + $height - $diameter), $diameter, $diameter, 0, 90)
    $shape.AddArc($x, ($y + $height - $diameter), $diameter, $diameter, 90, 90)
    $shape.CloseFigure()
    return $shape
}

# Same geometry and palette as assets/icon.svg, rendered with supersampling.
$source = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($source)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(2, 2)
$navy = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#141b27'))
$mint = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#83d7c3'))
$whitePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#e8eef8'), 24)
$dividerPen = [System.Drawing.Pen]::new($whitePen.Color, 16)
$outline = [System.Drawing.Pen]::new($navy.Color, 20)
$tile = New-RoundedPath 0 0 512 512 96
$window = New-RoundedPath 80 104 328 256 28
$picture = New-RoundedPath 224 240 224 160 24
$graphics.FillPath($navy, $tile)
$graphics.DrawPath($whitePen, $window)
$graphics.DrawLine($dividerPen, 92, 168, 396, 168)
$graphics.FillPath($mint, $picture)
$graphics.DrawPath($outline, $picture)
$graphics.FillPolygon($navy, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(308, 280),
    [System.Drawing.PointF]::new(364, 320),
    [System.Drawing.PointF]::new(308, 360)
))
$graphics.Dispose()
$frames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
    $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $canvas.DrawImage($source, 0, 0, $size, $size)
    $canvas.Dispose()
    $memory = [System.IO.MemoryStream]::new()
    $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memory.ToArray()
    if ($size -le 256) { $frames += [PSCustomObject]@{ Size = $size; Bytes = $bytes } }
    if ($size -eq 512) { [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'icon.png'), $bytes) }
    if ($size -eq 32) { [System.IO.File]::WriteAllBytes((Join-Path $assetDirectory 'tray.png'), $bytes) }
    $memory.Dispose()
    $bitmap.Dispose()
}
$stream = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
$writer.Dispose()
$source.Dispose()
foreach ($resource in @($navy, $mint, $whitePen, $dividerPen, $outline, $tile, $window, $picture)) { $resource.Dispose() }
Write-Output 'Icônes générées : icon.ico (16 à 256 px), icon.png (512 px), tray.png (32 px).'
