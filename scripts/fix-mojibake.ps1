# One-shot cleanup of UTF-8-misread-as-Latin1 mojibake in source files.
# Each pair maps the broken byte sequence (as it currently sits on disk,
# read as UTF-8) to the character it was supposed to be.
$files = @(
	'src\components\MessageRow.tsx',
	'src\components\ToolCard.tsx',
	'src\lib\imageAttachment.ts'
)

# Mapping table: broken -> intended
$map = @{
	([char]0xC3 + [char]0xA2 + [char]0x80 + [char]0xA6) = [char]0x2026  # â¦
	([char]0xC3 + [char]0x82 + [char]0xC2 + [char]0xB7) = [char]0x00B7  # Â·  (double-encoded)
	([char]0xC2 + [char]0xB7)                            = [char]0x00B7  # Â·
	([char]0xC3 + [char]0xA2 + [char]0x80 + [char]0x94) = [char]0x2014  # â
	([char]0xC3 + [char]0xA2 + [char]0x80 + [char]0x93) = [char]0x2013  # â
	([char]0xC3 + [char]0xA2 + [char]0x94 + [char]0x80) = [char]0x2500  # â
	([char]0xC3 + [char]0x97)                            = [char]0x00D7  # Ã
}

foreach ($f in $files) {
	if (-not (Test-Path $f)) { Write-Host "skip (missing): $f"; continue }
	$bytes = [System.IO.File]::ReadAllBytes($f)
	$text  = [System.Text.Encoding]::UTF8.GetString($bytes)
	$orig  = $text
	foreach ($k in $map.Keys) { $text = $text.Replace($k, $map[$k]) }
	if ($text -ne $orig) {
		$enc = New-Object System.Text.UTF8Encoding $false
		[System.IO.File]::WriteAllText((Resolve-Path $f), $text, $enc)
		Write-Host "fixed: $f"
	} else {
		Write-Host "no change: $f"
	}
}