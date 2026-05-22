param(
  [Parameter(Mandatory = $true)]
  [string] $PdfPath,

  [string] $Language = "auto",

  [int] $MaxPages = 0
)

$ErrorActionPreference = "Stop"

function Await-WinRt($AsyncOperation, $ResultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
    } |
    Select-Object -First 1).MakeGenericMethod($ResultType)

  $task = $asTask.Invoke($null, @($AsyncOperation))
  $task.Wait()
  return $task.Result
}

function Await-WinRtAction($AsyncAction) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq "IAsyncAction"
    } |
    Select-Object -First 1)

  $task = $asTask.Invoke($null, @($AsyncAction))
  $task.Wait()
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfPage, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$resolved = (Resolve-Path -LiteralPath $PdfPath).Path

if ($Language -eq "auto") {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
} else {
  $lang = [Windows.Globalization.Language]::new($Language)
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}

if ($null -eq $engine) {
  throw "No OCR engine is available for language '$Language'."
}

$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])
$pdf = Await-WinRt ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$pageCount = [int]$pdf.PageCount
$limit = $pageCount
if ($MaxPages -gt 0 -and $MaxPages -lt $pageCount) {
  $limit = $MaxPages
}

$pages = @()
for ($i = 0; $i -lt $limit; $i++) {
  $page = $pdf.GetPage([uint32]$i)
  try {
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
    $options.DestinationWidth = [uint32]([math]::Max(1, [math]::Round($page.Size.Width * 2)))
    $options.DestinationHeight = [uint32]([math]::Max(1, [math]::Round($page.Size.Height * 2)))
    Await-WinRtAction ($page.RenderToStreamAsync($stream, $options))
    $stream.Seek(0) | Out-Null

    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($line in $result.Lines) {
      $lines += $line.Text
    }

    $pages += [ordered]@{
      page = $i + 1
      text = $result.Text
      lines = $lines
      source = "ocr"
    }
  } finally {
    if ($page -ne $null) {
      $page.Dispose()
    }
  }
}

[ordered]@{
  file = $resolved
  pageCount = $pageCount
  processedPages = $limit
  language = $engine.RecognizerLanguage.LanguageTag
  pages = $pages
} | ConvertTo-Json -Depth 6
