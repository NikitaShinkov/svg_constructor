// Builds the KOMPAKS-format SVG as a plain string.
//
// The output is assembled from templates rather than serialised from a live DOM,
// so the preview and the exported file can never drift apart, and none of the
// old constructor's clean-up regexes are needed.
//
// Structure and naming follow Instruction.pdf sections 6.2-6.24 and the
// reference files in src_doc/examples.

import { INDICATORS } from './indicators.js';

export const PARAMS = {
    indicatorDiameter: 45,      // section 6.13, 45px variant
    indicatorScale: 1,
    stInWidth: 2,               // internal lines
    stOutWidth: 2,              // outer outline
    hatchAngle: 45,
    hatchLineWidth: 4,
    hatchCoverage: 30,          // percent of the period covered by the grey stripe
    bottomPadding: 70,          // empty space added below the object
};

const f2 = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
const f0 = (v) => (Math.abs(v) < 0.5 ? 0 : v).toFixed(0);

/** Gradient vector for the hatched "Reserve" background. */
export function hatchVector(width, height, angleDeg) {
    const angle = Math.max(0, Math.min(180, angleDeg));
    if (angle === 0) return { x1: width, y1: 0, x2: 0, y2: 0, length: width };
    if (angle === 180) return { x1: 0, y1: 0, x2: width, y2: 0, length: width };
    if (angle === 90) return { x1: width, y1: 0, x2: width, y2: height, length: height };

    const mirrored = angle > 90;
    const rad = ((mirrored ? 180 - angle : angle) * Math.PI) / 180;
    const y2 = height + (width - height / Math.tan(rad)) * Math.sin(rad) * Math.cos(rad);
    let x2 = Math.tan(rad) * (y2 - height);
    let x1 = width;
    if (mirrored) { x1 = 0; x2 = width - x2; }
    return { x1, y1: 0, x2, y2, length: y2 / Math.sin(rad) };
}

/** Hard-edged stripe pattern: coincident stop pairs, no colour ramp. */
export function stripeStops(length, run, gap) {
    const stops = [];
    const MAX = 2000;
    let pos = 0;
    while (pos < length && stops.length < MAX) {
        stops.push({ offset: (pos / length) * 100, cls: 'bg_1' });
        stops.push({ offset: (Math.min(pos + run, length) / length) * 100, cls: 'bg_1' });
        pos += run;
        if (pos >= length) break;
        stops.push({ offset: (pos / length) * 100, cls: 'bg_2' });
        stops.push({ offset: (Math.min(pos + gap, length) / length) * 100, cls: 'bg_2' });
        pos += gap;
    }
    return stops;
}

export function computeHatch(width, height, p) {
    const lineWidth = Math.max(1, p.hatchLineWidth);
    const coverage = Math.max(1, Math.min(100, p.hatchCoverage));
    // An empty document has no area to hatch; keep the gradient well-formed.
    if (!(width > 0) || !(height > 0)) {
        return { x1: 0, y1: 0, x2: 0, y2: 0, length: 0, stops: [] };
    }
    const v = hatchVector(width, height, p.hatchAngle);
    const gap = lineWidth * (100 / coverage - 1);
    return { ...v, stops: stripeStops(v.length, lineWidth, gap) };
}

/**
 * The prepared symbol set for the chosen size. KOMPAKS ignores a `scale`
 * transform, so each size is its own set of paths rather than one set scaled.
 */
export function indicatorSet(p) {
    return INDICATORS[p.indicatorDiameter] || INDICATORS[PARAMS.indicatorDiameter];
}

function styleBlock(p, set) {
    return `    <style type="text/css">
        <!-- subject click area -->
        .frame {fill:none}
        <!-- subject background hatch fill -->
        .bg_1 {stop-color:#808080}
        .bg_2 {stop-color:#FFFFFF; stop-opacity:0;}
        .bg_grad {fill:url(#linear_grad)}
        <!-- subject inner line -->
        .st_in {fill:none;stroke-width:${f2(p.stInWidth)};stroke-miterlimit:10}
        <!-- subject inner line white -->
        .st_w {stroke:#FFFFFF}
        <!-- subject inner line black -->
        .st_b {stroke:#000000}
        <!-- subject outer line -->
        .st_out {fill:none;stroke:white;stroke-width:${f2(p.stOutWidth)};stroke-miterlimit:10}
        <!-- subject sost fill-->
        .otlichno {fill:#049B4E}
        .norm {fill:#00FF00}
        .tpm {fill:#FFF200}
        .ndp {fill:#FF0000}
        .repair {fill:#7F4124}
        <!-- indicator outer line -->
        .icons_st_out {stroke:white;stroke-width:${f2(set.strokeWidth)};stroke-miterlimit:10}
        <!-- indicator icon fill white -->
        .icon_w {fill:#FFFFFF}
        <!-- indicator icon fill black -->
        .icon_b {fill:#000000}
        <!-- indicator fail fill -->
        .fail {fill:#4B4392}
        <!-- indicator insert fill -->
        .insert {fill:#143D8F}
        <!-- indicator scale -->
        .scale {transform:scale(${f2(p.indicatorScale)})}
    </style>`;
}

/**
 * `fill` and `strokeIn` are inserted exactly as the user typed them - the app
 * never rewrites or validates what is in the code fields.
 */
function roleDefs(n, frame, fill, strokeIn) {
    const body = (markup) => (markup ? `
            ${markup}
        ` : '');
    return `        <!--s${n}-->
        <g id="layer_s${n}_frame">
            <rect width="${f2(frame.w)}" height="${f2(frame.h)}" x="${f2(frame.x)}" y="${f2(frame.y)}"></rect>
        </g>
        
        <g id="layer_s${n}_fill">${body(fill)}</g>
        
        <g id="layer_s${n}_stroke_in">${body(strokeIn)}</g>
        
`;
}

// Inner lines are black only for the two light states, per Instruction.pdf 5.4.
const STATES = [
    ['otlichno', 'st_w'],
    ['norm', 'st_b'],
    ['tpm', 'st_b'],
    ['ndp', 'st_w'],
    ['repair', 'st_w'],
];

function subjectLayer(n, ind) {
    const states = STATES.map(([state, lineClass]) => `            <g id="layer_s${n}_${state}" inkscape:label="layer_s${n}_${state}" style="display:inline">
                <use xlink:href="#layer_s${n}_fill" class="${state}"></use>
                <use xlink:href="#layer_s${n}_stroke_in" class="st_in ${lineClass}"></use>
                <use xlink:href="#layer_s${n}_fill" class="st_out"></use>
            </g>`).join('\n');

    const oldSost = ['otlichno', 'norm', 'tpm', 'ndp'].map((state) => `            <g id="layer_s${n}_old_${state}" inkscape:label="layer_s${n}_old_${state}" style="display:inline">
                <use xlink:href="#circle" class="${state}" x="${f2(ind.oldSost.x)}" y="${f2(ind.oldSost.y)}"></use>
            </g>`).join('\n');

    const oldLock = ['norm', 'tpm', 'ndp'].map((state) => `           <g id="layer_s${n}_old_lock_${state}" inkscape:label="layer_s${n}_old_lock_${state}" style="display:inline">
               <use xlink:href="#old_lock_${state}" x="${f2(ind.oldLock.x)}" y="${f2(ind.oldLock.y)}"></use>
           </g>`).join('\n');

    return `    <g id="layer_s${n}" inkscape:label="layer_s${n}" style="display:inline">
        <g id="layer_s${n}_background" inkscape:label="layer_s${n}_background" style="display:inline">
            <use id="Subject${n}" xlink:href="#layer_s${n}_frame" class="frame"></use>
            <use xlink:href="#layer_s${n}_fill" class="bg_grad"></use>
            <use xlink:href="#layer_s${n}_stroke_in" class="st_in st_w"></use>
            <use xlink:href="#layer_s${n}_fill" class="st_out"></use>
        </g>

        <g id="layer_s${n}_sost" inkscape:label="layer_s${n}_sost" style="display:inline">
${states}
        </g>

        <g id="layer_s${n}_fail" inkscape:label="layer_s${n}_fail" style="display:inline">
            <use xlink:href="#fail" x="${f2(ind.fail.x)}" y="${f2(ind.fail.y)}"></use>
        </g>

        <g id="layer_s${n}_old_sost" inkscape:label="layer_s${n}_old_sost" style="display:inline">
${oldSost}
        </g>

        <g id="layer_s${n}_old_repair" inkscape:label="layer_s${n}_old_repair" style="display:inline">
            <use xlink:href="#old_repair" x="${f2(ind.oldRepair.x)}" y="${f2(ind.oldRepair.y)}"></use>
        </g>

        <g id="layer_s${n}_old_lock" inkscape:label="layer_s${n}_old_lock" style="display:inline">
${oldLock}
        </g>

        <g id="layer_s${n}_insert" inkscape:label="layer_s${n}_insert" style="display:inline">
           <use xlink:href="#insert" x="${f2(ind.insert.x)}" y="${f2(ind.insert.y)}"></use>
        </g>
    </g>

`;
}

/**
 * How far each border of a subject's click area sits outside the subject
 * itself, in file units. Positive grows the area, negative eats into it; a
 * subject that has never been adjusted has none of this and reads as zeros.
 */
export function clickArea(subject) {
    const a = (subject && subject.clickArea) || {};
    const px = (v) => (Number.isFinite(v) ? v : 0);
    return { top: px(a.top), right: px(a.right), bottom: px(a.bottom), left: px(a.left) };
}

/**
 * Corner and centre placement, Instruction.pdf 5.5. It is given the subject's
 * own rectangle: the indicators belong to the subject, so moving its click
 * area leaves them where they are.
 */
export function indicatorPositions(frame, p) {
    const d = p.indicatorDiameter * p.indicatorScale;
    return {
        oldRepair: { x: frame.x, y: frame.y },                                     // top-left
        oldLock: { x: frame.x + frame.w - d, y: frame.y },                         // top-right
        oldSost: { x: frame.x, y: frame.y + frame.h - d },                         // bottom-left
        fail: { x: frame.x + frame.w - d, y: frame.y + frame.h - d },              // bottom-right
        insert: { x: frame.x + frame.w / 2 - d / 2, y: frame.y + frame.h / 2 - d / 2 },
    };
}

/**
 * Subject frames and the box they are laid out in. The preview highlights read
 * the same numbers as the file, so the two can never point at different places.
 *
 * @param {{fillBBox:object, strokeBBox:object}[]} subjects
 */
export function computeLayout(subjects, params) {
    const p = { ...PARAMS, ...(params || {}) };
    const half = p.stOutWidth / 2;

    // The frame is the fill silhouette's bounding box grown by the outer stroke,
    // which is what the reference files contain, and then by the subject's own
    // click area offsets - what KOMPAKS treats as the clickable rectangle is
    // the only thing they move. `base` is the subject's own rectangle, which is
    // what the offsets are measured from and what the indicators are hung on. A
    // subject with no geometry yet (just added in the sidebar) gets a zero frame
    // and is left out of the overall bounds, so it cannot drag the viewBox around.
    const frames = subjects.map((s) => {
        const b = s.fillBBox || s.strokeBBox;
        if (!b) return { x: 0, y: 0, w: 0, h: 0, base: { x: 0, y: 0, w: 0, h: 0 }, empty: true };
        const a = clickArea(s);
        const base = { x: b.x - half, y: b.y - half, w: b.w + p.stOutWidth, h: b.h + p.stOutWidth };
        return {
            x: base.x - a.left,
            y: base.y - a.top,
            w: base.w + a.left + a.right,
            h: base.h + a.top + a.bottom,
            base,
        };
    });

    // Both rectangles count: a click area pushed outside its subject grows the
    // document, one pulled inside it cannot shrink the document and cut the
    // drawing off, because the subject is still drawn where it always was.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of frames) {
        if (f.empty) continue;
        for (const r of [f, f.base]) {
            minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
        }
    }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

    const objW = maxX - minX;
    const objH = maxY - minY;
    const viewH = objH + p.bottomPadding;
    return {
        p, frames, x: minX, y: minY, w: objW, h: objH, viewH,
        // The preview highlights reuse this string, so their coordinate system
        // is the file's own, down to the rounding.
        viewBox: `${f2(minX)} ${f2(minY)} ${f2(objW)} ${f2(viewH)}`,
    };
}

/**
 * @param {{fill:string, strokeIn:string, fillBBox:object}[]} subjects
 * @returns {string} the complete SVG document
 */
export function buildSvg(subjects, params) {
    const layout = computeLayout(subjects, params);
    const { p, frames, w: objW, h: objH, viewH } = layout;
    const minX = layout.x;
    const minY = layout.y;

    const set = indicatorSet(p);

    // The hatch is computed on the artwork only, before the bottom padding.
    const hatch = computeHatch(objW, objH, p);

    const stops = hatch.stops
        .map((s) => `            <stop offset="${s.offset.toFixed(2)}%" class="${s.cls}"></stop>`)
        .join('\n');

    const defs = subjects
        .map((s, i) => roleDefs(i, frames[i], s.fill, s.strokeIn))
        .join('');

    const layers = subjects
        .map((s, i) => subjectLayer(i, indicatorPositions(frames[i].base, p)))
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${layout.viewBox}" width="${f2(objW)}" height="${f2(viewH)}">
${styleBlock(p, set)}

    <defs>
        <!--gradient-->
        <linearGradient id="linear_grad" x1="${f0(hatch.x1)}" x2="${f0(hatch.x2)}" y1="${f0(hatch.y1)}" y2="${f0(hatch.y2)}" gradientUnits="userSpaceOnUse">
${stops}
        </linearGradient>

${defs}${set.icons}
    </defs>

${layers}    <g id="layer_o" inkscape:label="layer_o" style="display:inline">
        <g id="layer_o_background" inkscape:label="layer_o_background" style="display:inline">
            <g id="layer_o_background_off" inkscape:label="layer_o_background_off" style="display:inline"></g>
            <g id="layer_o_background_on" inkscape:label="layer_o_background_on" style="display:inline"></g>
            <rect width="${f2(objW)}" height="${f2(viewH)}" x="${f2(minX)}" y="${f2(minY)}" style="fill:none"></rect>
        </g>
    </g>

</svg>`;
}
