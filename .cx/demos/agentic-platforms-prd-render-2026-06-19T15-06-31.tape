Require node
Require vhs
# construct demo: publish guardrails — gate blocks stubs, passes golden fixture
Output /Users/geralddagher/Developer/Projects/construct/.cx/demos/agentic-platforms-prd.mp4
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "Dracula"
Set TypingSpeed 48ms

Type "# 1) Plan only — workflow invoke returns specialist chain (does not draft)"
Sleep 400ms
Enter
Sleep 900ms

Type "node bin/construct workflow invoke --json --workflow-type prd-draft --approval-mode proposal-only --text 'Enterprise agentic platform PRD' | head -30"
Sleep 500ms
Enter
Sleep 4s

Type "# 2) Release gate FAIL — thin stub missing manifest sections"
Sleep 400ms
Enter
Sleep 900ms

Type "node bin/construct artifact validate tests/fixtures/publish/agentic-platforms-stub.md --type=prd-platform 2>&1 | head -14"
Sleep 500ms
Enter
Sleep 3s

Type "# 3) Publish FAIL — gate blocks distribution"
Sleep 400ms
Enter
Sleep 800ms

Type "node bin/construct publish tests/fixtures/publish/agentic-platforms-stub.md --figures 2>&1 | head -12"
Sleep 500ms
Enter
Sleep 3s

Type "# 4) Golden fixture PASS — shape specialists should produce"
Sleep 400ms
Enter
Sleep 900ms

Type "node bin/construct artifact validate tests/fixtures/publish/golden-prd-platform.md --type=prd-platform 2>&1 | tail -6"
Sleep 500ms
Enter
Sleep 2s

Type "# 5) Publish PASS — styled PDF (Construct Typst template + figures)"
Sleep 400ms
Enter
Sleep 900ms

Type "node bin/construct publish tests/fixtures/publish/golden-prd-platform.md --type=prd-platform --figures --output .cx/publish/golden-prd-platform.pdf"
Sleep 500ms
Enter
Sleep 8s

Type "ls -lh .cx/publish/golden-prd-platform.pdf && open .cx/publish/golden-prd-platform.pdf"
Sleep 500ms
Enter
Sleep 2s
