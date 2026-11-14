# jednoduchy staticky HTTP server pro testovani hry
$ErrorActionPreference = 'Stop'
$port = 8137
$root = (Get-Location).Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json'
}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Host "serving $root on http://127.0.0.1:$port/"
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 4000
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII)
    $line = $reader.ReadLine()
    if (-not $line) { $client.Close(); continue }
    $parts = $line.Split(' ')
    if ($parts.Length -lt 2 -or $parts[0] -ne 'GET') { $client.Close(); continue }
    $url = $parts[1]
    while ($true) { $l = $reader.ReadLine(); if ($null -eq $l -or $l -eq '') { break } }
    $path = $url
    if ($path.Contains('?')) { $path = $path.Substring(0, $path.IndexOf('?')) }
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $rel = [Uri]::UnescapeDataString($path).Replace('/', '\')
    $file = Join-Path $root $rel.TrimStart('\')
    $resp = $null; $code = 200; $ctype = 'application/octet-stream'
    if ((Test-Path -LiteralPath $file -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
      $resp = [IO.File]::ReadAllBytes($file)
    } else { $code = 404; $ctype = 'text/plain'; $resp = [Text.Encoding]::UTF8.GetBytes('404') }
    $head = "HTTP/1.1 $code OK`r`nContent-Type: $ctype`r`nContent-Length: $($resp.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($resp, 0, $resp.Length)
    $stream.Flush()
  } catch { }
  finally { try { $client.Close() } catch {} }
}
