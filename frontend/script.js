/**
 * script.js — OS Memory Management Visualizer Frontend Logic
 *
 * Handles:
 *   - Tab navigation between Contiguous & Paging panels
 *   - Dynamic process list (add/remove processes)
 *   - Form validation (TC-05 compliance)
 *   - Fetch API calls to Flask backend
 *   - Memory map rendering with per-process colors
 *   - Fragmentation display (internal + external)
 *   - Step-by-step paging visualization with animations
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   Tab Navigation
   ═══════════════════════════════════════════════════════ */

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        panels.forEach(p => {
            p.classList.remove('active');
            if (p.id === `panel-${target}`) p.classList.add('active');
        });
    });
});

/* ═══════════════════════════════════════════════════════
   Utility Functions
   ═══════════════════════════════════════════════════════ */

function parseIntList(str) {
    if (!str || !str.trim()) return null;
    const parts = str.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const nums = [];
    for (const p of parts) {
        if (!/^\d+$/.test(p)) return null;
        const n = parseInt(p, 10);
        if (isNaN(n)) return null;
        nums.push(n);
    }
    return nums.length > 0 ? nums : null;
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('visible'); }
}

function clearError(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.remove('visible'); }
}

function setInvalid(inputId) {
    const el = document.getElementById(inputId);
    if (el) el.classList.add('invalid');
}

function clearInvalid(inputId) {
    const el = document.getElementById(inputId);
    if (el) el.classList.remove('invalid');
}

function statCard(value, label, colorClass) {
    return `<div class="stat-card ${colorClass}">
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
    </div>`;
}

/* Process color palette */
const PROC_COLORS = [
    '#dc2626', '#8b5cf6', '#0ea5e9', '#f43f5e',
    '#f59e0b', '#10b981', '#a78bfa', '#fb7185'
];

function procColor(id) {
    return PROC_COLORS[id % PROC_COLORS.length];
}

/* ═══════════════════════════════════════════════════════
   Dynamic Process List
   ═══════════════════════════════════════════════════════ */

let processCount = 1;

function addProcessRow() {
    const list = document.getElementById('process-list');
    const idx = processCount++;

    const row = document.createElement('div');
    row.className = 'process-row';
    row.dataset.index = idx;
    row.innerHTML = `
        <span class="process-label">P${idx}</span>
        <input type="number" class="process-input" placeholder="Size in KB" min="1" required>
        <button type="button" class="btn-icon btn-remove-process" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;

    list.appendChild(row);
    updateRemoveButtons();

    row.querySelector('.btn-remove-process').addEventListener('click', () => {
        row.remove();
        renumberProcesses();
        updateRemoveButtons();
    });
}

function renumberProcesses() {
    const rows = document.querySelectorAll('#process-list .process-row');
    processCount = rows.length;
    rows.forEach((row, i) => {
        row.dataset.index = i;
        row.querySelector('.process-label').textContent = `P${i}`;
    });
}

function updateRemoveButtons() {
    const rows = document.querySelectorAll('#process-list .process-row');
    rows.forEach((row, i) => {
        const btn = row.querySelector('.btn-remove-process');
        // Show remove button only if there's more than one process
        btn.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
    });
}

function getProcessSizes() {
    const inputs = document.querySelectorAll('#process-list .process-input');
    const sizes = [];
    for (const inp of inputs) {
        const val = parseInt(inp.value, 10);
        if (isNaN(val) || val <= 0) return null;
        sizes.push(val);
    }
    return sizes.length > 0 ? sizes : null;
}

document.getElementById('btn-add-process').addEventListener('click', addProcessRow);

/* ═══════════════════════════════════════════════════════
   Contiguous Memory Allocation
   ═══════════════════════════════════════════════════════ */

const formContig = document.getElementById('form-contiguous');

formContig.addEventListener('submit', async (e) => {
    e.preventDefault();

    clearError('contig-holes-error');
    clearError('contig-requests-error');
    clearInvalid('contig-holes');

    const algo = document.getElementById('contig-algo').value;
    const holesStr = document.getElementById('contig-holes').value;

    const holes = parseIntList(holesStr);
    if (!holes) {
        showError('contig-holes-error', 'Enter comma-separated positive integers (e.g. 100, 500, 200)');
        setInvalid('contig-holes');
        return;
    }
    if (holes.some(h => h <= 0)) {
        showError('contig-holes-error', 'All hole sizes must be positive');
        setInvalid('contig-holes');
        return;
    }

    const requests = getProcessSizes();
    if (!requests) {
        showError('contig-requests-error', 'All process sizes must be positive integers');
        return;
    }

    const btn = document.getElementById('btn-contig-run');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Simulating...';

    try {
        const resp = await fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'contiguous', algorithm: algo, holes, requests })
        });

        const data = await resp.json();

        if (!resp.ok || data.error) {
            renderContigError(data.error || 'Unknown error');
        } else {
            renderContigResult(data);
        }
    } catch (err) {
        renderContigError('Network error: could not reach the server.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Simulation`;
    }
});

/**
 * Render contiguous allocation results with multi-process support.
 */
function renderContigResult(data) {
    const placeholder = document.getElementById('contig-placeholder');
    const result = document.getElementById('contig-result');
    const errorBanner = document.getElementById('contig-error-banner');
    const algoTag = document.getElementById('contig-algo-tag');

    placeholder.classList.add('hidden');
    result.classList.remove('hidden');
    errorBanner.classList.add('hidden');

    const algoNames = { first: 'First Fit', best: 'Best Fit', worst: 'Worst Fit' };
    algoTag.textContent = algoNames[data.algorithm] || data.algorithm;

    // How many allocated vs failed
    const allocated = data.allocations.filter(a => a.allocated);
    const failed = data.allocations.filter(a => !a.allocated);

    // Stats row
    document.getElementById('contig-stats').innerHTML =
        statCard(data.total_memory + 'K', 'Total Memory', 'stat-cyan') +
        statCard(data.total_allocated + 'K', 'Allocated', 'stat-green') +
        statCard(data.total_free + 'K', 'Free', 'stat-amber') +
        statCard(`${allocated.length}/${data.allocations.length}`, 'Processes', failed.length > 0 ? 'stat-red' : 'stat-green');

    // Memory map bar
    renderMemoryMap(data);

    // Allocation table
    renderAllocTable(data);

    // Fragmentation cards
    renderFragmentation(data);

    // Remaining holes
    renderHolesChips(data);

    // Unallocated processes
    renderUnallocated(data);
}

/**
 * Render the memory map bar from the engine's memory_map array.
 */
function renderMemoryMap(data) {
    const bar = document.getElementById('contig-memory-bar');
    const labels = document.getElementById('contig-memory-labels');
    const legend = document.getElementById('contig-legend');
    bar.innerHTML = '';
    labels.innerHTML = '';

    const total = data.total_memory;
    if (total === 0) return;

    data.memory_map.forEach(seg => {
        const pct = (seg.size / total) * 100;
        const block = document.createElement('div');
        block.className = 'mem-block';
        block.style.width = `${Math.max(pct, 2.5)}%`;

        if (seg.type === 'hole') {
            block.classList.add('free');
            block.textContent = `${seg.size}K`;
            block.title = `Free Hole: ${seg.size}K at ${seg.start}K`;
        } else {
            block.classList.add('allocated', `proc-${seg.process_id % 8}`);
            block.textContent = `P${seg.process_id}`;
            block.title = `P${seg.process_id}: ${seg.size}K at ${seg.start}K`;
        }

        block.style.borderRight = '1px solid rgba(255,255,255,0.1)';
        bar.appendChild(block);

        const lbl = document.createElement('div');
        lbl.className = 'mem-label';
        lbl.style.width = `${Math.max(pct, 2.5)}%`;
        lbl.textContent = `${seg.start}K`;
        labels.appendChild(lbl);
    });

    // Legend
    const procIds = data.memory_map.filter(s => s.type === 'process').map(s => s.process_id);
    const uniqueProcs = [...new Set(procIds)];
    let legendHTML = '<div class="legend-item"><div class="legend-swatch free"></div>Free Hole</div>';
    uniqueProcs.forEach(pid => {
        legendHTML += `<div class="legend-item"><div class="legend-swatch" style="background:${procColor(pid)}"></div>P${pid}</div>`;
    });
    legend.innerHTML = legendHTML;
}

/**
 * Render the allocation details table.
 */
function renderAllocTable(data) {
    const tbody = document.getElementById('contig-alloc-body');
    tbody.innerHTML = '';

    data.allocations.forEach(a => {
        const tr = document.createElement('tr');
        if (a.allocated) {
            tr.innerHTML = `
                <td class="page-cell">P${a.process_id}</td>
                <td>${a.size}K</td>
                <td><span class="status-badge success">Allocated</span></td>
                <td class="frame-cell">${a.address}K</td>
                <td>${a.hole_used}K</td>
                <td class="replaced-cell">${a.leftover}K</td>
            `;
        } else {
            tr.innerHTML = `
                <td class="page-cell">P${a.process_id}</td>
                <td>${a.size}K</td>
                <td><span class="status-badge failed">Failed</span></td>
                <td class="empty-frame">—</td>
                <td class="empty-frame">—</td>
                <td class="empty-frame">—</td>
            `;
        }
        tbody.appendChild(tr);
    });
}

/**
 * Render internal and external fragmentation cards.
 */
function renderFragmentation(data) {
    const row = document.getElementById('contig-frag-row');
    row.innerHTML = `
        <div class="frag-card internal">
            <div class="frag-header">
                <div class="frag-icon"></div>
                <div class="frag-title">Internal Fragmentation</div>
            </div>
            <div class="frag-value">${data.internal_fragmentation}K</div>
            <div class="frag-desc">Sum of leftover space from each allocation (hole splits)</div>
        </div>
        <div class="frag-card external">
            <div class="frag-header">
                <div class="frag-icon"></div>
                <div class="frag-title">External Fragmentation</div>
            </div>
            <div class="frag-value">${data.external_fragmentation}K</div>
            <div class="frag-desc">${data.num_unallocated > 0
                ? `Free memory that exists but can't serve ${data.num_unallocated} unallocated process(es)`
                : 'No external fragmentation — all processes allocated successfully'}</div>
        </div>
    `;
}

/**
 * Render remaining memory holes as chips.
 */
function renderHolesChips(data) {
    const container = document.getElementById('contig-holes-chips');
    if (data.holes_remaining.length === 0) {
        container.innerHTML = '<span style="color:var(--text-dim);font-size:0.8rem;">No free holes remaining</span>';
        return;
    }
    container.innerHTML = data.holes_remaining.map(h =>
        `<span class="chip chip-hole"><span class="chip-dot"></span>${h.size}K @ ${h.start}K</span>`
    ).join('');
}

/**
 * Render unallocated processes.
 */
function renderUnallocated(data) {
    const section = document.getElementById('contig-unalloc-section');
    const container = document.getElementById('contig-unalloc-chips');

    if (data.unallocated.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    container.innerHTML = data.unallocated.map(u =>
        `<span class="chip chip-unalloc"><span class="chip-dot"></span>P${u.process_id} (${u.size}K)</span>`
    ).join('');
}

/**
 * Render contiguous error state.
 */
function renderContigError(msg) {
    const placeholder = document.getElementById('contig-placeholder');
    const result = document.getElementById('contig-result');
    const errorBanner = document.getElementById('contig-error-banner');

    placeholder.classList.add('hidden');
    result.classList.remove('hidden');

    document.getElementById('contig-stats').innerHTML = statCard('ERROR', 'Status', 'stat-red');
    errorBanner.textContent = `⚠ ${msg}`;
    errorBanner.classList.remove('hidden');

    document.getElementById('contig-memory-bar').innerHTML = '';
    document.getElementById('contig-memory-labels').innerHTML = '';
    document.getElementById('contig-legend').innerHTML = '';
    document.getElementById('contig-alloc-body').innerHTML = '';
    document.getElementById('contig-frag-row').innerHTML = '';
    document.getElementById('contig-holes-chips').innerHTML = '';
    document.getElementById('contig-unalloc-section').classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════
   Page Replacement Simulation
   ═══════════════════════════════════════════════════════ */

let pagingData = null;
let currentStep = 0;

const formPaging = document.getElementById('form-paging');

formPaging.addEventListener('submit', async (e) => {
    e.preventDefault();

    clearError('paging-frames-error');
    clearError('paging-sequence-error');
    clearInvalid('paging-frames');
    clearInvalid('paging-sequence');

    const algo = document.getElementById('paging-algo').value;
    const framesVal = document.getElementById('paging-frames').value;
    const seqStr = document.getElementById('paging-sequence').value;

    const frames = parseInt(framesVal, 10);
    if (isNaN(frames) || frames <= 0) {
        showError('paging-frames-error', 'Enter a positive integer for frames');
        setInvalid('paging-frames');
        return;
    }
    if (frames > 32) {
        showError('paging-frames-error', 'Maximum 32 frames allowed');
        setInvalid('paging-frames');
        return;
    }

    const sequence = parseIntList(seqStr);
    if (!sequence) {
        showError('paging-sequence-error', 'Enter comma-separated non-negative integers (e.g. 1, 2, 3)');
        setInvalid('paging-sequence');
        return;
    }

    const btn = document.getElementById('btn-paging-run');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Simulating...';

    try {
        const resp = await fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'paging', algorithm: algo, frames, sequence })
        });

        const data = await resp.json();

        if (!resp.ok || data.error) {
            renderPagingError(data.error || 'Unknown error');
        } else {
            pagingData = data;
            currentStep = 0;
            renderPagingResult(data);
        }
    } catch (err) {
        renderPagingError('Network error: could not reach the server.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Simulation`;
    }
});

function renderPagingResult(data) {
    const placeholder = document.getElementById('paging-placeholder');
    const result = document.getElementById('paging-result');

    placeholder.classList.add('hidden');
    result.classList.remove('hidden');
    document.getElementById('paging-step-controls').classList.remove('hidden');

    const algoTag = document.getElementById('paging-algo-tag');
    const algoNames = { fifo: 'FIFO', lru: 'LRU' };
    algoTag.textContent = algoNames[data.algorithm] || data.algorithm;

    document.getElementById('paging-stats').innerHTML =
        statCard(data.total_faults, 'Page Faults', 'stat-red') +
        statCard(data.total_hits, 'Page Hits', 'stat-green') +
        statCard(data.steps.length, 'Total Steps', 'stat-cyan') +
        statCard(data.num_frames, 'Frames', 'stat-accent');

    renderFramesVisual(data.num_frames, null);
    buildPagingTable(data);

    currentStep = 0;
    updateStepIndicator();
    hideAllStepRows();
}

function renderFramesVisual(numFrames, stepData) {
    const container = document.getElementById('paging-frames-visual');
    container.innerHTML = '';

    for (let f = 0; f < numFrames; f++) {
        const slot = document.createElement('div');
        slot.className = 'frame-slot';

        const label = document.createElement('div');
        label.className = 'frame-label';
        label.textContent = `F${f}`;

        const box = document.createElement('div');
        box.className = 'frame-box';
        box.id = `frame-box-${f}`;

        if (stepData && stepData.frames[f] !== -1) {
            box.classList.add('occupied');
            box.textContent = stepData.frames[f];
        } else {
            box.textContent = '—';
        }

        slot.appendChild(label);
        slot.appendChild(box);
        container.appendChild(slot);
    }
}

function updateFrames(stepData, prevFrames) {
    if (!pagingData) return;
    for (let f = 0; f < pagingData.num_frames; f++) {
        const box = document.getElementById(`frame-box-${f}`);
        if (!box) continue;
        const val = stepData.frames[f];
        const prevVal = prevFrames ? prevFrames[f] : -1;
        box.classList.remove('fault', 'hit');
        if (val !== -1) {
            box.classList.add('occupied');
            box.textContent = val;
            if (val !== prevVal) box.classList.add('fault');
            else if (val === stepData.page && !stepData.fault) box.classList.add('hit');
        } else {
            box.classList.remove('occupied');
            box.textContent = '—';
        }
    }
}

function buildPagingTable(data) {
    const thead = document.getElementById('paging-table-head');
    const tbody = document.getElementById('paging-table-body');

    let headerHTML = '<tr><th>Step</th><th>Page</th>';
    for (let f = 0; f < data.num_frames; f++) headerHTML += `<th>Frame ${f}</th>`;
    headerHTML += '<th>Result</th><th>Replaced</th></tr>';
    thead.innerHTML = headerHTML;

    tbody.innerHTML = '';
    data.steps.forEach((step, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'hidden-step';
        tr.id = `step-row-${idx}`;

        let cells = `<td>${idx + 1}</td><td class="page-cell">${step.page}</td>`;
        for (let f = 0; f < data.num_frames; f++) {
            const val = step.frames[f];
            cells += val === -1
                ? `<td class="frame-cell empty-frame">—</td>`
                : `<td class="frame-cell">${val}</td>`;
        }
        cells += step.fault
            ? `<td class="fault-cell">✗ Fault</td>`
            : `<td class="hit-cell">✓ Hit</td>`;
        cells += `<td class="replaced-cell">${step.replaced !== null ? 'Page ' + step.replaced : '—'}</td>`;

        tr.innerHTML = cells;
        tbody.appendChild(tr);
    });
}

function hideAllStepRows() {
    if (!pagingData) return;
    for (let i = 0; i < pagingData.steps.length; i++) {
        const row = document.getElementById(`step-row-${i}`);
        if (row) row.className = 'hidden-step';
    }
}

function showStepsUpTo(stepNum) {
    if (!pagingData) return;
    for (let i = 0; i < pagingData.steps.length; i++) {
        const row = document.getElementById(`step-row-${i}`);
        if (!row) continue;
        if (i < stepNum) {
            row.className = (i === stepNum - 1) ? 'active-step reveal-step' : '';
        } else {
            row.className = 'hidden-step';
        }
    }
}

function updateStepIndicator() {
    const el = document.getElementById('step-indicator');
    if (!pagingData) return;
    el.textContent = `Step ${currentStep} / ${pagingData.steps.length}`;
    document.getElementById('btn-step-next').disabled = (currentStep >= pagingData.steps.length);
}

document.getElementById('btn-step-next').addEventListener('click', () => {
    if (!pagingData || currentStep >= pagingData.steps.length) return;
    const prevFrames = currentStep > 0 ? pagingData.steps[currentStep - 1].frames : null;
    currentStep++;
    const stepData = pagingData.steps[currentStep - 1];
    showStepsUpTo(currentStep);
    updateFrames(stepData, prevFrames);
    updateStepIndicator();
    const row = document.getElementById(`step-row-${currentStep - 1}`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

document.getElementById('btn-step-reset').addEventListener('click', () => {
    if (!pagingData) return;
    currentStep = 0;
    hideAllStepRows();
    renderFramesVisual(pagingData.num_frames, null);
    updateStepIndicator();
});

document.getElementById('btn-step-all').addEventListener('click', () => {
    if (!pagingData) return;
    currentStep = pagingData.steps.length;
    const lastStep = pagingData.steps[currentStep - 1];
    for (let i = 0; i < pagingData.steps.length; i++) {
        const row = document.getElementById(`step-row-${i}`);
        if (row) row.className = (i === currentStep - 1) ? 'active-step' : '';
    }
    const prevFrames = currentStep > 1 ? pagingData.steps[currentStep - 2].frames : null;
    updateFrames(lastStep, prevFrames);
    updateStepIndicator();
});

function renderPagingError(msg) {
    const placeholder = document.getElementById('paging-placeholder');
    const result = document.getElementById('paging-result');

    placeholder.classList.add('hidden');
    result.classList.remove('hidden');

    document.getElementById('paging-stats').innerHTML = statCard('ERROR', 'Status', 'stat-red');
    document.getElementById('paging-frames-visual').innerHTML = `<div class="error-banner">${msg}</div>`;
    document.getElementById('paging-table-head').innerHTML = '';
    document.getElementById('paging-table-body').innerHTML = '';
    document.getElementById('paging-step-controls').classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════
   Input Field Validation — Real-time Feedback
   ═══════════════════════════════════════════════════════ */

['contig-holes', 'paging-frames', 'paging-sequence'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', () => {
            clearInvalid(id);
            clearError(id + '-error');
        });
    }
});
