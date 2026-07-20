Require node
Require vhs
# construct demo: resource guard rails — disk budget walkthrough
Output .construct/demos/resource-guard-rails.mp4
Set FontSize 18
Set Width 1200
Set Height 680
Set Theme "Dracula"
Set TypingSpeed 55ms

Type "# 1) Show .construct/ usage vs cap in doctor"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "node bin/construct doctor 2>&1 | tail -25"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "# 2) Preview retention prune (dry-run)"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "node bin/construct prune --dry-run"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "# 3) Run resource budget functional test"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "node --test tests/functional/resource-write-guard.functional.test.mjs"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "# 4) User-scope cleanup (logs + pressure)"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "node bin/construct cleanup --disk-only --dry-run"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms
