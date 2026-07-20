Require node
Require vhs
# construct demo: publish guardrails via the construct cockpit (violet theme)
Output .construct/demos/agentic-platforms-prd.mp4
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme {"name":"Construct Cockpit","background":"#0c1018","foreground":"#e8eaed","cursor":"#8b5cf6","cursorAccent":"#0c1018","selection":"#1e1b4b","black":"#0c1018","red":"#e06c75","green":"#98c379","yellow":"#e5c07b","blue":"#8b5cf6","magenta":"#c4b5fd","cyan":"#a78bfa","white":"#e8eaed","brightBlack":"#6b7280","brightRed":"#f87171","brightGreen":"#86efac","brightYellow":"#fbbf24","brightBlue":"#a78bfa","brightMagenta":"#ddd6fe","brightCyan":"#c4b5fd","brightWhite":"#ffffff"}
Set TypingSpeed 42ms

Type "node bin/construct --demo=agentic-platforms-prd"
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
