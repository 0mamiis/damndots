# damndots v0.3.8

When a Dot tries to message an archived local Codex chat, the error now identifies the archived chat instead of showing a generic HTTP 500. It returns HTTP 409 and tells the Dot to stop retrying or selecting a different chat automatically. The owner can restore the intended chat or request a new one.

Other local Codex connection failures return HTTP 502 with their error message, so a remote worker can report the actual cause. This release does not restore archived chats automatically or change their models.

Validation covers both HTTP bridge failures and failed desktop tool results, plus the existing local dispatch approval checks.
