@echo off
REM Open the official Desktop protocol so the running instance focuses.
REM Used as snoretoast -application target (must not share Desktop AUMID).
start "" "dsh://open"
