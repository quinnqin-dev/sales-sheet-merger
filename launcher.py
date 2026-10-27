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
                raise SystemExit('启动失败，请检查 8765 端口是否被占用，或是否已有其他实例运行。')
            if is_running():
                print('归表已启动：' + URL + '\n保持此窗口打开；按 Control-C 退出并清理临时数据。')
                webbrowser.open(URL)
                break
            time.sleep(0.1)
        else:
            raise SystemExit('启动超时，请检查终端中的错误信息。')
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
