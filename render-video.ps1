$ErrorActionPreference = 'Stop'
$ffmpeg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter ffmpeg.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg) { throw 'FFmpeg was not found. Install Gyan.FFmpeg.Essentials with winget.' }
javac .\CodeInMotionVideo.java
if ($LASTEXITCODE -ne 0) { throw 'Java compilation failed.' }
java CodeInMotionVideo $ffmpeg .\code-in-motion.mp4
if ($LASTEXITCODE -ne 0) { throw 'Video rendering failed.' }
