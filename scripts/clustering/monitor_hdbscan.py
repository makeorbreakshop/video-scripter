#!/usr/bin/env python3
"""
Monitor HDBSCAN progress using system resources
"""
import psutil
import time
import os

print("Monitoring HDBSCAN clustering progress...")
print("(High CPU = working, Low CPU = possibly stuck)")
print("-" * 60)

# Find python process
python_pid = None
for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
    try:
        if 'python' in proc.info['name'].lower():
            cmdline = proc.info.get('cmdline', [])
            if any('bertopic' in str(cmd).lower() for cmd in cmdline):
                python_pid = proc.info['pid']
                break
    except:
        pass

if not python_pid:
    print("No BERTopic process found!")
else:
    print(f"Found BERTopic process: PID {python_pid}")
    proc = psutil.Process(python_pid)
    
    try:
        start_time = time.time()
        while True:
            cpu = proc.cpu_percent(interval=1)
            mem = proc.memory_info().rss / 1024 / 1024 / 1024  # GB
            elapsed = int(time.time() - start_time)
            
            status = "🟢 Active" if cpu > 50 else "🟡 Low activity" if cpu > 10 else "🔴 Stuck?"
            
            print(f"\r[{elapsed}s] CPU: {cpu:5.1f}% | RAM: {mem:4.1f}GB | Status: {status}  ", end="", flush=True)
            
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nStopped monitoring")
    except psutil.NoSuchProcess:
        print("\nProcess ended!")