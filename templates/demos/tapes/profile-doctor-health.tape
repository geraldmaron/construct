Require node
Require vhs
# construct demo: profile and health — list, consistency, skills audit
Output .construct/demos/profile-doctor-health.mp4
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "Dracula"
Set TypingSpeed 42ms

Type "node bin/construct --demo=profile-doctor-health"
Sleep 800ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "/demo steps"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "/demo next"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "/demo next"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "/demo next"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms

Type "/exit"
Sleep 400ms
Enter
Wait /[$%›]|construct|Construct|PASS|FAIL|Step/
Sleep 400ms
