"""
app.py — Flask Middleware for OS Memory Management Visualizer

Bridges the web frontend to the C engine binary.
Provides a /simulate POST endpoint that:
  1. Validates input
  2. Constructs CLI arguments
  3. Invokes the C engine via subprocess
  4. Returns JSON results

Usage:
    python app.py
    → Runs on http://localhost:5000
"""

import os
import json
import re
import subprocess
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=None)

# Path to the compiled C engine binary
ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine')
ENGINE_BIN = os.path.join(ENGINE_DIR, 'engine')


# ── Static file serving ──────────────────────────────────

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')


@app.route('/')
def serve_index():
    """Serve the main dashboard page."""
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static frontend assets (CSS, JS)."""
    return send_from_directory(FRONTEND_DIR, filename)


# ── Input validation helpers ─────────────────────────────

def validate_int_list(data, key, min_val=None, max_len=256):
    """
    Validate that data[key] is a list of integers.
    Returns (cleaned_list, error_string).
    """
    if key not in data:
        return None, f"Missing required field: {key}"

    raw = data[key]
    if isinstance(raw, str):
        # Accept comma-separated string
        raw = [x.strip() for x in raw.split(',') if x.strip()]

    if not isinstance(raw, list) or len(raw) == 0:
        return None, f"{key} must be a non-empty list"

    if len(raw) > max_len:
        return None, f"{key} exceeds maximum length of {max_len}"

    cleaned = []
    for item in raw:
        try:
            val = int(item)
        except (ValueError, TypeError):
            return None, f"Non-numeric value in {key}: '{item}'"
        if min_val is not None and val < min_val:
            return None, f"Values in {key} must be >= {min_val}"
        cleaned.append(val)

    return cleaned, None


def validate_positive_int(data, key, max_val=None):
    """Validate that data[key] is a positive integer."""
    if key not in data:
        return None, f"Missing required field: {key}"

    try:
        val = int(data[key])
    except (ValueError, TypeError):
        return None, f"{key} must be a positive integer"

    if val <= 0:
        return None, f"{key} must be positive"

    if max_val is not None and val > max_val:
        return None, f"{key} must be <= {max_val}"

    return val, None


# ── Simulate endpoint ────────────────────────────────────

@app.route('/simulate', methods=['POST'])
def simulate():
    """
    POST /simulate
    Accepts JSON body, runs the C engine, and returns results.

    Contiguous mode body:
    {
        "mode": "contiguous",
        "algorithm": "best",
        "holes": [100, 500, 200],
        "requests": [150, 80, 400]
    }

    Paging mode body:
    {
        "mode": "paging",
        "algorithm": "lru",
        "frames": 3,
        "sequence": [1, 2, 1, 3, 4]
    }
    """
    # Check that engine binary exists
    if not os.path.isfile(ENGINE_BIN):
        return jsonify({"error": "Engine binary not found. Run 'make' in the engine/ directory."}), 500

    # Parse request JSON
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400

    mode = data.get('mode', '').strip().lower()
    algo = data.get('algorithm', '').strip().lower()

    # Validate mode
    if mode not in ('contiguous', 'paging'):
        return jsonify({"error": "mode must be 'contiguous' or 'paging'"}), 400

    # Build CLI command
    cmd = [ENGINE_BIN, '--mode', mode, '--algo', algo]

    if mode == 'contiguous':
        # Validate algorithm
        if algo not in ('first', 'best', 'worst'):
            return jsonify({"error": "Algorithm must be 'first', 'best', or 'worst' for contiguous mode"}), 400

        # Validate holes
        holes, err = validate_int_list(data, 'holes', min_val=1, max_len=64)
        if err:
            return jsonify({"error": err}), 400

        # Validate requests (multiple process sizes)
        reqs, err = validate_int_list(data, 'requests', min_val=1, max_len=64)
        if err:
            return jsonify({"error": err}), 400

        cmd += ['--holes', ','.join(str(h) for h in holes)]
        cmd += ['--requests', ','.join(str(r) for r in reqs)]

    elif mode == 'paging':
        # Validate algorithm
        if algo not in ('fifo', 'lru'):
            return jsonify({"error": "Algorithm must be 'fifo' or 'lru' for paging mode"}), 400

        # Validate frames
        frames, err = validate_positive_int(data, 'frames', max_val=32)
        if err:
            return jsonify({"error": err}), 400

        # Validate sequence
        sequence, err = validate_int_list(data, 'sequence', min_val=0, max_len=256)
        if err:
            return jsonify({"error": err}), 400

        cmd += ['--frames', str(frames)]
        cmd += ['--sequence', ','.join(str(p) for p in sequence)]

    # Execute the C engine
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5  # 5-second timeout to prevent hangs
        )
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Engine timed out (5s limit)"}), 500
    except Exception as e:
        return jsonify({"error": f"Failed to run engine: {str(e)}"}), 500

    # Check for engine crashes
    if result.returncode != 0:
        # Try to parse stderr or stdout for a JSON error
        output = result.stdout.strip() or result.stderr.strip()
        try:
            err_json = json.loads(output)
            return jsonify(err_json), 400
        except (json.JSONDecodeError, TypeError):
            return jsonify({"error": f"Engine crashed (exit code {result.returncode}): {output}"}), 500

    # Parse engine JSON output
    try:
        engine_output = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return jsonify({"error": "Engine returned invalid JSON", "raw": result.stdout}), 500

    return jsonify(engine_output)


# ── Entry point ──────────────────────────────────────────

if __name__ == '__main__':
    print("=" * 50)
    print("  OS Memory Management Visualizer")
    print(f"  Engine: {ENGINE_BIN}")
    print(f"  Frontend: {FRONTEND_DIR}")
    print("  Server: http://localhost:5000")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5000, debug=True)
