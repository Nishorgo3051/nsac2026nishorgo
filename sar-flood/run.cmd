@echo off
rem Runs a script in this project's Python environment.
rem   run.cmd test_flood_extent.py
rem   run.cmd flood_extent.py
rem   run.cmd nisar_flood.py
setlocal
set PYTHONDONTWRITEBYTECODE=1
"C:\Users\USER\.venvs\sar-flood\Scripts\python.exe" %*
