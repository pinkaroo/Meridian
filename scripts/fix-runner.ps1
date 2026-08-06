$path = 'src/lib/agentRunner.ts'
$lines = Get-Content $path
$target = 'import { invoke } from "@tauri-apps/api/core";'
$foundIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
	# Match the clean line: starts with 'import' and contains the unescaped marker.
	if ($lines[$i] -match '^import \{ invoke \} from "@tauri-apps/api/core";$') {
		$foundIdx = $i
		break
	}
}
Write-Host "foundIdx=$foundIdx"
if ($foundIdx -ge 0) {
	$clean = $lines[$foundIdx..($lines.Count-1)] -join "`n"
	Set-Content -NoNewline -Path $path -Value $clean
	Write-Host "kept $($lines.Count - $foundIdx) lines"
}