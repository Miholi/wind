# =============================================================
# Angen 图片 美化 + 优化 脚本 (兼容 Windows PowerShell 5.1)
# 输入: originals/angen-src.jpg  (原图的未修改副本, 与 D:\equip 原件哈希一致)
# 输出:
#   renderer/img/angen.jpg     美化后全尺寸版 (1280x720, JPEG q88)
#   renderer/img/angen-bg.jpg  轻量模糊背景版 (720 宽, JPEG q80, 供 splash 使用)
# 处理: 饱和度 +10% (保亮度) x 对比 +7% (中点保持, 不动色相) -> 轻度 USM 锐化
#       背景版: 重度模糊 + 轻压暗, 前景文字始终可读
# 注: 5.1 在脚本文件模式下对 jagged 数组元素赋值有类型转换 bug,
#     因此 ColorMatrix 一律用 Matrix00~44 字段逐项赋值, 组合矩阵为手工预计算值。
# =============================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root 'originals\angen-src.jpg'
$outEnh  = Join-Path $root 'renderer\img\angen.jpg'
$outBg   = Join-Path $root 'renderer\img\angen-bg.jpg'
if (-not (Test-Path $srcPath)) { throw "source not found: $srcPath" }

$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path, [int]$quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
  $eps = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $eps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
  $bmp.Save($path, $codec, $eps)
  $eps.Dispose()
}

function Get-Stats([System.Drawing.Bitmap]$bmp) {
  $r = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $d = $bmp.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $len = [Math]::Abs($d.Stride) * $bmp.Height
    $buf = New-Object byte[] $len
    [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $len)
    $n = $bmp.Width * $bmp.Height
    $s1 = 0.0; $s2 = 0.0; $sat = 0.0
    for ($i = 0; $i -lt $len; $i += 4) {
      $b = $buf[$i]; $g = $buf[$i + 1]; $rr = $buf[$i + 2]
      $l = 0.299 * $rr + 0.587 * $g + 0.114 * $b
      $s1 += $l; $s2 += $l * $l
      $mx = $rr; if ($g -gt $mx) { $mx = $g }; if ($b -gt $mx) { $mx = $b }
      $mn = $rr; if ($g -lt $mn) { $mn = $g }; if ($b -lt $mn) { $mn = $b }
      if ($mx -gt 0) { $sat += ($mx - $mn) / $mx }
    }
    $avg = $s1 / $n
    $std = [Math]::Sqrt([Math]::Max(0.0, $s2 / $n - $avg * $avg))
    [pscustomobject]@{ Avg = [Math]::Round($avg, 1); Std = [Math]::Round($std, 1); Sat = [Math]::Round($sat / $n, 3) }
  }
  finally { $bmp.UnlockBits($d) }
}

function Get-Sharpness([System.Drawing.Bitmap]$bmp) {
  $r = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
  $d = $bmp.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $len = [Math]::Abs($d.Stride) * $bmp.Height
    $buf = New-Object byte[] $len
    [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $len)
    $w = $bmp.Width; $h = $bmp.Height; $st = [Math]::Abs($d.Stride)
    $lum = New-Object double[] ($w * $h)
    for ($y = 0; $y -lt $h; $y++) {
      $row = $y * $st
      for ($x = 0; $x -lt $w; $x++) {
        $o = $row + $x * 4
        $lum[$y * $w + $x] = 0.299 * $buf[$o + 2] + 0.587 * $buf[$o + 1] + 0.114 * $buf[$o]
      }
    }
    $sum = 0.0; $cnt = 0
    for ($y = 1; $y -lt $h - 1; $y += 2) {
      for ($x = 1; $x -lt $w - 1; $x += 2) {
        $c = $y * $w + $x
        $lap = 4 * $lum[$c] - $lum[$c - $w] - $lum[$c + $w] - $lum[$c - 1] - $lum[$c + 1]
        $sum += $lap * $lap; $cnt++
      }
    }
    [Math]::Round($sum / $cnt, 1)
  }
  finally { $bmp.UnlockBits($d) }
}

# 组合矩阵 = 对比(1.07) x 饱和(1.10), 手工预计算:
#   [ 1.145007 -0.031993 -0.031993  0 0 ]
#   [-0.062809  1.114191 -0.062809  0 0 ]
#   [-0.012198 -0.012198  1.164802  0 0 ]
#   [ 0         0         0         1 0 ]
#   [-0.035    -0.035    -0.035     0 1 ]
$cm = New-Object System.Drawing.Imaging.ColorMatrix
$cm.Matrix00 = 1.145007; $cm.Matrix01 = -0.031993; $cm.Matrix02 = -0.031993
$cm.Matrix10 = -0.062809; $cm.Matrix11 = 1.114191; $cm.Matrix12 = -0.062809
$cm.Matrix20 = -0.012198; $cm.Matrix21 = -0.012198; $cm.Matrix22 = 1.164802
$cm.Matrix33 = 1.0
$cm.Matrix40 = -0.035; $cm.Matrix41 = -0.035; $cm.Matrix42 = -0.035; $cm.Matrix44 = 1.0
$ia = New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix($cm)

# ---------- 载入 ----------
$src = New-Object System.Drawing.Bitmap($srcPath)
$w = $src.Width; $h = $src.Height
$stats0 = Get-Stats $src
$sharp0 = Get-Sharpness $src
"[source] ${w}x${h}  avg=$($stats0.Avg) std=$($stats0.Std) sat=$($stats0.Sat) sharp=$sharp0"

# ---------- 1) 色彩矩阵处理 (饱和 +10%, 对比 +7%) ----------
$cm32 = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($cm32)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$destRect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$g.DrawImage($src, $destRect, 0, 0, $w, $h, [System.Drawing.GraphicsUnit]::Pixel, $ia)
$g.Dispose()
$ia.Dispose()

# ---------- 2) 轻度 USM 锐化 (下采样模糊作残差, amount 0.38) ----------
$bw2 = [Math]::Max(1, [int]($w / 4)); $bh2 = [Math]::Max(1, [int]($h / 4))
$small = New-Object System.Drawing.Bitmap($bw2, $bh2, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g2 = [System.Drawing.Graphics]::FromImage($small)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($cm32, 0, 0, $bw2, $bh2)
$g2.Dispose()

$blurUp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g3 = [System.Drawing.Graphics]::FromImage($blurUp)
$g3.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g3.DrawImage($small, 0, 0, $w, $h)
$g3.Dispose()
$small.Dispose()

$rct = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$dA = $cm32.LockBits($rct, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$dB = $blurUp.LockBits($rct, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$len = [Math]::Abs($dA.Stride) * $h
$bufA = New-Object byte[] $len
$bufB = New-Object byte[] $len
[System.Runtime.InteropServices.Marshal]::Copy($dA.Scan0, $bufA, 0, $len)
[System.Runtime.InteropServices.Marshal]::Copy($dB.Scan0, $bufB, 0, $len)

$fx = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$dO = $fx.LockBits($rct, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bufO = New-Object byte[] $len
$amt = 0.38
for ($i = 0; $i -lt $len; $i += 4) {
  $o1 = $i; $o2 = $i + 1; $o3 = $i + 2
  $v = [int]($bufA[$o1] + $amt * ($bufA[$o1] - $bufB[$o1]))
  if ($v -lt 0) { $v = 0 } elseif ($v -gt 255) { $v = 255 }
  $bufO[$o1] = [byte]$v
  $v = [int]($bufA[$o2] + $amt * ($bufA[$o2] - $bufB[$o2]))
  if ($v -lt 0) { $v = 0 } elseif ($v -gt 255) { $v = 255 }
  $bufO[$o2] = [byte]$v
  $v = [int]($bufA[$o3] + $amt * ($bufA[$o3] - $bufB[$o3]))
  if ($v -lt 0) { $v = 0 } elseif ($v -gt 255) { $v = 255 }
  $bufO[$o3] = [byte]$v
  $bufO[$o3 + 1] = [byte]255
}
[System.Runtime.InteropServices.Marshal]::Copy($bufO, 0, $dO.Scan0, $len)
$fx.UnlockBits($dO)
$cm32.UnlockBits($dA); $blurUp.UnlockBits($dB)
$cm32.Dispose(); $blurUp.Dispose()

Save-Jpeg $fx $outEnh 88

# ---------- 3) 轻量模糊背景版 (720 宽, 重模糊, 轻压暗) ----------
$bw = 720; $bh = [int][Math]::Round($bw * $h / $w)
$bSmall = New-Object System.Drawing.Bitmap(90, [int][Math]::Round($bh / 8), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gA = [System.Drawing.Graphics]::FromImage($bSmall)
$gA.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gA.DrawImage($fx, 0, 0, $bSmall.Width, $bSmall.Height)
$gA.Dispose()

$bg = New-Object System.Drawing.Bitmap($bw, $bh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gB = [System.Drawing.Graphics]::FromImage($bg)
$gB.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gB.DrawImage($bSmall, 0, 0, $bw, $bh)
$gB.Dispose()
$bSmall.Dispose()

# 轻压暗: scale 0.94 + 微抬黑 0.015, 保证前景文字对比度
$dm = New-Object System.Drawing.Imaging.ColorMatrix
$dm.Matrix00 = 0.94; $dm.Matrix11 = 0.94; $dm.Matrix22 = 0.94
$dm.Matrix33 = 1.0
$dm.Matrix40 = 0.015; $dm.Matrix41 = 0.015; $dm.Matrix42 = 0.015; $dm.Matrix44 = 1.0
$dia = New-Object System.Drawing.Imaging.ImageAttributes
$dia.SetColorMatrix($dm)
$bgDark = New-Object System.Drawing.Bitmap($bw, $bh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gC = [System.Drawing.Graphics]::FromImage($bgDark)
$gC.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gC.DrawImage($bg, (New-Object System.Drawing.Rectangle(0, 0, $bw, $bh)), 0, 0, $bw, $bh, [System.Drawing.GraphicsUnit]::Pixel, $dia)
$gC.Dispose()
$dia.Dispose(); $bg.Dispose()

Save-Jpeg $bgDark $outBg 80

# ---------- 4) 结果 ----------
$stats1 = Get-Stats $fx
$sharp1 = Get-Sharpness $fx
"[enhanced] avg=$($stats1.Avg) std=$($stats1.Std) sat=$($stats1.Sat) sharp=$sharp1"
$src.Dispose(); $fx.Dispose(); $bgDark.Dispose()

"--- output files ---"
Get-Item $outEnh, $outBg | ForEach-Object { "{0}  {1:N0} bytes" -f $_.Name, $_.Length }
"[elapsed] $([Math]::Round($sw.Elapsed.TotalSeconds, 1)) s"
