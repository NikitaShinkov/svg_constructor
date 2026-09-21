// Wiring: upload -> detect -> build -> preview / subject list / download.

import { detectSubjects, parseGeometryFragment } from './detect.js';
import { buildSvg, computeLayout, PARAMS, clickArea, indicatorOffsets, INDICATOR_KEYS } from './template.js';
import { INDICATOR_SIZES } from './indicators.js';

const el = (id) => document.getElementById(id);

const ui = {
    sidebar: el('sud_sidebloсk'),
    resizeHandle: el('resize_handle'),
    subList: el('sub_list'),
    sort: el('sort_button'),
    preview: el('svg_privew_block'),
    stage: el('preview_stage'),
    previewSvg: el('preview_svg'),
    hlBack: el('highlight_back'),
    hlFront: el('highlight_front'),
    upload: el('upload_button'),
    download: el('download_button'),
    copy: el('copy_button'),
    fileInput: el('file_input'),
    overlay: el('drop_overlay'),
    errorBar: el('error_bar'),
    indicatorSwitch: el('indicators_switch'),
    indicatorLabel: el('indicators_label'),
    slider: el('indicators_slider'),
    sliderFilled: el('slider_filled'),
    sliderKnob: el('slider_knob'),
    settingsToolbar: el('settings_toolbar'),
    settings: document.querySelector('.settings'),
    segments: el('segments'),
    layerName: el('layer_name'),
    cursorSwitch: el('cursor_switch'),
    clickBlock: el('click_area_settings'),
    resetClick: el('reset_button'),
    indBlock: el('indicator_position_settings'),
    resetIndicators: el('reset_indicators_button'),
};

/** A subject with nothing in it yet, ready to be typed into. */
function emptySubject() {
    return {
        fill: '', strokeIn: '', fillBBox: null, strokeBBox: null, confidence: 1, isOpen: false,
        // How far each border of the click area sits outside the subject.
        clickArea: { top: 0, right: 0, bottom: 0, left: 0 },
        // How far each indicator has been nudged from its place in the corner.
        indicatorOffsets: {},
    };
}

const state = {
    fileName: null,
    fileHandle: null,   // FileSystemFileHandle, when the browser provides one
    // The page opens on an empty s0 so code can be typed in without loading a
    // file first; it is replaced wholesale as soon as a file arrives.
    subjects: [emptySubject()],
    output: '',
    reversed: false,    // which way round the sort button's arrow points
    hover: -1,          // subject the cursor is on, from either side
    indicator: null,    // {subject, key} of the indicator the arrow keys move
    zoom: 1,            // 1 fills the preview block, 0 is 150px on the longer side
    docSize: { w: 0, h: 0 },
    params: { ...PARAMS },
    // What the preview shows. None of it reaches the file: every layer and
    // every indicator is written out whatever is chosen here.
    preview: {
        indicators: true,
        cursor: true,       // the triangle at the foot of the selected click area
        layer: 'otlichno',  // the segment last clicked
        hover: null,        // the segment under the cursor
        forced: null,       // held on "background" while the hatch is edited
    },
};

/** The expanded subject - the one the click area block belongs to, or -1. */
function selectedIndex() {
    return state.subjects.findIndex((s) => s.isOpen);
}

/** The layer the preview is showing, whoever asked for it. */
function shownLayer() {
    return state.preview.hover || state.preview.forced || state.preview.layer;
}

/** True once anything has been typed or loaded - what the empty state turns on. */
function hasContent() {
    return state.subjects.some((s) => (s.fill || '').trim() || (s.strokeIn || '').trim());
}

let errorTimer = null;
function showError(message) {
    ui.errorBar.textContent = message;
    ui.errorBar.classList.add('is_visible');
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => ui.errorBar.classList.remove('is_visible'), 6000);
}
function clearError() {
    ui.errorBar.classList.remove('is_visible');
}

// ---------------------------------------------------------------- upload

ui.upload.addEventListener('click', async () => {
    if (typeof window.showOpenFilePicker === 'function') {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }],
                multiple: false,
            });
            await load(await handle.getFile(), handle);
        } catch (err) {
            if (err && err.name !== 'AbortError') showError(err.message);
        }
        return;
    }
    ui.fileInput.click();
});

ui.fileInput.addEventListener('change', async () => {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    if (file) await load(file, null);
    ui.fileInput.value = '';
});

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

/** The overlay owns the screen during a drag; the body class lets what is
 *  underneath step aside, starting with the first screen's frame. */
function showDropOverlay(on) {
    ui.overlay.classList.toggle('is_active', on);
    document.body.classList.toggle('is_dragging', on);
}

window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    showDropOverlay(true);
});
window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (--dragDepth <= 0) { dragDepth = 0; showDropOverlay(false); }
});
window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    showDropOverlay(false);

    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    let handle = null;
    // Chromium hands over a writable handle, which lets Export reopen the save
    // dialog in the folder the file came from.
    if (item && typeof item.getAsFileSystemHandle === 'function') {
        try {
            const h = await item.getAsFileSystemHandle();
            if (h && h.kind === 'file') handle = h;
        } catch { /* fall back to the plain File below */ }
    }
    const file = handle ? await handle.getFile() : (e.dataTransfer.files && e.dataTransfer.files[0]);
    if (file) await load(file, handle);
});

async function load(file, handle) {
    if (!/\.svg$/i.test(file.name)) {
        showError('Нужен файл с расширением .svg');
        return;
    }
    try {
        const text = await file.text();
        const { subjects } = detectSubjects(text);
        if (!subjects.length) throw new Error('Не удалось найти субъекты в файле.');

        state.fileName = file.name;
        state.fileHandle = handle;
        state.subjects = subjects;
        // A fresh file arrives in its own order, so the arrow points down again.
        state.hover = -1;
        state.indicator = null;
        state.reversed = false;
        ui.sort.querySelector('img').src = 'assets/icons/sort_down_icon.svg';
        // A single subject is shown expanded; with several, start collapsed.
        subjects.forEach((s) => { s.isOpen = subjects.length === 1; });

        clearError();
        rebuild();
        renderSubList();
        document.body.dataset.loaded = 'true';
    } catch (err) {
        console.error(err);
        showError(err.message || 'Не удалось обработать файл.');
    }
}

// ---------------------------------------------------------------- build

/** Regenerates the SVG from the current subjects and refreshes the preview. */
function rebuild() {
    state.output = buildSvg(state.subjects, state.params);
    ui.previewSvg.innerHTML = state.output;
    applyPreviewLayers();
    renderHighlights();
    // With nothing entered there is nothing to export, nothing to set up and
    // nothing to look at: the preview gives way to the drop target, the
    // settings bar goes with it, and only Upload is offered.
    const ready = hasContent();
    document.body.classList.toggle('is_empty', !ready);
    ui.download.disabled = !ready;
    ui.copy.disabled = !ready;
    // After the class, so the stage is measurable when it is the one showing.
    applyZoom();
}

// ---------------------------------------------------------------- preview layers

// Instruction.pdf 6.2 fixes what the file contains, so nothing here may touch
// the markup: the toolbar hides groups in the injected copy and leaves
// state.output alone.
const LAYERS = ['otlichno', 'norm', 'tpm', 'ndp', 'repair', 'background'];
const LAYER_NAMES = {
    otlichno: 'Отлично',
    norm: 'ДОП',
    tpm: 'ТПМ',
    ndp: 'НДП',
    repair: 'Ремонт',
    background: 'Резерв',
};

// Exact matches only: layer_s0_norm is a state, layer_s0_old_lock_norm is not.
const STATE_GROUP = /^layer_s\d+_(otlichno|norm|tpm|ndp|repair|background)$/;
const INDICATOR_GROUP = /^layer_s\d+_(fail|old_sost|old_repair|old_lock|insert)$/;

/** Shows one state layer per subject, and the indicators if they are wanted. */
function applyPreviewLayers() {
    const wanted = shownLayer();
    for (const g of ui.previewSvg.querySelectorAll('g[id^="layer_s"]')) {
        const state_ = STATE_GROUP.exec(g.id);
        if (state_) { g.style.display = state_[1] === wanted ? 'inline' : 'none'; continue; }
        if (INDICATOR_GROUP.test(g.id)) g.style.display = state.preview.indicators ? 'inline' : 'none';
    }

    ui.layerName.textContent = LAYER_NAMES[wanted];
    for (const seg of ui.segments.children) {
        seg.classList.toggle('is_on', seg.dataset.layer === wanted);
    }
}

// ---------------------------------------------------------------- zoom

// Fully zoomed in, the drawing fills the block, which is how it has always been
// shown; fully out, its longer side is 150px. The wheel runs between the two.
// Both ends move with the block, so the zoom is kept as a position in the range
// rather than as a size, and a resize simply re-reads it.
const ZOOM_MIN_PX = 150;
const ZOOM_STEP = 0.08;

/** What the browser scales the drawing by to fit the stage, as it stands. */
function fitScale() {
    const { w, h } = state.docSize;
    // clientWidth ignores the transform, which is what makes this stable to
    // read from inside the thing it sizes.
    const W = ui.stage.clientWidth;
    const H = ui.stage.clientHeight;
    if (!(w > 0 && h > 0 && W > 0 && H > 0)) return 0;
    return Math.min(W / w, H / h);
}

function applyZoom() {
    const fit = fitScale();
    const longest = Math.max(state.docSize.w, state.docSize.h) * fit;
    // In a block too small to show even the minimum, there is nothing to zoom.
    const floor = longest > ZOOM_MIN_PX ? ZOOM_MIN_PX / longest : 1;
    const scale = Math.pow(floor, 1 - state.zoom);
    ui.stage.style.transform = scale === 1 ? '' : `scale(${scale})`;
    sizeEdgeHandles();
}

ui.preview.addEventListener('wheel', (e) => {
    if (!hasContent()) return;
    e.preventDefault();
    state.zoom = Math.max(0, Math.min(1, state.zoom - Math.sign(e.deltaY) * ZOOM_STEP));
    applyZoom();
}, { passive: false });

// The block changes width with the window and with the subject panel, and both
// ends of the zoom range are measured from it.
new ResizeObserver(applyZoom).observe(ui.stage);

// ---------------------------------------------------------------- highlights

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Rebuilds the two highlight layers from the same frames the file is built
 * from: a tint behind the artwork, an outline and a hit area in front of it.
 * Every subject gets its rectangles once; showing them is a class away.
 */
function renderHighlights() {
    const layout = computeLayout(state.subjects, state.params);
    state.docSize = { w: layout.w, h: layout.viewH };
    ui.hlBack.textContent = '';
    ui.hlFront.textContent = '';

    ui.hlBack.setAttribute('viewBox', layout.viewBox);
    ui.hlFront.setAttribute('viewBox', layout.viewBox);

    const rect = (cls, frame, index) => {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('class', cls);
        r.setAttribute('x', frame.x);
        r.setAttribute('y', frame.y);
        r.setAttribute('width', frame.w);
        r.setAttribute('height', frame.h);
        r.dataset.index = index;
        return r;
    };

    // The outline is as thick as the subject's own outer stroke, in file units,
    // so it scales with the drawing exactly as the artwork does.
    const drawn = [];
    layout.frames.forEach((frame, index) => {
        if (frame.empty || !(frame.w > 0) || !(frame.h > 0)) return;
        ui.hlBack.appendChild(rect('hl_tint', frame, index));
        const outline = rect('hl_outline', frame, index);
        outline.setAttribute('stroke-width', layout.p.stOutWidth);
        ui.hlFront.appendChild(outline);
        drawn.push({ frame, index });
    });

    // Largest first, so a small subject sitting inside a big one stays reachable.
    drawn.sort((a, b) => b.frame.w * b.frame.h - a.frame.w * a.frame.h);
    for (const { frame, index } of drawn) {
        // Two rectangles, because they part company as soon as a border is
        // moved: a click area pulled inside its subject leaves the shape
        // sticking out, and the subject answers there as much as anywhere.
        ui.hlFront.appendChild(subjectHit(frame, index));
        if (frame.base.w > 0 && frame.base.h > 0) {
            ui.hlFront.appendChild(subjectHit(frame.base, index));
        }
    }

    // The pointer is a third as wide as the average subject. It is measured on
    // the subjects themselves, not on their click areas, so moving a border
    // cannot resize it.
    const widths = layout.frames.filter((f) => !f.empty && f.base.w > 0).map((f) => f.base.w);
    const pointerW = widths.length ? widths.reduce((s, w) => s + w, 0) / widths.length / 3 : 0;

    // Over the hit areas, so the indicators and then the borders answer first.
    const d = layout.p.indicatorDiameter * layout.p.indicatorScale;
    for (const { frame, index } of drawn) {
        if (pointerW > 0) ui.hlFront.appendChild(pointerMark(frame, index, pointerW));
        for (const key of INDICATOR_KEYS) {
            const box = { ...frame.indicators[key], w: d, h: d };
            const hit = rect('hl_ind', box, index);
            hit.dataset.key = key;
            // An indicator is part of its subject: pointing at one points at
            // the subject. Without this the subject would be let go the moment
            // the pointer crossed onto an indicator, and since what is lit
            // decides what answers the pointer, the two would take turns.
            hit.addEventListener('mouseenter', () => setHover(index, true));
            hit.addEventListener('mouseleave', () => setHover(-1, false));
            hit.addEventListener('click', (e) => {
                e.stopPropagation();
                if (edge.justDragged) return;
                selectIndicator(index, key);
            });
            ui.hlFront.appendChild(hit);
        }
        for (const side of SIDES) ui.hlFront.appendChild(edgeHandle(frame, index, side));
    }

    sizeEdgeHandles();
    paintHighlights();
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/** One of the rectangles a subject can be pointed at and picked by. */
function subjectHit(box, index) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('class', 'hl_hit');
    r.setAttribute('x', box.x);
    r.setAttribute('y', box.y);
    r.setAttribute('width', box.w);
    r.setAttribute('height', box.h);
    r.dataset.index = index;
    r.addEventListener('mouseenter', () => setHover(index, true));
    r.addEventListener('mouseleave', () => setHover(-1, false));
    r.addEventListener('click', (e) => {
        e.stopPropagation();
        // The click that ends a border drag is not a click on the subject.
        if (edge.justDragged) return;
        toggleSubject(index);
    });
    return r;
}

/**
 * The triangle at the foot of a click area, to the proportions of
 * design/icons/pointer.svg (100 wide, 80 tall, 4 of stroke). Its tip stands a
 * third of its height inside the area rather than on the border itself.
 */
function pointerMark(frame, index, w) {
    const h = w * 0.8;
    const cx = frame.x + frame.w / 2;
    const tip = frame.y + frame.h - h / 3;
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('class', 'hl_cursor');
    p.setAttribute('points', `${cx},${tip} ${cx + w / 2},${tip + h} ${cx - w / 2},${tip + h}`);
    p.setAttribute('stroke-width', w * 0.04);
    p.dataset.index = index;
    return p;
}

/**
 * A grab band lying along one border of a subject's frame. The frame it belongs
 * to rides on the element, because the band's thickness is a screen measure and
 * is worked out again every time the drawing changes size.
 */
function edgeHandle(frame, index, side) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('class', `hl_edge hl_edge_${side}`);
    r.dataset.index = index;
    r.dataset.side = side;
    r.dataset.fx = frame.x;
    r.dataset.fy = frame.y;
    r.dataset.fw = frame.w;
    r.dataset.fh = frame.h;
    r.addEventListener('pointerdown', (e) => startEdgeDrag(e, index, side));
    // The band lies over its subject's outline, so the subject has to stay
    // hovered while the pointer is on it - otherwise the band would go quiet
    // under the cursor and hand it straight back.
    r.addEventListener('mouseenter', () => setHover(index, true));
    r.addEventListener('mouseleave', () => setHover(-1, false));
    // Letting this through would put the click area away mid-adjustment.
    r.addEventListener('click', (e) => e.stopPropagation());
    return r;
}

// How wide the band is to the pointer, on screen, at any zoom.
const EDGE_GRAB_PX = 9;

/** Screen pixels per file unit, as the preview is being shown right now. */
function previewScale() {
    const ctm = ui.hlFront.getScreenCTM ? ui.hlFront.getScreenCTM() : null;
    return ctm && ctm.a > 0 ? ctm.a : 0;
}

/** Re-lays the grab bands so they stay the same width under the cursor. */
function sizeEdgeHandles() {
    const scale = previewScale();
    if (!scale) return;
    const t = EDGE_GRAB_PX / scale;
    for (const r of ui.hlFront.querySelectorAll('.hl_edge')) {
        const x = Number(r.dataset.fx);
        const y = Number(r.dataset.fy);
        const w = Number(r.dataset.fw);
        const h = Number(r.dataset.fh);
        const box = {
            top: { x: x - t / 2, y: y - t / 2, w: w + t, h: t },
            bottom: { x: x - t / 2, y: y + h - t / 2, w: w + t, h: t },
            left: { x: x - t / 2, y: y - t / 2, w: t, h: h + t },
            right: { x: x + w - t / 2, y: y - t / 2, w: t, h: h + t },
        }[r.dataset.side];
        r.setAttribute('x', box.x);
        r.setAttribute('y', box.y);
        r.setAttribute('width', box.w);
        r.setAttribute('height', box.h);
    }
}

/** A subject is lit while its row is expanded or either side is hovered. */
function paintHighlights() {
    for (const r of ui.stage.querySelectorAll('.hl_tint, .hl_outline')) {
        const index = Number(r.dataset.index);
        const on = state.hover === index || !!(state.subjects[index] || {}).isOpen;
        r.classList.toggle('is_on', on);
    }
    for (const block of ui.subList.children) {
        block.classList.toggle('is_hover', Number(block.dataset.index) === state.hover);
    }

    // A lit subject offers its borders, so they can be taken hold of without
    // picking the subject out first; only the selected one shows the pointer,
    // because that is the one the sidebar block is adjusting.
    const selected = selectedIndex();
    for (const r of ui.stage.querySelectorAll('.hl_edge')) {
        const index = Number(r.dataset.index);
        r.classList.toggle('is_live', index === selected || index === state.hover);
    }
    for (const p of ui.stage.querySelectorAll('.hl_cursor')) {
        p.classList.toggle('is_selected',
            state.preview.cursor && Number(p.dataset.index) === selected);
    }

    // Every indicator on show can be picked, on any subject: clicking one is
    // how its subject is picked too. Only being hidden takes that away - and
    // that cannot change under the cursor, which is what kept the pointer and
    // the highlight trading places.
    for (const r of ui.stage.querySelectorAll('.hl_ind')) {
        r.classList.toggle('is_live', state.preview.indicators);
    }

    renderClickArea();
    renderIndicators();
}

/**
 * @param {number} index subject under the cursor, or -1 for none
 * @param {boolean} fromPreview hovering the drawing also brings the row into view
 */
function setHover(index, fromPreview) {
    // Rows slide under the cursor while one is being carried, and a border
    // carried across the drawing passes over its neighbours; neither is the
    // pointer picking out a subject.
    if ((drag.active || edge.active) && index >= 0) return;
    if (state.hover === index) return;
    state.hover = index;
    paintHighlights();
    if (fromPreview && index >= 0) centreInList(ui.subList.children[index]);
}

/** Puts the row as near the middle of the list as its scroll range allows. */
function centreInList(block) {
    if (!block) return;
    const list = ui.subList;
    const target = block.offsetTop - (list.clientHeight - block.offsetHeight) / 2;
    list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, target));
}

/** Expands one subject and closes the rest. */
function selectSubject(index) {
    if (!state.subjects[index]) return;
    // The arrow keys move an indicator of the subject in hand, so picking a
    // different subject puts the old one down.
    if (state.indicator && state.indicator.subject !== index) state.indicator = null;
    state.subjects.forEach((s, i) => { s.isOpen = i === index; });
    renderSubList();
    paintHighlights();
}

/** Expands one subject and closes the rest; expanding again closes it. */
function toggleSubject(index) {
    const subject = state.subjects[index];
    if (!subject) return;
    if (subject.isOpen) collapseAll();
    else selectSubject(index);
}

/** Nothing is expanded and nothing is lit. */
function collapseAll() {
    state.indicator = null;
    if (!state.subjects.some((s) => s.isOpen)) return;
    state.subjects.forEach((s) => { s.isOpen = false; });
    renderSubList();
    paintHighlights();
}

// Anywhere in the preview that is not a subject means "none of them", and so
// does the empty space under the last row.
ui.stage.addEventListener('click', () => { if (!edge.justDragged) collapseAll(); });

// Rebuilding the file replaces the hit areas under the cursor, and an element
// that is taken out of the document cannot report that the pointer left it. The
// block itself is never replaced, so leaving it is the one reliable way to know
// that nothing in the drawing is being pointed at.
ui.preview.addEventListener('mouseleave', () => setHover(-1, false));
ui.subList.addEventListener('click', (e) => {
    if (e.target.closest('.sub_block') || drag.justDropped) return;
    collapseAll();
});

// ---------------------------------------------------------------- click area

// layer_sN_frame is the rectangle KOMPAKS lets the user click on, so it is a
// real part of the file, not a preview aid: the four numbers below move its
// borders, and the highlight, the indicators in the corners and the viewBox all
// follow, because they are all worked out from the same frame.
//
// A border is positive outwards: +10 on the left pushes that border 10px clear
// of the subject, -10 pulls it inside.

const MIN_FRAME = 1;        // px of frame that must survive, so it cannot invert
const MAX_BORDER = 9999;

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** The subject's own rectangle: what its click area is with every border at 0. */
function subjectBase(subject) {
    const b = subject.fillBBox || subject.strokeBBox;
    if (!b) return { w: 0, h: 0 };
    return { w: b.w + state.params.stOutWidth, h: b.h + state.params.stOutWidth };
}

/** Keeps a border inside its range and stops the frame turning inside out. */
function clampBorder(subject, side, value) {
    const v = Math.max(-MAX_BORDER, Math.min(MAX_BORDER, Math.round(value)));
    if (!(subject.fillBBox || subject.strokeBBox)) return v;
    const across = side === 'left' || side === 'right';
    const base = across ? subjectBase(subject).w : subjectBase(subject).h;
    const opposite = clickArea(subject)[OPPOSITE[side]];
    return Math.max(v, MIN_FRAME - base - opposite);
}

/**
 * Moves one or both of a subject's borders at once.
 * @param {number} index the subject
 * @param {Object<string, number>} wanted the borders to move, by side
 * @returns {Object<string, number>} where each ended up, which is not always where it was sent
 */
function setBorders(index, wanted) {
    const applied = {};
    const subject = state.subjects[index];
    if (!subject) return applied;
    if (!subject.clickArea) subject.clickArea = { top: 0, right: 0, bottom: 0, left: 0 };

    let moved = false;
    for (const side of Object.keys(wanted)) {
        // Clamped against the borders as they stand, so a pair moving together
        // cannot squeeze the frame out of existence between them.
        const next = clampBorder(subject, side, wanted[side]);
        applied[side] = next;
        if (next !== subject.clickArea[side]) {
            subject.clickArea[side] = next;
            moved = true;
        }
    }
    if (moved) rebuild();   // the frame is part of the file, so the file is built again
    showClickFields();
    return applied;
}

/** The block belongs to the selected subject, and there is one only then. */
function renderClickArea() {
    const on = selectedIndex() >= 0 && hasContent();
    ui.clickBlock.classList.toggle('is_on', on);
    if (on) showClickFields();
}

/** Fills the four fields from the selected subject, units and all. */
function showClickFields() {
    if (selectedIndex() < 0) return;
    for (const show of borderFields) show();
}

// ---- dragging a border in the drawing

const edge = { active: false, justDragged: false };

// Within this much of the subject's own edge - a share of the subject's width
// or height - a dragged border is taken to mean that edge, and reads 0.
const SNAP_SHARE = 0.05;

function startEdgeDrag(e, index, side) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const subject = state.subjects[index];
    let scale = previewScale();
    if (!subject || !scale) return;

    // Taking hold of a border is as good a way of picking a subject as clicking
    // it: what is being adjusted is what the sidebar block should be showing.
    if (!subject.isOpen) selectSubject(index);

    // preventDefault leaves the focus where it was, and a field that keeps the
    // focus is a field that does not show what the border is doing.
    if (document.activeElement && document.activeElement.closest('.click_input')) {
        document.activeElement.blur();
    }

    const across = side === 'left' || side === 'right';
    // Dragging away from the subject grows the area, on every side.
    const away = side === 'left' || side === 'top' ? -1 : 1;
    const opposite = OPPOSITE[side];
    const start = clickArea(subject);
    const base = subjectBase(subject);
    const snap = (across ? base.w : base.h) * SNAP_SHARE;

    let last = across ? e.clientX : e.clientY;
    // Kept as a fraction so slow travel is not lost to rounding, and reined
    // back in whenever the border cannot go where it is being taken.
    let value = start[side];

    edge.active = true;
    document.body.classList.add(across ? 'is_edge_x' : 'is_edge_y');

    const onMove = (ev) => {
        const now = across ? ev.clientX : ev.clientY;
        // Read afresh: growing the area grows the viewBox, and the drawing is
        // scaled to fit, so what a screen pixel is worth changes as it moves.
        scale = previewScale() || scale;
        value += ((now - last) / scale) * away;
        last = now;

        // Near the edge of the subject the border takes it: that is the one
        // place where the area is the shape again and the field reads 0.
        const wanted = Math.abs(value) <= snap ? 0 : Math.round(value);
        const borders = { [side]: wanted };
        // Alt mirrors the border across the middle of the area, so both sides
        // travel the same distance and the centre stays where it is.
        if (ev.altKey) borders[opposite] = start[opposite] + (wanted - start[side]);

        const applied = setBorders(index, borders);
        // Only a border that was stopped short is worth resyncing to: the snap
        // is where the border was sent, and forgetting that would pin it there.
        if (applied[side] !== wanted) value = applied[side];
    };

    const onUp = (ev) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        edge.active = false;
        document.body.classList.remove('is_edge_x', 'is_edge_y');
        // Nothing has answered for the pointer while the border was in hand,
        // and staying still over an element is not something the browser
        // reports, so what it is on now has to be asked for.
        const under = ev && document.elementFromPoint(ev.clientX, ev.clientY);
        const on = under && under.dataset && under.dataset.index !== undefined
            ? Number(under.dataset.index) : -1;
        setHover(on, false);
        // The pointerup is followed by a click, which must not reach the drawing.
        edge.justDragged = true;
        setTimeout(() => { edge.justDragged = false; }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
}

// ---- the four fields and the reset button

/**
 * A field in the sidebar that holds one number. Same manners as the fields on
 * the toolbar: it carries its unit as text and sheds it while it is being
 * edited, and only a number may be typed - here with a leading minus, since
 * these can go either way. The arrows step by 1, or by 10 with Shift.
 *
 * @param {HTMLInputElement} input
 * @param {() => number} get where the number lives
 * @param {(value: number) => void} set what to do when it changes
 * @param {() => void} [onFocus] anything else reaching for the field means
 * @returns {() => void} puts what `get` says into the field
 */
function numberField(input, get, set, onFocus) {
    const unit = input.dataset.unit || '';   // px is left unwritten

    // Text that is already right is left alone: assigning it again would put
    // the caret at the end of whatever is being typed.
    const show = () => {
        const next = document.activeElement === input ? String(get()) : get() + unit;
        if (input.value !== next) input.value = next;
    };

    input.addEventListener('focus', () => {
        if (onFocus) onFocus();
        show();
        input.select();
    });
    input.addEventListener('blur', show);

    input.addEventListener('beforeinput', (e) => {
        if (e.data != null && !/^[\d-]+$/.test(e.data)) e.preventDefault();
    });

    input.addEventListener('input', () => {
        // One minus sign, and only at the front.
        const clean = input.value.replace(/(?!^)-/g, '').replace(/[^\d-]/g, '');
        if (clean !== input.value) input.value = clean;
        if (clean === '' || clean === '-') return;   // mid-edit, wait for a number
        set(Number(clean));
    });

    input.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowUp' ? 1 : (e.key === 'ArrowDown' ? -1 : 0);
        if (!dir) return;
        e.preventDefault();
        set(get() + dir * (e.shiftKey ? 10 : 1));
        show();
        input.select();
    });

    return show;
}

const borderFields = SIDES.map((side) => numberField(
    el('click_' + side),
    () => clickArea(state.subjects[selectedIndex()] || {})[side],
    (value) => { if (selectedIndex() >= 0) setBorders(selectedIndex(), { [side]: value }); },
));

// Back to the subject's own size, which is what an untouched subject has.
ui.resetClick.addEventListener('click', () => {
    const subject = state.subjects[selectedIndex()];
    if (!subject) return;
    const a = clickArea(subject);
    if (!SIDES.some((side) => a[side] !== 0)) return;
    subject.clickArea = { top: 0, right: 0, bottom: 0, left: 0 };
    rebuild();
    showClickFields();
});

// ---------------------------------------------------------------- indicator positions

// Instruction.pdf 5.5 puts the five indicators in the corners of the subject and
// in its middle. The reference files nudge them from there - CC2 has subjects
// about 52px tall, where four 45px indicators in the corners would overlap - so
// each subject carries an offset per indicator, and they go into the file: the
// x and y of its <use>. They are moved with the arrow keys, which is what the
// reference files look like they were drawn with.

/** Picks an indicator out, bringing its subject with it. */
function selectIndicator(index, key) {
    if (!state.subjects[index] || !INDICATOR_KEYS.includes(key)) return;
    // Selecting the subject clears whatever indicator was in hand, so the new
    // one is set afterwards.
    if (!state.subjects[index].isOpen) selectSubject(index);
    state.indicator = { subject: index, key };
    paintHighlights();
}

/**
 * Moves one indicator of one subject along one axis.
 * @returns {number} where it ended up
 */
function setOffset(index, key, axis, value) {
    const subject = state.subjects[index];
    if (!subject) return 0;
    if (!subject.indicatorOffsets) subject.indicatorOffsets = {};
    const at = indicatorOffsets(subject)[key];
    // The same range the borders take; nothing else limits an indicator, since
    // the document grows to hold one that is nudged outside the subject.
    const next = Math.max(-MAX_BORDER, Math.min(MAX_BORDER, Math.round(value)));
    if (next !== at[axis]) {
        subject.indicatorOffsets[key] = { ...at, [axis]: next };
        rebuild();          // the <use> is in the file, so the file is built again
    }
    showIndicatorFields();
    return next;
}

/** The block belongs to the selected subject, like the one above it. */
function renderIndicators() {
    const index = selectedIndex();
    const on = index >= 0 && hasContent();
    ui.indBlock.classList.toggle('is_on', on);

    const chosen = state.indicator;
    for (const fields of ui.indBlock.querySelectorAll('.ind_fields')) {
        fields.classList.toggle('is_selected',
            !!chosen && chosen.subject === index && fields.dataset.indicator === chosen.key);
    }
    if (on) showIndicatorFields();
}

function showIndicatorFields() {
    if (selectedIndex() < 0) return;
    for (const show of indicatorFields) show();
}

const indicatorFields = [...document.querySelectorAll('.ind_input')].map((input) => {
    const key = input.dataset.indicator;
    const axis = input.dataset.axis;
    return numberField(
        input,
        () => indicatorOffsets(state.subjects[selectedIndex()] || {})[key][axis],
        (value) => { if (selectedIndex() >= 0) setOffset(selectedIndex(), key, axis, value); },
        // Reaching for a field is picking that indicator out, so the drawing
        // marks the one the numbers belong to.
        () => selectIndicator(selectedIndex(), key),
    );
});

// ---- the arrow keys

const ARROWS = {
    ArrowLeft: ['x', -1],
    ArrowRight: ['x', 1],
    ArrowUp: ['y', -1],
    ArrowDown: ['y', 1],
};

// With an indicator picked out in the drawing the arrows move it: 1px a press,
// 10 with Shift. A field with the caret in it does its own arrows.
window.addEventListener('keydown', (e) => {
    if (!state.indicator) return;
    if (e.key === 'Escape') { putIndicatorDown(); return; }

    const move = ARROWS[e.key];
    if (!move) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
    e.preventDefault();
    const [axis, dir] = move;
    const { subject, key } = state.indicator;
    setOffset(subject, key, axis, indicatorOffsets(state.subjects[subject] || {})[key][axis]
        + dir * (e.shiftKey ? 10 : 1));
});

function putIndicatorDown() {
    if (!state.indicator) return;
    state.indicator = null;
    paintHighlights();
}

// A click anywhere else puts the indicator down. The listener is on the way in,
// because the things worth clicking in the drawing stop the click on the way
// out - and the one on an indicator picks that indicator straight back up.
window.addEventListener('click', (e) => {
    if (!state.indicator) return;
    const target = e.target;
    if (!target || !target.closest) { putIndicatorDown(); return; }
    // The fields are the indicator's own, and reaching for one picks it out.
    if (target.closest('.indicator_position_settings')) return;
    const onItself = target.classList.contains('hl_ind')
        && Number(target.dataset.index) === state.indicator.subject
        && target.dataset.key === state.indicator.key;
    if (!onItself) putIndicatorDown();
}, true);

// Every indicator of every subject goes back to its corner - the one button
// that reaches past the subject in hand, because indicators are nudged a
// fileful at a time.
ui.resetIndicators.addEventListener('click', () => {
    const moved = state.subjects.some((s) => {
        const o = indicatorOffsets(s);
        return INDICATOR_KEYS.some((key) => o[key].x || o[key].y);
    });
    if (!moved) return;
    state.subjects.forEach((s) => { s.indicatorOffsets = {}; });
    rebuild();
    showIndicatorFields();
});

// ---------------------------------------------------------------- subject list

function renderSubList() {
    ui.subList.textContent = '';

    state.subjects.forEach((subject, index) => {
        const block = document.createElement('div');
        block.className = 'sub_block';
        block.dataset.index = index;
        if (subject.isOpen) block.classList.add('is_open');

        const add = iconButton('add_sub_button', 'assets/icons/add_icon.svg', 12, 12, 'Добавить субъект');
        add.addEventListener('click', (e) => { e.stopPropagation(); addSubject(index); });

        const num = document.createElement('div');
        num.className = 'sub_num';
        num.textContent = `s${index}`;

        const fields = document.createElement('div');
        fields.className = 'text_fields_block';
        fields.appendChild(codeField('fill', subject, 'fill'));
        fields.appendChild(codeField('str', subject, 'strokeIn'));

        // The last remaining subject cannot be removed, so it is offered no
        // delete button at all.
        let del = null;
        if (state.subjects.length > 1) {
            del = iconButton('delete_sub_button', 'assets/icons/delete_icon.svg', 11, 12, 'Удалить субъект');
            del.addEventListener('click', (e) => { e.stopPropagation(); removeSubject(index); });
        }

        // The whole row toggles, including its expanded area - but not the
        // code fields or the buttons, which have their own jobs, and not the
        // click that ends a drag.
        block.addEventListener('click', (e) => {
            if (e.target.closest('textarea, button')) return;
            if (drag.justDropped) return;
            toggleSubject(index);
        });

        // Pointing at a row lights up the subject in the drawing.
        block.addEventListener('mouseenter', () => setHover(index, false));
        block.addEventListener('mouseleave', () => setHover(-1, false));

        block.addEventListener('pointerdown', (e) => startRowDrag(e, block));

        block.append(add, num, fields);
        if (del) block.appendChild(del);
        ui.subList.appendChild(block);
    });

    // Textareas can only be sized once they are in the document.
    sizeAllFields();
    // The rows are new elements, so the hover mark has to be put back on.
    paintHighlights();
}

// ---------------------------------------------------------------- reordering

// Rows are reordered by carrying them, not by HTML5 drag-and-drop: a draggable
// row would fight the code fields for the pointer, and the window already
// listens for a file being dragged in.
const drag = {
    active: false,
    block: null,    // the row in hand, lifted out of the list
    ghost: null,    // its copy, which holds the place the row would drop into
    startY: 0,      // where the press landed
    lastY: 0,       // where the cursor is now
    grabY: 0,       // how far down the row it was grabbed
    justDropped: false,
};
const DRAG_THRESHOLD = 4;   // px of travel before a press counts as a drag
const EDGE_STEP = 8;        // px the list scrolls per tick while the row is at its edge

function startRowDrag(e, block) {
    if (e.button !== 0 || e.target.closest('textarea, button')) return;
    if (state.subjects.length < 2) return;

    const rect = block.getBoundingClientRect();
    drag.block = block;
    drag.startY = e.clientY;
    drag.lastY = e.clientY;
    drag.grabY = e.clientY - rect.top;

    // The listeners go on the window, not the row: moving the row in the DOM
    // releases any pointer capture it holds, and the drag would stop dead.
    const onMove = (ev) => {
        if (!drag.active) {
            if (Math.abs(ev.clientY - drag.startY) < DRAG_THRESHOLD) return;
            drag.active = true;
            liftRow(rect);
            setHover(-1, false);
        }
        ev.preventDefault();
        drag.lastY = ev.clientY;
        dragRow();
    };

    const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        stopEdge();
        if (!drag.active) { drag.block = null; return; }

        // The row drops into the place its copy was holding.
        drag.ghost.replaceWith(block);
        drag.ghost = null;
        drag.active = false;
        drag.block = null;
        markDropGap();          // with no row in hand, this clears the marks
        block.removeAttribute('style');
        block.classList.remove('is_dragging');
        document.body.classList.remove('is_row_dragging');
        // The pointerup is followed by a click, which must not toggle the row.
        drag.justDropped = true;
        setTimeout(() => { drag.justDropped = false; }, 0);
        commitRowOrder();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
}

/**
 * Takes the row out of the list and leaves a copy of it in its place. The copy
 * is what travels through the list and shows where the row will land; the row
 * itself is fixed to the viewport and follows the cursor.
 */
function liftRow(rect) {
    const block = drag.block;

    const ghost = block.cloneNode(true);
    ghost.classList.add('sub_block_ghost');
    // cloneNode copies a textarea's markup, not what has been typed into it.
    const typed = block.querySelectorAll('textarea');
    ghost.querySelectorAll('textarea').forEach((area, i) => { area.value = typed[i].value; });

    block.replaceWith(ghost);
    drag.ghost = ghost;

    // Out of the list entirely, so it is neither clipped by it nor counted
    // among its rows, and fixed so that scrolling the list leaves it alone.
    block.classList.add('is_dragging');
    block.style.left = `${rect.left}px`;
    block.style.width = `${rect.width}px`;
    block.style.top = `${rect.top}px`;
    document.body.appendChild(block);
    document.body.classList.add('is_row_dragging');
}

/**
 * One step of the carry: the copy is slotted where the row would land, which is
 * what pushes the other rows out of the way, and the row itself is put under
 * the cursor. The numbers are left alone until the drop - the row keeps the
 * number it was picked up with.
 */
function dragRow() {
    const ghost = drag.ghost;
    const list = ui.subList;
    const listRect = list.getBoundingClientRect();
    // A row loses its top border once it is no longer the first, so the height
    // is read afresh rather than remembered from the press.
    const height = ghost.getBoundingClientRect().height;

    // Where the row is being held. The slot is chosen from that, unclamped, so
    // carrying the row past the end of the list really does mean the end.
    const wanted = drag.lastY - drag.grabY;
    const middle = wanted + height / 2;

    // Everything below the copy is already standing one row lower to make room
    // for it. Measuring against where the rows would be without the copy is
    // what keeps the answer the same whichever side of them it is on - compare
    // against where they actually are and the row has to travel a whole row
    // past a neighbour before they trade places.
    const rows = [...list.children];
    const gap = rows.indexOf(ghost);
    let before = null;
    for (let i = 0; i < rows.length && !before; i++) {
        if (i === gap) continue;
        const r = rows[i].getBoundingClientRect();
        if (middle < r.top + r.height / 2 - (i > gap ? height : 0)) before = rows[i];
    }
    if (before !== ghost.nextElementSibling) list.insertBefore(ghost, before);
    markDropGap();

    // What is drawn stays inside the list, so the row never leaves the view.
    drag.block.style.top =
        `${Math.max(listRect.top, Math.min(listRect.bottom - height, wanted))}px`;

    followEdge(wanted, height, listRect);
}

/** Draws the gap the row would drop into on the two rows framing it. */
function markDropGap() {
    for (const b of ui.subList.children) b.classList.remove('is_drop_above', 'is_drop_below');
    if (!drag.ghost) return;
    const above = drag.ghost.previousElementSibling;
    const below = drag.ghost.nextElementSibling;
    if (above) above.classList.add('is_drop_above');
    if (below) below.classList.add('is_drop_below');
}

// Carrying the row past the top or bottom of the list keeps it scrolling, so a
// row can be taken to a place the list is not currently showing.
let edgeTimer = null;
function followEdge(wantedTop, height, listRect) {
    const dir = wantedTop < listRect.top ? -1
        : (wantedTop + height > listRect.bottom ? 1 : 0);
    if (!dir) { stopEdge(); return; }
    if (edgeTimer) return;
    edgeTimer = setInterval(() => {
        const before = ui.subList.scrollTop;
        ui.subList.scrollTop += dir * EDGE_STEP;
        // At either end of the list there is nowhere left to go.
        if (ui.subList.scrollTop === before) { stopEdge(); return; }
        dragRow();
    }, 16);
}
function stopEdge() {
    clearInterval(edgeTimer);
    edgeTimer = null;
}

/** Reads the order off the rows and rebuilds the file from it. */
function commitRowOrder() {
    const order = [...ui.subList.children].map((b) => Number(b.dataset.index));
    const moved = order.some((from, to) => from !== to);
    if (!moved) return;
    state.subjects = order.map((from) => state.subjects[from]);
    state.hover = -1;
    state.indicator = null;
    rebuild();
    renderSubList();
}

function iconButton(className, src, w, h, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icon_button ${className}`;
    button.title = title;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.width = w;
    img.height = h;
    button.appendChild(img);
    return button;
}

function codeField(label, subject, key) {
    const wrap = document.createElement('div');
    wrap.className = 'text_field';

    const caption = document.createElement('span');
    caption.className = 'field_label';
    caption.textContent = label;

    const area = document.createElement('textarea');
    area.rows = 1;
    area.spellcheck = false;
    area.value = subject[key] || '';

    area.addEventListener('input', () => {
        autoSize(area);
        // Whatever is typed goes into the file as-is. The geometry is only
        // re-measured to keep the frame and viewBox right; if it cannot be
        // read, the previous measurement stands.
        subject[key] = area.value;
        const parsed = parseGeometryFragment(area.value);
        if (parsed) {
            if (key === 'fill') subject.fillBBox = parsed.bbox;
            else subject.strokeBBox = parsed.bbox;
        }
        rebuild();
    });

    wrap.append(caption, area);
    return wrap;
}

/** Grows the field to fit its content, so it never shows a scrollbar. */
function autoSize(area) {
    area.style.height = 'auto';
    // box-sizing is border-box, so the borders have to be added on top of the
    // content height or the field stays two pixels short and still overflows.
    const borders = area.offsetHeight - area.clientHeight;
    area.style.height = `${area.scrollHeight + borders}px`;
}

function sizeAllFields() {
    ui.subList.querySelectorAll('textarea').forEach(autoSize);
}

// The web font arrives after first paint and reflows the text, and changing the
// sidebar width rewraps it, so the fields have to be measured again both times.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeAllFields);
new ResizeObserver(sizeAllFields).observe(ui.subList);

function addSubject(index) {
    state.subjects.forEach((s) => { s.isOpen = false; });
    state.subjects.splice(index + 1, 0, { ...emptySubject(), isOpen: true });
    state.hover = -1;
    state.indicator = null;
    rebuild();
    renderSubList();
}

function removeSubject(index) {
    if (state.subjects.length <= 1) return;
    state.subjects.splice(index, 1);
    // The rows below shift up, so whatever was hovered is no longer that row.
    state.hover = -1;
    state.indicator = null;
    rebuild();
    renderSubList();
}

// Turns the list end for end: what was typed for the last subject becomes s0.
// Which numbers the layers carry is the whole point, so the file is rebuilt.
ui.sort.addEventListener('click', () => {
    state.subjects.reverse();
    state.reversed = !state.reversed;
    state.hover = -1;
    state.indicator = null;
    ui.sort.querySelector('img').src =
        `assets/icons/sort_${state.reversed ? 'up' : 'down'}_icon.svg`;
    rebuild();
    renderSubList();
});

// ---------------------------------------------------------------- settings toolbar

// ---- fitting the bar to the window

// When the bar runs out of room its blocks go, whole, lowest data-drop first.
// Nothing here knows a width: the order comes from the markup and the decision
// from measuring, so a new block only has to be written with a data-drop of
// its own. The slider narrows first (see the stylesheet), so a block is only
// dropped once even the tightened layout would be cut off.
const DROP_ORDER = [...ui.settingsToolbar.querySelectorAll('[data-drop]')]
    .sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop));

/**
 * True while anything on the bar is being cut off. The settings block is the
 * one that gives way, so it is measured too - a block outside it would show up
 * on the bar itself.
 */
function tooTight() {
    return ui.settings.scrollWidth > ui.settings.clientWidth + 1
        || ui.settingsToolbar.scrollWidth > ui.settingsToolbar.clientWidth + 1;
}

function fitToolbar() {
    for (const block of DROP_ORDER) block.classList.remove('is_hidden');
    for (const block of DROP_ORDER) {
        // Reading the width after each one flushes the layout, so the next
        // test sees the room the last block gave up.
        if (!tooTight()) return;
        block.classList.add('is_hidden');
    }
}

/** Everything on the bar that depends on how much room the bar has. */
function layoutToolbar() {
    fitToolbar();
    // The knob's place is a fraction of a track that both shrinks with the
    // window and measures zero while the bar is hidden.
    paintSlider();
}

// Fires for the window, for the sidebar being dragged, and for the bar being
// shown again with the preview. Hiding a block never changes the bar's own
// width, so this cannot feed itself.
new ResizeObserver(layoutToolbar).observe(ui.settingsToolbar);

// ---- layer segments

for (const layer of LAYERS) {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = `segment segment_${layer}`;
    seg.dataset.layer = layer;
    seg.title = LAYER_NAMES[layer];
    // Pointing at a segment shows that layer; the one last clicked is what the
    // preview falls back to when the cursor leaves.
    seg.addEventListener('mouseenter', () => { state.preview.hover = layer; applyPreviewLayers(); });
    seg.addEventListener('click', () => {
        state.preview.layer = layer;
        state.preview.forced = null;
        applyPreviewLayers();
    });
    ui.segments.appendChild(seg);
}

ui.segments.addEventListener('mouseleave', () => {
    state.preview.hover = null;
    applyPreviewLayers();
});

// ---- indicator switch

function setIndicators(on) {
    state.preview.indicators = on;
    ui.indicatorSwitch.classList.toggle('is_on', on);
    ui.indicatorSwitch.setAttribute('aria-checked', String(on));
    ui.indicatorSwitch.title = on ? 'Скрыть индикаторы' : 'Показать индикаторы';
    applyPreviewLayers();
    // Indicators that are not on show answer to nothing, so what the pointer
    // can reach changes with them.
    paintHighlights();
}

ui.indicatorSwitch.addEventListener('click', () => setIndicators(!state.preview.indicators));

// ---- cursor switch

// The triangle is drawn on the highlight layer, so this is a preview setting
// like the one above it: the file has no cursor in it either way.
function setCursor(on) {
    state.preview.cursor = on;
    ui.cursorSwitch.classList.toggle('is_on', on);
    ui.cursorSwitch.setAttribute('aria-checked', String(on));
    ui.cursorSwitch.title = on ? 'Скрыть курсор' : 'Показать курсор';
    paintHighlights();
}

ui.cursorSwitch.addEventListener('click', () => setCursor(!state.preview.cursor));

// ---- indicator size slider

const KNOB_W = 8;

/** Which prepared size the slider is on. */
function sizeIndex() {
    const i = INDICATOR_SIZES.indexOf(state.params.indicatorDiameter);
    return i < 0 ? INDICATOR_SIZES.indexOf(PARAMS.indicatorDiameter) : i;
}

function paintSlider() {
    const size = state.params.indicatorDiameter;
    const travel = ui.slider.clientWidth - KNOB_W;
    const at = (sizeIndex() / (INDICATOR_SIZES.length - 1)) * travel;
    ui.sliderKnob.style.left = `${at}px`;
    ui.sliderFilled.style.width = `${at + KNOB_W / 2}px`;
    ui.indicatorLabel.textContent = `Индикаторы ${size} px`;
    ui.slider.setAttribute('aria-valuenow', String(size));
    ui.slider.setAttribute('aria-valuetext', `${size} px`);
}

/** Only the prepared sizes exist, so the knob lands on the nearest one. */
function setIndicatorSize(index) {
    const clamped = Math.max(0, Math.min(INDICATOR_SIZES.length - 1, index));
    const size = INDICATOR_SIZES[clamped];
    if (size === state.params.indicatorDiameter) { paintSlider(); return; }
    state.params.indicatorDiameter = size;
    // Resizing something invisible says the user wants to see it.
    if (!state.preview.indicators) setIndicators(true);
    paintSlider();
    layoutToolbar();   // the label grows and shrinks with the number in it
    rebuild();
}

function sizeFromPointer(clientX) {
    const r = ui.slider.getBoundingClientRect();
    const travel = r.width - KNOB_W;
    const at = Math.max(0, Math.min(travel, clientX - r.left - KNOB_W / 2));
    return Math.round((at / travel) * (INDICATOR_SIZES.length - 1));
}

ui.slider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ui.slider.setPointerCapture(e.pointerId);
    ui.slider.focus();
    setIndicatorSize(sizeFromPointer(e.clientX));

    const onMove = (ev) => setIndicatorSize(sizeFromPointer(ev.clientX));
    const onUp = () => {
        ui.slider.removeEventListener('pointermove', onMove);
        ui.slider.removeEventListener('pointerup', onUp);
        ui.slider.removeEventListener('pointercancel', onUp);
    };
    ui.slider.addEventListener('pointermove', onMove);
    ui.slider.addEventListener('pointerup', onUp);
    ui.slider.addEventListener('pointercancel', onUp);
});

ui.slider.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    setIndicatorSize(sizeIndex() + step);
});

// ---- number fields

// Each field carries its unit as text and sheds it while it is being edited.
// Nothing but digits may be typed: no sign, no decimal point, no exponent.
const FIELDS = [
    { id: 'line_out', key: 'stOutWidth' },
    { id: 'line_in', key: 'stInWidth' },
    { id: 'hatch_angle', key: 'hatchAngle', hatch: true },
    { id: 'hatch_width', key: 'hatchLineWidth', hatch: true },
    { id: 'hatch_coverage', key: 'hatchCoverage', hatch: true },
];

function setUpField({ id, key, hatch }) {
    const input = el(id);
    const min = Number(input.dataset.min);
    const max = Number(input.dataset.max);
    const unit = input.dataset.unit || '';   // px is left unwritten
    const show = () => {
        input.value = document.activeElement === input
            ? String(state.params[key])
            : `${state.params[key]}${unit}`;
    };

    const commit = (value) => {
        const next = Math.max(min, Math.min(max, value));
        if (next === state.params[key]) return;
        state.params[key] = next;
        rebuild();
    };

    input.addEventListener('focus', () => {
        // The hatch is only visible on the background layer, so reaching for
        // one of its fields brings that layer up before anything is typed.
        if (hatch) { state.preview.forced = 'background'; applyPreviewLayers(); }
        show();
        input.select();
    });
    input.addEventListener('blur', () => {
        if (hatch && state.preview.forced) { state.preview.forced = null; applyPreviewLayers(); }
        show();
    });

    // beforeinput sees the text on its way in, so a rejected character never
    // reaches the field and the caret does not jump.
    input.addEventListener('beforeinput', (e) => {
        if (e.data != null && !/^\d+$/.test(e.data)) e.preventDefault();
    });

    input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '');
        if (digits !== input.value) input.value = digits;
        if (digits === '') return;      // mid-edit, wait for a number
        commit(Number(digits));
    });

    input.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowUp' ? 1 : (e.key === 'ArrowDown' ? -1 : 0);
        if (!dir) return;
        e.preventDefault();
        commit(state.params[key] + dir * (e.shiftKey ? 10 : 1));
        show();
        input.select();
    });

    show();
}

FIELDS.forEach(setUpField);

// ---------------------------------------------------------------- sidebar resize

ui.resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ui.resizeHandle.setPointerCapture(e.pointerId);
    document.body.classList.add('is_resizing');

    const startX = e.clientX;
    const startWidth = ui.sidebar.getBoundingClientRect().width;
    const min = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-min')) || 360;

    const onMove = (ev) => {
        const width = Math.max(min, Math.min(window.innerWidth - 200, startWidth + ev.clientX - startX));
        ui.sidebar.style.width = `${width}px`;
        sizeAllFields();
    };
    const onUp = () => {
        document.body.classList.remove('is_resizing');
        ui.resizeHandle.removeEventListener('pointermove', onMove);
        ui.resizeHandle.removeEventListener('pointerup', onUp);
    };
    ui.resizeHandle.addEventListener('pointermove', onMove);
    ui.resizeHandle.addEventListener('pointerup', onUp);
});

// ---------------------------------------------------------------- export

ui.download.addEventListener('click', async () => {
    if (!state.output) return;

    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const opts = {
                suggestedName: state.fileName || 'object.svg',
                types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }],
            };
            // Opens the dialog in the folder the original file came from.
            if (state.fileHandle) opts.startIn = state.fileHandle;
            const handle = await window.showSaveFilePicker(opts);
            const writable = await handle.createWritable();
            await writable.write(state.output);
            await writable.close();
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            console.error(err);
            // Fall through to a plain download.
        }
    }

    const blob = new Blob([state.output], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = state.fileName || 'object.svg';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
});

ui.copy.addEventListener('click', async () => {
    if (!state.output) return;
    try {
        await navigator.clipboard.writeText(state.output);
    } catch (err) {
        console.error(err);
        showError('Не удалось скопировать код в буфер обмена.');
    }
});

// First paint: the empty s0, expanded and ready to be typed into.
state.subjects[0].isOpen = true;
paintSlider();
rebuild();
renderSubList();

// Signals that the module finished wiring up, for automated checks.
document.body.dataset.ready = "true";
