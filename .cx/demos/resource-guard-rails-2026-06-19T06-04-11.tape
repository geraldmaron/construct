# construct demo: resource guard rails — disk budget walkthrough
Output /Users/geralddagher/Developer/Projects/construct/.cx/demos/resource-guard-rails-2026-06-19T06-04-11.gif
Set FontSize 18
Set Width 1200
Set Height 680
Set Theme "Dracula"
Set TypingSpeed 55ms

Type "# 1) Show .cx/ usage vs cap in doctor"
Sleep 400ms
Enter
Sleep 800ms

Type "construct doctor 2>&1 | rg '\\.cx/' || construct doctor | tail -20"
Sleep 400ms
Enter
Sleep 3s

Type "# 2) Preview retention prune (dry-run)"
Sleep 400ms
Enter
Sleep 800ms

Type "construct prune --dry-run"
Sleep 400ms
Enter
Sleep 2s

Type "# 3) Run resource budget tests (write gate)"
Sleep 400ms
Enter
Sleep 800ms

Type "node --test tests/functional/resource-write-guard.functional.test.mjs"
Sleep 400ms
Enter
Sleep 3s

Type "# 4) User-scope cleanup (logs + pressure)"
Sleep 400ms
Enter
Sleep 800ms

Type "construct cleanup --disk-only --dry-run"
Sleep 400ms
Enter
Sleep 2s
