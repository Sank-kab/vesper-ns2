Option Explicit
Dim WshShell, fso, baseDir, nodeExe, edgePath, url, i, isUp

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = baseDir
url = "http://127.0.0.1:47821"

Function IsServerReady()
  Dim http, code
  IsServerReady = False
  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.SetTimeouts 400, 400, 400, 400
  http.Open "GET", url & "/api/state", False
  http.Send
  If Err.Number = 0 Then
    code = http.Status
    If Err.Number = 0 Then
      If code = 200 Then IsServerReady = True
    End If
  End If
  Err.Clear
  On Error GoTo 0
End Function

isUp = IsServerReady()

If Not isUp Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
  If Not fso.FileExists(nodeExe) Then nodeExe = "node"
  WshShell.Run """" & nodeExe & """ """ & baseDir & "\server.cjs""", 0, False
  For i = 1 To 25
    WScript.Sleep 250
    If IsServerReady() Then
      isUp = True
      Exit For
    End If
  Next
End If

If Not isUp Then
  MsgBox "Unable to start Vesper server on " & url & "." & vbCrLf & "Try running launch-gui.bat to see the error output.", vbCritical, "Vesper"
  WScript.Quit 1
End If

edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edgePath) Then
  edgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
End If

If fso.FileExists(edgePath) Then
  WshShell.Run """" & edgePath & """ --app=" & url & " --window-size=1240,840", 1, False
Else
  WshShell.Run url, 1, False
End If
