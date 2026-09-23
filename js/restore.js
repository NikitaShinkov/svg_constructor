// Reads a file this application wrote and puts the editor back where it was.
//
// `detect.js` answers a different question - which shape in an editor's export
// is a silhouette and which is line art - and it cannot read our own output at
// all: everything drawable lives in <defs>, so the only shape it finds outside
// them is the full-bleed rect of layer_o, which it throws away as a background.
//
// Here the structure is known, so nothing has to be guessed: the file is read
// back through the same formulas template.js wrote it with. Everything the
// toolbar and the sidebar can change is stored somewhere in the file, and each
// of them is recovered by inverting the one place that wrote it:
//
//   .st_in / .st_out stroke-width   -> the two line widths
//   #circle's cx, .icons_st_out     -> which prepared indicator set was used
//   .scale                          -> the indicator scale
//   <linearGradient> and its stops  -> hatch angle, line width and coverage
//   layer_sN_frame's <rect>         -> that subject's click area, against the
//                                      silhouette's own bounding box
//   the indicator <use> x/y         -> that indicator's nudge, against the
//                                      place Instruction.pdf 5.5 puts it
//   viewBox and the layers' offset  -> the two document offsets
//
// Nothing here rewrites geometry: the markup inside layer_sN_fill and
// layer_sN_stroke_in is lifted out of the text as it stands, so a file that is
// loaded and exported again comes back the way it went in.

import { parseGeometryFragment } from './detect.js';
import {
    PARAMS, INDICATOR_KEYS, indicatorPositions, computeLayout, hatchVector,
    STATIC_DOC, alignArea, alignOffset,
} from './template.js';
import { INDICATORS, INDICATOR_SIZES } from './indicators.js';

/** The group under layer_sN that holds each indicator's <use>. */
const INDICATOR_GROUPS = {
    oldRepair: 'old_repair',
    oldLock: 'old_lock',
    oldSost: 'old_sost',
    fail: 'fail',
    insert: 'insert',
};

// The ranges the toolbar fields hold their numbers in (index.html data-min/max),
// repeated here so a hand-edited file cannot put the state out of their reach.
const RANGE = {
    stOutWidth: [0, 99],
    stInWidth: [0, 99],
    hatchAngle: [0, 180],
    hatchLineWidth: [1, 99],
    hatchCoverage: [1, 100],
    topPadding: [0, 9999],
    bottomPadding: [0, 9999],
};

const MAX_BORDER = 9999;    // the same limit the sidebar fields keep

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;
// The two roundings template.js writes numbers with, so a recovered value can
// be compared against what is actually in the file.
const f0 = (v) => Number((Math.abs(v) < 0.5 ? 0 : v).toFixed(0));

function num(value, fallback) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * The text inside `<g id="...">...</g>`, taken out of the source as it stands.
 * Serialising the parsed element instead would re-quote attributes and
 * self-close empty tags, neither of which the format allows.
 */
function groupInner(text, id) {
    const open = new RegExp(`<g\\s+id="${id}"[^>]*>`).exec(text);
    if (!open) return null;
    const start = open.index + open[0].length;
    const tags = /<(\/?)g\b([^>]*)>/g;
    tags.lastIndex = start;
    let depth = 1;
    let m;
    while ((m = tags.exec(text)) !== null) {
        if (/\/\s*$/.test(m[2])) continue;          // <g .../>, opened and closed
        depth += m[1] ? -1 : 1;
        if (depth === 0) return text.slice(start, m.index);
    }
    return null;
}

/**
 * Drops the newline and indent the builder puts around the markup, and nothing
 * else - trailing spaces on the markup's own line are part of what was written
 * and are kept, so a reference file survives the round trip byte for byte.
 */
function stripIndent(inner) {
    return inner.replace(/^\r?\n[ \t]*/, '').replace(/\r?\n[ \t]*$/, '');
}

/** The markup of one defs group, from the text if possible, from the DOM if not. */
function markupOf(doc, text, id) {
    const raw = groupInner(text, id);
    if (raw !== null) return stripIndent(raw);
    const el = doc.querySelector(`[id="${id}"]`);
    if (!el) return '';
    const ser = new XMLSerializer();
    return Array.from(el.children).map((c) => ser.serializeToString(c)).join('');
}

/** The nearest prepared indicator size, since only those can be rebuilt. */
function nearestSize(diameter) {
    return INDICATOR_SIZES.reduce((a, b) =>
        (Math.abs(b - diameter) < Math.abs(a - diameter) ? b : a));
}

/**
 * Which set of indicator symbols the file carries. `#circle` is drawn at the
 * size's own coordinates (cx = D/2 in every set), so it answers directly; the
 * outline width is the fallback, since each set has its own.
 */
function readIndicatorSize(doc, style) {
    const circle = doc.querySelector('[id="circle"] circle');
    if (circle) {
        const cx = num(circle.getAttribute('cx'), 0);
        if (cx > 0) return nearestSize(cx * 2);
    }
    const sw = num((/\.icons_st_out\s*\{[^}]*stroke-width\s*:\s*([\d.]+)/.exec(style) || [])[1], 0);
    if (sw > 0) {
        let best = PARAMS.indicatorDiameter;
        let gap = Infinity;
        for (const size of INDICATOR_SIZES) {
            const d = Math.abs(INDICATORS[size].strokeWidth - sw);
            if (d < gap) { gap = d; best = size; }
        }
        return best;
    }
    return PARAMS.indicatorDiameter;
}

/**
 * The hatch, read back out of the gradient it was written into.
 *
 * The vector is written with no decimals, so the angle is found by trying the
 * ones the field can hold and keeping whichever writes the file's four numbers.
 * The stops then give the stripe: the first pair ends one line width along the
 * vector, and the second starts one full period along it.
 */
function readHatch(grad, width, height) {
    if (!grad || !(width > 0) || !(height > 0)) return {};
    const want = {
        x1: num(grad.getAttribute('x1'), NaN),
        y1: num(grad.getAttribute('y1'), NaN),
        x2: num(grad.getAttribute('x2'), NaN),
        y2: num(grad.getAttribute('y2'), NaN),
    };
    if (!Number.isFinite(want.x1) || !Number.isFinite(want.x2) || !Number.isFinite(want.y2)) return {};

    let angle = PARAMS.hatchAngle;
    let best = Infinity;
    for (let a = RANGE.hatchAngle[0]; a <= RANGE.hatchAngle[1]; a++) {
        const v = hatchVector(width, height, a);
        const err = ['x1', 'y1', 'x2', 'y2']
            .reduce((sum, k) => sum + (f0(v[k]) - want[k]) ** 2, 0);
        if (err < best) { best = err; angle = a; if (!err) break; }
    }

    const out = { hatchAngle: angle };
    const length = hatchVector(width, height, angle).length;
    const offsets = Array.from(grad.querySelectorAll('stop'))
        .map((s) => num(s.getAttribute('offset'), NaN));
    if (length > 0 && offsets.length >= 2 && offsets.every(Number.isFinite)) {
        const run = (offsets[1] / 100) * length;
        // With coverage at 100 there is no gap and no third pair: the period is
        // the stripe itself.
        const period = offsets.length >= 4 ? (offsets[3] / 100) * length : run;
        out.hatchLineWidth = clamp(Math.round(run) || 1, ...RANGE.hatchLineWidth);
        out.hatchCoverage = period > 0
            ? clamp(Math.round((100 * run) / period), ...RANGE.hatchCoverage)
            : RANGE.hatchCoverage[1];
    }
    return out;
}

/**
 * How far the layers were pushed down, or null when nothing pushed them.
 *
 * KOMPAKS ignores a negative viewBox origin, so the space above the object is
 * written as an inline transform on a group around the layers rather than into
 * the box (template.js). A file written before that carried it in the origin
 * instead, and reads back as no transform at all.
 */
function readTopShift(svgEl) {
    const shift = readShift(svgEl);
    return shift ? shift.y : null;
}

/** Both numbers of that same transform, or null when there is no group. */
function readShift(svgEl) {
    for (const el of Array.from(svgEl.children)) {
        if (el.tagName.toLowerCase() !== 'g' || el.getAttribute('id')) continue;
        const m = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)/.exec(el.getAttribute('transform') || '');
        if (m) return { x: num(m[1], 0), y: num(m[2], 0) };
    }
    return null;
}

// The nine the toolbar offers, in the order it offers them: the middle first,
// then the four sides, then the four corners. Where more than one of them would
// write the same transform, the first is the one taken.
const ALIGNMENTS = [
    ['center', 'middle'],
    ['center', 'top'], ['right', 'middle'], ['center', 'bottom'], ['left', 'middle'],
    ['left', 'top'], ['right', 'top'], ['right', 'bottom'], ['left', 'bottom'],
];

/**
 * Where a static object was laid, read back out of the transform that laid it.
 *
 * `alignOffset` is the one formula that wrote it, so each of the nine is simply
 * tried: first as the file could have been written with no margin at all, and
 * then, for the two alignments a margin can move, solving for the margin that
 * would put the object where the file has it. The margin is a whole number of
 * pixels - the field holds nothing else - so a solution is rounded before it is
 * checked, and kept only if it writes the transform the file carries.
 *
 * A static file that this application did not write - every reference in
 * src_doc/examples/static was drawn in place - matches none of them and is left
 * on the defaults, exactly as it was before there was anything to read.
 */
function readAlignment(shift, box) {
    if (!shift || !(box.w > 0) || !(box.h > 0)) return {};
    const view = STATIC_DOC.view;
    const fits = (a, b) => Math.abs(a - b) < 0.01;

    const shiftFor = (alignH, alignV, alignMargin) => {
        const area = alignArea({ alignMargin });
        return {
            x: alignOffset(area.x, area.w, box.w, alignH) - box.x,
            y: alignOffset(area.y, area.h, box.h, alignV) - box.y,
        };
    };

    // The margin that would put the object's left edge where the file has it.
    // It moves the right edge of the area in, so it reaches an object laid
    // against that edge in full and a centred one by half.
    const marginFor = (alignH) => {
        const want = shift.x + box.x;                       // the object's left edge
        if (alignH === 'right') return view.x - box.w - want;
        if (alignH === 'center') return view.x - STATIC_DOC.captionX - box.w - 2 * (want - STATIC_DOC.captionX);
        return 0;                                           // 'left' does not move with it
    };

    for (const margin of [0, null]) {
        for (const [alignH, alignV] of ALIGNMENTS) {
            const alignMargin = margin === null ? Math.round(marginFor(alignH)) : 0;
            if (alignMargin < 0 || alignMargin > MAX_BORDER) continue;
            const got = shiftFor(alignH, alignV, alignMargin);
            if (fits(got.x, shift.x) && fits(got.y, shift.y)) return { alignH, alignV, alignMargin };
        }
    }
    return {};
}

/** The four numbers of a viewBox, or null. */
function readViewBox(svgEl) {
    const parts = (svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

/**
 * True when the document is one of ours: the format's own defs and layers, not
 * an export from a vector editor.
 */
export function isTemplateDocument(doc) {
    return !!(doc.querySelector('[id="layer_s0_frame"]')
        && doc.querySelector('[id="layer_s0"]')
        && doc.querySelector('[id="layer_o"]'));
}

/**
 * Which of the two templates the file was built from. The static one is the
 * one with a frame KOMPAKS fills in - the `View` rectangle inside layer_o -
 * and a background of its own in the defs.
 */
function isStaticDocument(doc) {
    return !!(doc.querySelector('[id="layer_o"] [id="View"]')
        && doc.querySelector('[id="background_elem"]'));
}

/**
 * Reads a KOMPAKS file this application could have written.
 *
 * @param {string} svgText
 * @returns {{subjects: object[], params: object}|null} null when the file is
 *   not in our format and the editor's own detection should have it instead.
 */
export function restoreDocument(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') return null;
    if (!isTemplateDocument(doc)) return null;

    const style = (doc.querySelector('style') || {}).textContent || '';
    const styleWidth = (cls) => {
        const m = new RegExp(`\\.${cls}\\s*\\{[^}]*stroke-width\\s*:\\s*([\\d.]+)`).exec(style);
        return m ? parseFloat(m[1]) : null;
    };

    const params = { ...PARAMS };
    params.objectType = isStaticDocument(doc) ? 'static' : 'dynamic';
    const out = styleWidth('st_out');
    const inner = styleWidth('st_in');
    if (out !== null) params.stOutWidth = clamp(out, ...RANGE.stOutWidth);
    if (inner !== null) params.stInWidth = clamp(inner, ...RANGE.stInWidth);
    const scale = (/\.scale\s*\{[^}]*transform\s*:\s*scale\(\s*([\d.]+)/.exec(style) || [])[1];
    if (scale !== undefined) params.indicatorScale = parseFloat(scale) || PARAMS.indicatorScale;
    params.indicatorDiameter = readIndicatorSize(doc, style);

    const half = params.stOutWidth / 2;

    const subjects = [];
    for (let n = 0; doc.querySelector(`[id="layer_s${n}"]`); n++) {
        const fill = markupOf(doc, svgText, `layer_s${n}_fill`);
        const strokeIn = markupOf(doc, svgText, `layer_s${n}_stroke_in`);
        const fillGeom = parseGeometryFragment(fill);
        const strokeGeom = parseGeometryFragment(strokeIn);
        const fillBBox = fillGeom ? fillGeom.bbox : null;
        const strokeBBox = strokeGeom ? strokeGeom.bbox : null;

        // The subject's own rectangle, which both the click area and the
        // indicators are measured from - exactly as computeLayout builds it.
        const b = fillBBox || strokeBBox;
        const base = b
            ? { x: b.x - half, y: b.y - half, w: b.w + params.stOutWidth, h: b.h + params.stOutWidth }
            : null;

        const clickArea = { top: 0, right: 0, bottom: 0, left: 0 };
        const rect = doc.querySelector(`[id="layer_s${n}_frame"] rect`);
        if (base && rect) {
            const frame = {
                x: num(rect.getAttribute('x'), 0),
                y: num(rect.getAttribute('y'), 0),
                w: num(rect.getAttribute('width'), 0),
                h: num(rect.getAttribute('height'), 0),
            };
            const at = (v) => clamp(round2(v), -MAX_BORDER, MAX_BORDER);
            clickArea.left = at(base.x - frame.x);
            clickArea.top = at(base.y - frame.y);
            clickArea.right = at(frame.x + frame.w - (base.x + base.w));
            clickArea.bottom = at(frame.y + frame.h - (base.y + base.h));
        }

        // Where the format would have put each indicator, against where the
        // file actually has it. Only a real nudge is kept, so an untouched
        // subject reads exactly like a freshly detected one.
        const indicatorOffsets = {};
        if (base) {
            const home = indicatorPositions(base, params);
            for (const key of INDICATOR_KEYS) {
                const use = doc.querySelector(`[id="layer_s${n}_${INDICATOR_GROUPS[key]}"] use[x]`);
                if (!use) continue;
                const dx = clamp(round2(num(use.getAttribute('x'), home[key].x) - home[key].x), -MAX_BORDER, MAX_BORDER);
                const dy = clamp(round2(num(use.getAttribute('y'), home[key].y) - home[key].y), -MAX_BORDER, MAX_BORDER);
                if (dx || dy) indicatorOffsets[key] = { x: dx, y: dy };
            }
        }

        subjects.push({
            fill, strokeIn, fillBBox, strokeBBox,
            clickArea, indicatorOffsets,
            confidence: 1,
            isOpen: false,
        });
    }
    if (!subjects.length) return null;

    // The artwork as it stands now, which is what the gradient was measured on
    // and what the viewBox was grown from. Both offsets are held at zero here:
    // they are what this layout is about to be compared against.
    const layout = computeLayout(subjects, { ...params, topPadding: 0, bottomPadding: 0 });
    Object.assign(params, readHatch(doc.querySelector('[id="linear_grad"]'), layout.w, layout.h));

    // A static document is a page of a fixed size with the object laid into an
    // area of it, so neither offset is written into it and neither is read
    // back: the transform around its layers says where the object was laid, not
    // how much room was left above it. That is what the alignment is read from.
    if (isStaticDocument(doc)) {
        Object.assign(params, readAlignment(readShift(svgEl), layout));
    }
    const view = isStaticDocument(doc) ? null : readViewBox(svgEl);
    if (view) {
        // The space above the object is whatever moved the layers down, plus
        // whatever the box starts above the artwork. One of the two is always
        // zero: the transform is what the builder writes now, the origin is
        // what it used to write, and this reads either.
        const top = clamp(round2((readTopShift(svgEl) || 0) + layout.y - view.y), ...RANGE.topPadding);
        params.topPadding = top;
        params.bottomPadding = clamp(round2(view.h - layout.h - top), ...RANGE.bottomPadding);
    }

    return { subjects, params };
}
