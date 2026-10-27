"""Launch a single loopback-only server and open its browser UI."""
import json
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

URL = 'http://127.0.0.1:8765'
ROOT = Path(__file__).resolve().parent
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def is_running():
    try:
        with opener.open(URL + '/api/health', timeout=0.5) as response:
            return json.load(response).get('app') == 'sales-sheet-merger'
    except (OSError, ValueError):
        return False


def main():
    if is_running():
        webbrowser.open(URL)
        return
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app:app',
                                '--host', '127.0.0.1', '--port', '8765', '--no-access-log'], cwd=ROOT)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise SystemExit('Startup failed. Check whether port 8765 is in use or another instance is running.')
            if is_running():
                print('Sheet Merger is running: ' + URL + '\nKeep this window open. Press Control-C to exit and clear temporary data.')
                webbrowser.open(URL)
                break
            time.sleep(0.1)
        else:
            raise SystemExit('Startup timed out. Check the errors in this terminal.')
        process.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == '__main__':
    main()
