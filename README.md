# Alloc Dynamics

A full-stack simulation tool for OS memory management concepts, featuring a high-performance **C engine**, a **Python Flask** middleware, and a **web-based dashboard** with real-time animated visualizations.
`
## Architecture

```
┌──────────────────┐     HTTP/JSON     ┌──────────────────┐     subprocess     ┌──────────────────┐
│   Web Frontend   │ ◄──────────────► │   Flask Bridge   │ ◄──────────────► │    C Engine      │
│   (HTML/CSS/JS)  │                   │   (app.py)       │                   │   (engine.c)     │
└──────────────────┘                   └──────────────────┘                   └──────────────────┘
```

## Features

### Contiguous Memory Allocation
- **Algorithms**: First Fit, Best Fit, Worst Fit
- **Visualization**: Color-coded memory bar showing free/allocated/leftover partitions
- **Error Handling**: Detects and reports External Fragmentation

### Page Replacement Simulation
- **Algorithms**: FIFO (First-In-First-Out), LRU (Least Recently Used)
- **Step-by-Step Mode**: Walk through the simulation one page at a time
- **Tracking**: Page Faults vs Page Hits with animated frame boxes

## Quick Start

### Prerequisites
- GCC (C compiler)
- Python 3.8+
- pip

## Directly use on web **https://dhruvspatel6113.github.io/AllocDynamics/**

## Run Locally

### 1. Build the C Engine
```bash
cd engine
make
```

### 2. Install Python Dependencies
```bash
cd server
pip install -r requirements.txt
```

### 3. Start the Server
```bash
cd server
python app.py
```

Open your browser to **http://localhost:5000**

## Test Cases

Run the built-in test suite for the C engine:
```bash
cd engine
make test
```

| ID    | Feature    | Input                                        | Expected Result                          |
|-------|-----------|----------------------------------------------|------------------------------------------|
| TC-01 | Best Fit  | Holes: 100K, 500K, 200K. Request: 150K      | Allocated in 200K hole, leftover = 50K   |
| TC-02 | Worst Fit | Holes: 100K, 500K, 200K. Request: 150K      | Allocated in 500K hole, leftover = 350K  |
| TC-03 | FIFO      | Frames: 3, Sequence: 1,2,3,4,1              | Page 4 replaces Page 1                   |
| TC-04 | LRU       | Frames: 3, Sequence: 1,2,1,3,4              | Page 4 replaces Page 2                   |
| TC-05 | Security  | Invalid/non-numeric input                    | Returns JSON error, no crash             |

## C Engine CLI Usage

```bash
# Contiguous allocation
./engine --mode contiguous --algo best --holes 100,500,200 --request 150

# Page replacement
./engine --mode paging --algo lru --frames 3 --sequence 1,2,1,3,4
```

## Project Structure

```
OS_cp/
├── engine/
│   ├── engine.c      # Core C simulation engine
│   └── Makefile       # Build system with test targets
├── server/
│   ├── app.py         # Flask middleware
│   └── requirements.txt
├── frontend/
│   ├── index.html     # Dashboard layout
│   ├── style.css      # Dark theme with animations
│   └── script.js      # Fetch API + visualization logic
└── README.md
```

## License

Educational project — OS Memory Management simulation.
