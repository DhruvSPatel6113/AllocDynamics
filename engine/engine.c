/*
 * engine.c — OS Memory Management Simulation Engine
 *
 * Two modes of operation:
 *   1. Contiguous Memory Allocation (First Fit, Best Fit, Worst Fit)
 *      - Supports multiple process allocation requests
 *      - Tracks internal/external fragmentation
 *      - Outputs full memory map with segment details
 *   2. Page Replacement Simulation (FIFO, LRU)
 *
 * Input:  Command-line arguments
 * Output: JSON to stdout
 *
 * Usage:
 *   ./engine --mode contiguous --algo best --holes 100,500,200 --requests 150,80
 *   ./engine --mode paging     --algo lru  --frames 3 --sequence 7,0,1,2
 *
 * Build: make          (see Makefile)
 * Test:  make test
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <getopt.h>
#include <ctype.h>

/* ──────────── Constants ──────────── */
#define MAX_HOLES      64
#define MAX_SEGMENTS   256   /* max memory segments (holes + allocated blocks) */
#define MAX_REQUESTS   64    /* max process allocation requests */
#define MAX_SEQUENCE   256
#define MAX_FRAMES     32

/* ──────────── Enums ──────────── */
typedef enum { MODE_NONE, MODE_CONTIGUOUS, MODE_PAGING } Mode;
typedef enum { ALGO_NONE, ALGO_FIRST, ALGO_BEST, ALGO_WORST, ALGO_FIFO, ALGO_LRU } Algorithm;

/* ──────────── Data structures for contiguous allocation ──────────── */

/*
 * Segment — Represents a contiguous region of memory.
 * Can be either a free hole or an allocated process block.
 */
typedef struct {
    int start;      /* starting address (KB) */
    int size;       /* size of this segment (KB) */
    int is_free;    /* 1 = free hole, 0 = allocated to a process */
    int proc_id;    /* process ID if allocated, -1 if free */
} Segment;

/*
 * AllocationResult — Result of allocating a single process.
 */
typedef struct {
    int proc_id;      /* process ID */
    int size;         /* requested size */
    int allocated;    /* 1 = success, 0 = failed */
    int address;      /* starting address if allocated, -1 otherwise */
    int hole_used;    /* size of the hole that was used */
    int leftover;     /* remaining space in hole after allocation */
} AllocResult;

/* ──────────── Helpers: input parsing ──────────── */

/*
 * parse_int_list — Parse a comma-separated string of integers into an array.
 * Returns the count of parsed integers, or -1 on error.
 */
static int parse_int_list(const char *str, int *out, int max_count) {
    int count = 0;
    const char *p = str;

    while (*p && count < max_count) {
        while (*p == ' ') p++;
        if (!isdigit((unsigned char)*p) && *p != '-') return -1;

        char *end;
        long val = strtol(p, &end, 10);
        if (end == p) return -1;
        out[count++] = (int)val;

        p = end;
        while (*p == ' ') p++;
        if (*p == ',') { p++; continue; }
        if (*p == '\0') break;
        return -1;
    }
    return count;
}

static int validate_positive(const int *arr, int n) {
    for (int i = 0; i < n; i++) {
        if (arr[i] <= 0) return 0;
    }
    return 1;
}

/* ──────────── JSON output helpers ──────────── */

static void json_int_array(const int *arr, int n) {
    putchar('[');
    for (int i = 0; i < n; i++) {
        if (i > 0) putchar(',');
        printf("%d", arr[i]);
    }
    putchar(']');
}

static void json_error(const char *msg) {
    printf("{\"error\":\"%s\"}\n", msg);
}

/* ══════════════════════════════════════════════════
 * Module A: Contiguous Memory Allocation
 *   - Multiple process requests
 *   - Segment-based memory map
 *   - Fragmentation tracking
 * ══════════════════════════════════════════════════ */

/* Global memory map */
static Segment segments[MAX_SEGMENTS];
static int num_segments = 0;

/*
 * init_segments — Initialize the memory map from an array of hole sizes.
 * Holes are laid out sequentially: hole[0] at addr 0, hole[1] after hole[0], etc.
 */
static void init_segments(const int *holes, int num_holes) {
    int addr = 0;
    for (int i = 0; i < num_holes; i++) {
        segments[i].start   = addr;
        segments[i].size    = holes[i];
        segments[i].is_free = 1;
        segments[i].proc_id = -1;
        addr += holes[i];
    }
    num_segments = num_holes;
}

/*
 * insert_segment_after — Insert a new segment after index `pos`.
 * Shifts all subsequent segments right.
 */
static void insert_segment_after(int pos, Segment seg) {
    for (int i = num_segments; i > pos + 1; i--) {
        segments[i] = segments[i - 1];
    }
    segments[pos + 1] = seg;
    num_segments++;
}

/*
 * find_hole — Find a free hole that fits `size` using the given algorithm.
 * Returns the segment index, or -1 if none found.
 */
static int find_hole(Algorithm algo, int size) {
    int chosen = -1;

    switch (algo) {
        case ALGO_FIRST:
            for (int i = 0; i < num_segments; i++) {
                if (segments[i].is_free && segments[i].size >= size) {
                    chosen = i;
                    break;
                }
            }
            break;

        case ALGO_BEST: {
            int best = __INT_MAX__;
            for (int i = 0; i < num_segments; i++) {
                if (segments[i].is_free && segments[i].size >= size && segments[i].size < best) {
                    best = segments[i].size;
                    chosen = i;
                }
            }
            break;
        }

        case ALGO_WORST: {
            int worst = -1;
            for (int i = 0; i < num_segments; i++) {
                if (segments[i].is_free && segments[i].size >= size && segments[i].size > worst) {
                    worst = segments[i].size;
                    chosen = i;
                }
            }
            break;
        }

        default:
            break;
    }

    return chosen;
}

/*
 * allocate_process — Allocate a process into the memory map.
 * Splits the chosen hole into [allocated_block | leftover_hole].
 * Returns the AllocResult.
 */
static AllocResult allocate_process(Algorithm algo, int proc_id, int size) {
    AllocResult res;
    res.proc_id   = proc_id;
    res.size      = size;
    res.allocated = 0;
    res.address   = -1;
    res.hole_used = 0;
    res.leftover  = 0;

    int idx = find_hole(algo, size);
    if (idx == -1) {
        return res;  /* allocation failed */
    }

    int hole_size = segments[idx].size;
    int leftover  = hole_size - size;

    /* Mark this segment as allocated */
    segments[idx].size    = size;
    segments[idx].is_free = 0;
    segments[idx].proc_id = proc_id;

    /* If there's leftover, insert a new free segment after it */
    if (leftover > 0) {
        Segment new_hole;
        new_hole.start   = segments[idx].start + size;
        new_hole.size    = leftover;
        new_hole.is_free = 1;
        new_hole.proc_id = -1;
        insert_segment_after(idx, new_hole);
    }

    res.allocated = 1;
    res.address   = segments[idx].start;
    res.hole_used = hole_size;
    res.leftover  = leftover;
    return res;
}

/*
 * simulate_contiguous — Run multiple process allocations and output full JSON.
 */
static void simulate_contiguous(Algorithm algo, const int *holes, int num_holes,
                                  const int *requests, int num_requests) {
    /* Initialize memory map from holes */
    init_segments(holes, num_holes);

    /* Perform allocations */
    AllocResult results[MAX_REQUESTS];
    int total_internal_frag = 0;

    for (int i = 0; i < num_requests; i++) {
        results[i] = allocate_process(algo, i, requests[i]);
        if (results[i].allocated) {
            total_internal_frag += results[i].leftover;
        }
    }

    /* Compute statistics */
    int total_memory = 0;
    for (int i = 0; i < num_holes; i++) total_memory += holes[i];

    int total_allocated = 0;
    int total_free = 0;
    int num_remaining_holes = 0;

    for (int i = 0; i < num_segments; i++) {
        if (segments[i].is_free) {
            total_free += segments[i].size;
            num_remaining_holes++;
        } else {
            total_allocated += segments[i].size;
        }
    }

    /* Count unallocated processes and their total demand */
    int num_unallocated = 0;
    int unallocated_demand = 0;
    for (int i = 0; i < num_requests; i++) {
        if (!results[i].allocated) {
            num_unallocated++;
            unallocated_demand += requests[i];
        }
    }

    /* External fragmentation = total free memory that exists but can't serve requests */
    int external_frag = (num_unallocated > 0) ? total_free : 0;

    const char *algo_name = (algo == ALGO_FIRST) ? "first" :
                            (algo == ALGO_BEST)  ? "best"  : "worst";

    /* ── Build JSON output ── */
    printf("{");
    printf("\"mode\":\"contiguous\",");
    printf("\"algorithm\":\"%s\",", algo_name);
    printf("\"total_memory\":%d,", total_memory);

    /* Initial holes */
    printf("\"holes_initial\":");
    json_int_array(holes, num_holes);

    /* Allocation results */
    printf(",\"allocations\":[");
    for (int i = 0; i < num_requests; i++) {
        if (i > 0) putchar(',');
        printf("{\"process_id\":%d,\"size\":%d,", results[i].proc_id, results[i].size);
        if (results[i].allocated) {
            printf("\"allocated\":true,\"address\":%d,\"hole_used\":%d,\"leftover\":%d}",
                   results[i].address, results[i].hole_used, results[i].leftover);
        } else {
            printf("\"allocated\":false,\"address\":null,\"hole_used\":null,\"leftover\":null}");
        }
    }
    printf("]");

    /* Unallocated processes */
    printf(",\"unallocated\":[");
    {
        int first = 1;
        for (int i = 0; i < num_requests; i++) {
            if (!results[i].allocated) {
                if (!first) putchar(',');
                printf("{\"process_id\":%d,\"size\":%d}", results[i].proc_id, results[i].size);
                first = 0;
            }
        }
    }
    printf("]");

    /* Memory map — full segment list */
    printf(",\"memory_map\":[");
    for (int i = 0; i < num_segments; i++) {
        if (i > 0) putchar(',');
        printf("{\"start\":%d,\"size\":%d,", segments[i].start, segments[i].size);
        if (segments[i].is_free) {
            printf("\"type\":\"hole\",\"process_id\":null}");
        } else {
            printf("\"type\":\"process\",\"process_id\":%d}", segments[i].proc_id);
        }
    }
    printf("]");

    /* Remaining holes */
    printf(",\"holes_remaining\":[");
    {
        int first = 1;
        for (int i = 0; i < num_segments; i++) {
            if (segments[i].is_free) {
                if (!first) putchar(',');
                printf("{\"start\":%d,\"size\":%d}", segments[i].start, segments[i].size);
                first = 0;
            }
        }
    }
    printf("]");

    /* Fragmentation stats */
    printf(",\"total_allocated\":%d", total_allocated);
    printf(",\"total_free\":%d", total_free);
    printf(",\"internal_fragmentation\":%d", total_internal_frag);
    printf(",\"external_fragmentation\":%d", external_frag);
    printf(",\"num_unallocated\":%d", num_unallocated);
    printf(",\"unallocated_demand\":%d", unallocated_demand);

    printf("}\n");
}

/* ══════════════════════════════════════════════════
 * Module B: Page Replacement Simulation
 * ══════════════════════════════════════════════════ */

static void simulate_paging_fifo(int num_frames, int *sequence, int seq_len) {
    int frames[MAX_FRAMES];
    int load_order[MAX_FRAMES];
    int frame_count = 0;
    int total_faults = 0;
    int total_hits = 0;

    for (int i = 0; i < num_frames; i++) {
        frames[i] = -1;
        load_order[i] = -1;
    }

    printf("{");
    printf("\"mode\":\"paging\",");
    printf("\"algorithm\":\"fifo\",");
    printf("\"num_frames\":%d,", num_frames);
    printf("\"sequence\":");
    json_int_array(sequence, seq_len);
    printf(",\"steps\":[");

    for (int step = 0; step < seq_len; step++) {
        int page = sequence[step];
        int found = 0;

        for (int f = 0; f < num_frames; f++) {
            if (frames[f] == page) { found = 1; break; }
        }

        int replaced = -1;
        int is_fault = !found;

        if (found) {
            total_hits++;
        } else {
            total_faults++;
            if (frame_count < num_frames) {
                frames[frame_count] = page;
                load_order[frame_count] = step;
                frame_count++;
            } else {
                int oldest_idx = 0;
                for (int f = 1; f < num_frames; f++) {
                    if (load_order[f] < load_order[oldest_idx])
                        oldest_idx = f;
                }
                replaced = frames[oldest_idx];
                frames[oldest_idx] = page;
                load_order[oldest_idx] = step;
            }
        }

        if (step > 0) putchar(',');
        printf("{\"page\":%d,\"frames\":", page);
        json_int_array(frames, num_frames);
        printf(",\"fault\":%s", is_fault ? "true" : "false");
        if (replaced != -1)
            printf(",\"replaced\":%d", replaced);
        else
            printf(",\"replaced\":null");
        printf("}");
    }

    printf("],\"total_faults\":%d,\"total_hits\":%d}\n", total_faults, total_hits);
}

static void simulate_paging_lru(int num_frames, int *sequence, int seq_len) {
    int frames[MAX_FRAMES];
    int last_used[MAX_FRAMES];
    int frame_count = 0;
    int total_faults = 0;
    int total_hits = 0;

    for (int i = 0; i < num_frames; i++) {
        frames[i] = -1;
        last_used[i] = -1;
    }

    printf("{");
    printf("\"mode\":\"paging\",");
    printf("\"algorithm\":\"lru\",");
    printf("\"num_frames\":%d,", num_frames);
    printf("\"sequence\":");
    json_int_array(sequence, seq_len);
    printf(",\"steps\":[");

    for (int step = 0; step < seq_len; step++) {
        int page = sequence[step];
        int found = -1;

        for (int f = 0; f < num_frames; f++) {
            if (frames[f] == page) { found = f; break; }
        }

        int replaced = -1;
        int is_fault = (found == -1);

        if (found != -1) {
            total_hits++;
            last_used[found] = step;
        } else {
            total_faults++;
            if (frame_count < num_frames) {
                frames[frame_count] = page;
                last_used[frame_count] = step;
                frame_count++;
            } else {
                int lru_idx = 0;
                for (int f = 1; f < num_frames; f++) {
                    if (last_used[f] < last_used[lru_idx])
                        lru_idx = f;
                }
                replaced = frames[lru_idx];
                frames[lru_idx] = page;
                last_used[lru_idx] = step;
            }
        }

        if (step > 0) putchar(',');
        printf("{\"page\":%d,\"frames\":", page);
        json_int_array(frames, num_frames);
        printf(",\"fault\":%s", is_fault ? "true" : "false");
        if (replaced != -1)
            printf(",\"replaced\":%d", replaced);
        else
            printf(",\"replaced\":null");
        printf("}");
    }

    printf("],\"total_faults\":%d,\"total_hits\":%d}\n", total_faults, total_hits);
}

/* ──────────── Main ──────────── */

static void print_usage(const char *prog) {
    fprintf(stderr,
        "Usage:\n"
        "  %s --mode contiguous --algo first|best|worst --holes H1,H2,... --requests R1,R2,...\n"
        "  %s --mode paging     --algo fifo|lru         --frames N --sequence P1,P2,...\n",
        prog, prog);
}

int main(int argc, char *argv[]) {
    Mode mode = MODE_NONE;
    Algorithm algo = ALGO_NONE;
    int holes[MAX_HOLES], num_holes = 0;
    int sequence[MAX_SEQUENCE], seq_len = 0;
    int requests[MAX_REQUESTS], num_requests = 0;
    int num_frames = 0;

    static struct option long_options[] = {
        {"mode",     required_argument, 0, 'm'},
        {"algo",     required_argument, 0, 'a'},
        {"holes",    required_argument, 0, 'h'},
        {"requests", required_argument, 0, 'r'},
        {"frames",   required_argument, 0, 'f'},
        {"sequence", required_argument, 0, 's'},
        {"help",     no_argument,       0, '?'},
        {0, 0, 0, 0}
    };

    int opt;
    while ((opt = getopt_long(argc, argv, "m:a:h:r:f:s:", long_options, NULL)) != -1) {
        switch (opt) {
            case 'm':
                if (strcmp(optarg, "contiguous") == 0)      mode = MODE_CONTIGUOUS;
                else if (strcmp(optarg, "paging") == 0)      mode = MODE_PAGING;
                else { json_error("Unknown mode"); return 1; }
                break;

            case 'a':
                if (strcmp(optarg, "first") == 0)       algo = ALGO_FIRST;
                else if (strcmp(optarg, "best") == 0)   algo = ALGO_BEST;
                else if (strcmp(optarg, "worst") == 0)  algo = ALGO_WORST;
                else if (strcmp(optarg, "fifo") == 0)   algo = ALGO_FIFO;
                else if (strcmp(optarg, "lru") == 0)    algo = ALGO_LRU;
                else { json_error("Unknown algorithm"); return 1; }
                break;

            case 'h':
                num_holes = parse_int_list(optarg, holes, MAX_HOLES);
                if (num_holes <= 0) { json_error("Invalid holes list"); return 1; }
                if (!validate_positive(holes, num_holes)) {
                    json_error("Hole sizes must be positive");
                    return 1;
                }
                break;

            case 'r':
                num_requests = parse_int_list(optarg, requests, MAX_REQUESTS);
                if (num_requests <= 0) { json_error("Invalid requests list"); return 1; }
                if (!validate_positive(requests, num_requests)) {
                    json_error("Request sizes must be positive");
                    return 1;
                }
                break;

            case 'f':
                num_frames = atoi(optarg);
                if (num_frames <= 0 || num_frames > MAX_FRAMES) {
                    json_error("Frames must be between 1 and 32");
                    return 1;
                }
                break;

            case 's':
                seq_len = parse_int_list(optarg, sequence, MAX_SEQUENCE);
                if (seq_len <= 0) { json_error("Invalid page sequence"); return 1; }
                break;

            default:
                print_usage(argv[0]);
                return 1;
        }
    }

    if (mode == MODE_NONE) {
        json_error("--mode is required (contiguous or paging)");
        return 1;
    }

    if (mode == MODE_CONTIGUOUS) {
        if (algo != ALGO_FIRST && algo != ALGO_BEST && algo != ALGO_WORST) {
            json_error("Contiguous mode requires --algo first|best|worst");
            return 1;
        }
        if (num_holes == 0)    { json_error("--holes is required for contiguous mode"); return 1; }
        if (num_requests == 0) { json_error("--requests is required for contiguous mode"); return 1; }

        simulate_contiguous(algo, holes, num_holes, requests, num_requests);

    } else if (mode == MODE_PAGING) {
        if (algo != ALGO_FIFO && algo != ALGO_LRU) {
            json_error("Paging mode requires --algo fifo|lru");
            return 1;
        }
        if (num_frames == 0) { json_error("--frames is required for paging mode"); return 1; }
        if (seq_len == 0)    { json_error("--sequence is required for paging mode"); return 1; }

        if (algo == ALGO_FIFO) {
            simulate_paging_fifo(num_frames, sequence, seq_len);
        } else {
            simulate_paging_lru(num_frames, sequence, seq_len);
        }
    }

    return 0;
}
