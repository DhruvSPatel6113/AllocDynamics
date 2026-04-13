# Makefile for OS Memory Management Engine
# Usage:
#   make          — Build the engine binary
#   make clean    — Remove build artifacts
#   make test     — Run mandatory test cases (TC-01 through TC-05)

CC      = gcc
CFLAGS  = -Wall -Wextra -O2 -std=c99
TARGET  = engine
SRC     = engine.c

.PHONY: all clean test

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $@ $<

clean:
	rm -f $(TARGET)

# ── Mandatory Test Cases ──────────────────────────────────

test: $(TARGET)
	@echo "═══════════════════════════════════════════════"
	@echo "  Running Mandatory Test Cases (TC-01 → TC-05)"
	@echo "═══════════════════════════════════════════════"
	@echo ""
	@echo "── TC-01: Best Fit ──"
	@echo "   Holes: 100, 500, 200 | Request: 150"
	@echo "   Expected: Allocated in 200K hole, leftover = 50"
	@./$(TARGET) --mode contiguous --algo best --holes 100,500,200 --requests 150
	@echo ""
	@echo "── TC-02: Worst Fit ──"
	@echo "   Holes: 100, 500, 200 | Request: 150"
	@echo "   Expected: Allocated in 500K hole, leftover = 350"
	@./$(TARGET) --mode contiguous --algo worst --holes 100,500,200 --requests 150
	@echo ""
	@echo "── TC-03: FIFO Paging ──"
	@echo "   Frames: 3 | Sequence: 1,2,3,4,1"
	@echo "   Expected: Page 4 replaces Page 1"
	@./$(TARGET) --mode paging --algo fifo --frames 3 --sequence 1,2,3,4,1
	@echo ""
	@echo "── TC-04: LRU Paging ──"
	@echo "   Frames: 3 | Sequence: 1,2,1,3,4"
	@echo "   Expected: Page 4 replaces Page 2 (1 was used recently)"
	@./$(TARGET) --mode paging --algo lru --frames 3 --sequence 1,2,1,3,4
	@echo ""
	@echo "── TC-05: Invalid Input ──"
	@echo "   Sending non-numeric holes — should return JSON error"
	@./$(TARGET) --mode contiguous --algo best --holes abc,xyz --requests 150 || true
	@echo ""
	@echo "── TC-06: Multiple Processes (Best Fit) ──"
	@echo "   Holes: 100, 500, 200 | Requests: 150, 80, 400"
	@./$(TARGET) --mode contiguous --algo best --holes 100,500,200 --requests 150,80,400
	@echo ""
	@echo "═══════════════════════════════════════════════"
	@echo "  All tests complete."
	@echo "═══════════════════════════════════════════════"
