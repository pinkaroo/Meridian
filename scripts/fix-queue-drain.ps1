# Replace the inter-step queue drain block in agentRunner.ts so a queued
# user message becomes its own conversational turn instead of being
# appended to the prior tool_results turn (which caused the next assistant
# response to glue onto the prior task's bubble).
$path = 'src\lib\agentRunner.ts'
$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

# Anchor on the unique comment that starts the block.
$startMarker = '      // Inter-step queue drain:'
$startIdx = $text.IndexOf($startMarker)
if ($startIdx -lt 0) { Write-Host 'start marker not found'; exit 1 }

# The block ends with the history.push for the <tool_results> turn.
# Find the next occurrence of the closing '});' that belongs to that push
# by locating the unique 'queuedTrailer}' fragment and walking forward.
$qtIdx = $text.IndexOf('queuedTrailer}', $startIdx)
if ($qtIdx -lt 0) { Write-Host 'queuedTrailer anchor not found'; exit 1 }
$closeIdx = $text.IndexOf('});', $qtIdx)
if ($closeIdx -lt 0) { Write-Host 'close brace not found'; exit 1 }
$closeIdx += 3  # include the });

$replacement = @'
      // Push the tool_results turn first, untouched. Any queued user message
      // is then pushed as a SEPARATE user turn so the model treats it as a
      // fresh instruction rather than an addendum to the tool batch. Without
      // this split, the next assistant response visually glues onto the prior
      // task's bubble because it's still answering the same conversational turn.
      history.push({
        role: "user",
        content: `<tool_results>\n${toolOutputs.join("\n\n")}${trailer}\n</tool_results>`,
      });

      const queuedMid = cb.onConsumeQueued?.();
      if (queuedMid && queuedMid.content) {
        // Close out the current assistant bubble before opening a new one â
        // otherwise the streaming flag stays set on a message that's done.
        cb.onMessageUpdate(assistantMsgId, () => ({ streaming: false, content: aggregateText }));

        cb.onMessageCreate({
          id: uid("msg"),
          role: "user",
          content: queuedMid.content,
          timestamp: Date.now(),
          attachments: queuedMid.attachments && queuedMid.attachments.length > 0 ? queuedMid.attachments : undefined,
        });

        // Fresh assistant bubble for the queued turn's response.
        const nextAssistantMsg: Message = {
          id: uid("msg"),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          streaming: true,
          segments: [],
          model,
        };
        assistantMsgId = nextAssistantMsg.id;
        cb.onMessageCreate(nextAssistantMsg);
        aggregateText = "";

        history.push({ role: "user", content: renderUserTurn(queuedMid.content, queuedMid.attachments) });
      }
'@

$before = $text.Substring(0, $startIdx)
$after  = $text.Substring($closeIdx)
$new    = $before + $replacement + $after

$enc = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Resolve-Path $path), $new, $enc)
Write-Host "patched: $path"
Write-Host ("removed " + ($closeIdx - $startIdx) + " chars, inserted " + $replacement.Length + " chars")