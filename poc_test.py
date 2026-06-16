#!/usr/bin/env python3
"""AutoPoC Test Script for doc-haus"""
import json, os, sys, time, socket

POD_IP = os.environ.get("POD_IP", sys.argv[1] if len(sys.argv) > 1 else "")
MAX_RETRIES = 5
RETRY_DELAY = 10
results = []


def raw_http_get(host, port, path="/", timeout=10):
    """Raw HTTP GET with Connection: close to avoid hangs."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        request = f"GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        s.sendall(request.encode())

        # Read response with timeout-aware loop
        data = b""
        while True:
            try:
                chunk = s.recv(8192)
                if not chunk:
                    break
                data += chunk
                # If we've received the full response (Content-Length based or chunked),
                # stop early by checking for end markers
                if len(data) > 100000:
                    break  # Truncate very large responses
            except socket.timeout:
                break

        response = data.decode(errors="replace")
        # Parse status code
        first_line = response.split("\r\n", 1)[0]
        parts = first_line.split(" ", 2)
        status_code = int(parts[1]) if len(parts) >= 2 else 0
        # Parse body
        body = response.split("\r\n\r\n", 1)[1] if "\r\n\r\n" in response else ""
        return status_code, body
    finally:
        s.close()


def test_scenario(name, description, port, path="/",
                  expected_status=200, expected_content=None, timeout=15):
    start = time.time()
    for attempt in range(MAX_RETRIES):
        try:
            status, body = raw_http_get(POD_IP, port, path, timeout)
            if status == expected_status:
                if expected_content and expected_content not in body:
                    r = {"scenario_name": name, "status": "fail",
                         "output": body[:2000],
                         "error_message": f"Expected '{expected_content}' not in response",
                         "duration_seconds": round(time.time()-start, 2)}
                else:
                    r = {"scenario_name": name, "status": "pass",
                         "output": body[:500], "error_message": None,
                         "duration_seconds": round(time.time()-start, 2)}
                results.append(r); return r
            elif attempt < MAX_RETRIES - 1:
                print(f"  Retry {attempt+1}/{MAX_RETRIES}: got status {status}", file=sys.stderr)
                time.sleep(RETRY_DELAY); continue
            else:
                r = {"scenario_name": name, "status": "fail",
                     "output": body[:2000],
                     "error_message": f"Expected {expected_status}, got {status}",
                     "duration_seconds": round(time.time()-start, 2)}
                results.append(r); return r
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                print(f"  Retry {attempt+1}/{MAX_RETRIES}: {e}", file=sys.stderr)
                time.sleep(RETRY_DELAY)
            else:
                r = {"scenario_name": name, "status": "error", "output": "",
                     "error_message": f"Failed after {MAX_RETRIES} attempts: {e}",
                     "duration_seconds": round(time.time()-start, 2)}
                results.append(r); return r

# === SCENARIOS ===

# Scenario 1: Web UI Health Check
print("Testing: web-ui-health", file=sys.stderr)
test_scenario(
    name="web-ui-health",
    description="Verify Vite web UI loads and returns HTML",
    port=5173,
    path="/",
    expected_status=200,
    expected_content="<html",
    timeout=15
)

# Scenario 2: Ingest API Health Check (uses /matters endpoint)
print("Testing: ingest-api-health", file=sys.stderr)
test_scenario(
    name="ingest-api-health",
    description="Verify ingest service is running and responding to /matters",
    port=4500,
    path="/matters",
    expected_status=200,
    timeout=15
)

# Scenario 3: Engine Health Check
print("Testing: engine-health", file=sys.stderr)
test_scenario(
    name="engine-health",
    description="Verify OpenCode engine is running and serving the app shell",
    port=4096,
    path="/",
    expected_status=200,
    timeout=15
)

# === END SCENARIOS ===

print(json.dumps({"results": results}, indent=2))
sys.exit(1 if any(r["status"] in ("fail", "error") for r in results) else 0)
