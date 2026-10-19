' Opens Smart Hospital in its own window (Microsoft Edge app mode), or the default browser.
' Usage: wscript open-app.vbs [url]
Dim url, sh
url = "http://localhost:3010"
If WScript.Arguments.Count > 0 Then url = WScript.Arguments(0)
Set sh = CreateObject("WScript.Shell")
On Error Resume Next
sh.Run "msedge --app=" & url, 1, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run url, 1, False
End If
