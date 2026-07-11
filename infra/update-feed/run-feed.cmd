@echo off
REM GLB Update Feed launcher — dùng cho Scheduled Task ONSTART (chạy dưới SYSTEM, bền qua reboot).
REM Log ghi vào D:\glb-updates\_feed.log (ghi đè mỗi lần khởi động để không phình vô hạn).
set "GLB_FEED_DIR=D:\glb-updates"
set "GLB_FEED_PORT=8686"
set "GLB_FEED_HOST=0.0.0.0"
"C:\Program Files\nodejs\node.exe" "D:\TT HKD AI\tools\quan-ly-glb\infra\update-feed\server.mjs" > "D:\glb-updates\_feed.log" 2>&1
