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
    topPadding: 0,              // and above it, if the toolbar asks for any
    objectType: 'dynamic',      // 'dynamic' or 'static' - which template is built
    // Where a static object sits in the area it is aligned in. Every pair of
    // these is one of the nine the toolbar offers.
    alignH: 'center',           // 'left' | 'center' | 'right'
    alignV: 'middle',           // 'top' | 'middle' | 'bottom'
    alignMargin: 0,             // taken off the right edge of that area
};

/**
 * The static object's document, which is a fixed frame rather than a measured
 * one: KOMPAKS draws its own furniture into a page of this size, so the box
 * never changes and the drawing is moved into it instead of the other way
 * round. These are the application's numbers, not the format's - they are
 * expected to become settings of their own.
 *
 *   width/height  the page, as every file in src_doc/examples/static has it
 *   viewX/viewY   where its viewBox starts
 *   view          the rectangle KOMPAKS draws the object in, three of whose
 *                 edges the object is aligned against
 *   captionX      where the "Источники АЭ" caption starts, which is the
 *                 fourth - the left edge of that area
 *
 * `view` and `captionX` are also written into the markup - by STATIC_LAYER_O
 * and by backgroundElem - and the two must not drift apart. The markup is kept
 * verbatim rather than built from these, so the golden test holds one against
 * the other instead.
 */
export const STATIC_DOC = {
    width: 1845,
    height: 800,
    viewX: -1,
    viewY: -1,
    view: { x: 971, y: 26, width: 860, height: 698 },
    captionX: 20,
    // Every reference file carries this, and the preview has to carry it too:
    // it decides where a box that does not fill its element is drawn inside it,
    // so a highlight layer left on the default would centre what the file puts
    // at the top and every subject would be out by the same distance.
    preserveAspectRatio: 'xMinYMin meet',
};

export const isStatic = (params) => (params || {}).objectType === 'static';

/**
 * The rectangle a static object is aligned in: the `View` rectangle KOMPAKS
 * draws the object in, reaching left as far as the caption under it, and
 * pulled in from `View`'s left edge by however much margin was asked for.
 */
export function alignArea(params) {
    const p = { ...PARAMS, ...(params || {}) };
    const v = STATIC_DOC.view;
    const x = STATIC_DOC.captionX;
    return { x, y: v.y, w: v.x - (p.alignMargin || 0) - x, h: v.height };
}

// Which end of the area an object is put against. Both axes read the same way,
// so one table answers for them: the near edge, the middle, or the far edge.
const NEAR = { left: 1, top: 1 };
const FAR = { right: 1, bottom: 1 };

/** Where an object of `extent` starts, laid against `how` of `start..start+size`. */
export function alignOffset(start, size, extent, how) {
    if (NEAR[how]) return start;
    if (FAR[how]) return start + size - extent;
    return start + (size - extent) / 2;
}

const f2 = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
const f0 = (v) => (Math.abs(v) < 0.5 ? 0 : v).toFixed(0);
// One more level in, for the block that goes inside the offset group.
const indent = (block) => block.replace(/^(?=[^\n])/gm, '    ');

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

// The static object carries text of its own, which needs two classes the
// dynamic format has no use for. Only the classes something in the file uses
// are written: Instruction.pdf 6.1 allows nothing else in.
const STATIC_STYLE = `
        <!-- text -->
        .text{font-family: "Arial"; letter-spacing: 0em;}
        <!-- src background text -->
        .text_src {fill:#FFFFFF;font-size: 32px;}`;

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
        .scale {transform:scale(${f2(p.indicatorScale)})}${isStatic(p) ? STATIC_STYLE : ''}
    </style>`;
}

/**
 * Everything the static object draws besides its subjects - lines, shapes and
 * text of any colour and size. KOMPAKS only draws what a subject layer refers
 * to, so it lives in the defs and layer_s0_background points at it.
 *
 * For now this is the one caption every static file carries. It is placed in
 * the document, not in the object, so it is given the opposite of the shift
 * that moves the subject group and stays where it is however far the object
 * travels.
 */
function backgroundElem(shiftX, shiftY) {
    return `        <!--background-->
        <g id="background_elem">
            <g class="text text_src" transform="translate(${f2(-shiftX)} ${f2(-shiftY)})">
                <text x="20" y="765">Источники АЭ</text>
            </g>
        </g>

`;
}

/**
 * The frame KOMPAKS fills in: the rectangles it replaces with objects of its
 * own, and the arrows between them. It is the same in every static file - none
 * of it is worked out from the drawing - so it is kept here exactly as
 * src_doc/examples/static has it, self-closing tags, `#Cluster10` on Cluster1
 * and all: these files are what the third-party application reads today.
 */
const STATIC_LAYER_O = `    <g id="layer_o"
     style="display:inline"
     inkscape:groupmode="layer"
     inkscape:label="layer_o">
        <g id="layer_o_background"
        style="display:inline"
        inkscape:label="layer_o_background"
        inkscape:groupmode="layer">
            <path id="strela"
                class="icon_w" d="M244.65,730v45h35v-45h-35ZM277.65,773h-31v-41h31v41ZM267.95,762.2l-13.6-9.5,13.6-9.8v19.3Z"/>
            <path id="strela-5"
                class="icon_w" d="M1823,775v-45h-35v45h35ZM1790,732h31v41h-31v-41ZM1799.7,742.8l13.6,9.5-13.6,9.8v-19.3Z"/>
            <g id="layer_o_background_off"
                style="display:inline"
                inkscape:groupmode="layer"
                inkscape:label="layer_o_background_off"></g>
            <g id="layer_o_background_on"
                style="display:inline"
                inkscape:groupmode="layer"
                inkscape:label="layer_o_background_on"></g>
            <rect id="View"
                style="display:inline"
                class="frame"
                x="971" y="26" width="860" height="698"/>
            <rect id="Cluster0"
                inkscape:label="#Cluster0"
                style="display:inline"
                class="frame"
                x="283.65" y="730" width="184" height="45"/>
            <rect id="Cluster1"
                inkscape:label="#Cluster10"
                style="display:inline"
                class="frame"
                x="471.7" y="730" width="184" height="45"/>
            <rect id="Cluster2"
                inkscape:label="#Cluster2"
                style="display:inline"
                class="frame"
                x="659.75" y="730" width="184" height="45"/>
            <rect id="Cluster3"
                inkscape:label="#Cluster3"
                style="display:inline"
                class="frame"
                x="847.8" y="730" width="184" height="45"/>
            <rect id="Cluster4"
                inkscape:label="#Cluster4"
                style="display:inline"
                class="frame"
                x="1035.85" y="730" width="184" height="45"/>
            <rect id="Cluster5"
                inkscape:label="#Cluster5"
                style="display:inline"
                class="frame"
                x="1223.9" y="730" width="184" height="45"/>
            <rect id="Cluster6"
                inkscape:label="#Cluster6"
                style="display:inline"
                class="frame"
                x="1411.95" y="730" width="184" height="45"/>
            <rect id="Cluster7"
                inkscape:label="#Cluster7"
                style="display:inline"
                class="frame"
                x="1600" y="730" width="184" height="45"/>
            <rect id="tbtClusterLeft"
                inkscape:label="#tbtClusterLeft"
                style="display:inline"
                class="frame"
                x="244.65" y="730" width="35" height="45"/>
            <rect id="tbtClusterRight"
                inkscape:label="#tbtClusterRight"
                style="display:inline"
                class="frame"
                x="1788" y="730" width="35" height="45"/>
            <rect id="Subject"
                class="frame"
                x="1" y="1" width="1845" height="800"/>
        </g>
    </g>

`;

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

function subjectLayer(n, ind, background) {
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
            <use xlink:href="#layer_s${n}_fill" class="st_out"></use>${background ? `
            <use xlink:href="#background_elem"></use>` : ''}
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

export const INDICATOR_KEYS = ['oldRepair', 'oldLock', 'oldSost', 'fail', 'insert'];

/**
 * How far each indicator has been nudged from the place the format puts it,
 * in file units. A subject that has never been adjusted reads as zeros.
 */
export function indicatorOffsets(subject) {
    const o = (subject && subject.indicatorOffsets) || {};
    const at = (v) => ({
        x: Number.isFinite((v || {}).x) ? v.x : 0,
        y: Number.isFinite((v || {}).y) ? v.y : 0,
    });
    const out = {};
    for (const key of INDICATOR_KEYS) out[key] = at(o[key]);
    return out;
}

/**
 * Corner and centre placement, Instruction.pdf 5.5, plus whatever the subject's
 * indicators have been nudged by. It is given the subject's own rectangle: the
 * indicators belong to the subject, so moving its click area leaves them where
 * they are.
 */
export function indicatorPositions(frame, p, offsets) {
    const d = p.indicatorDiameter * p.indicatorScale;
    const o = offsets || indicatorOffsets(null);
    const at = (key, x, y) => ({ x: x + o[key].x, y: y + o[key].y });
    return {
        oldRepair: at('oldRepair', frame.x, frame.y),                              // top-left
        oldLock: at('oldLock', frame.x + frame.w - d, frame.y),                    // top-right
        oldSost: at('oldSost', frame.x, frame.y + frame.h - d),                    // bottom-left
        fail: at('fail', frame.x + frame.w - d, frame.y + frame.h - d),            // bottom-right
        insert: at('insert', frame.x + frame.w / 2 - d / 2, frame.y + frame.h / 2 - d / 2),
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
        const a = clickArea(s);
        const o = indicatorOffsets(s);
        // Nothing drawn yet: a zero frame, left out of the bounds below, but
        // still carrying everything the builder reads off a frame.
        if (!b) {
            const zero = { x: 0, y: 0, w: 0, h: 0 };
            return { ...zero, base: { ...zero }, indicators: indicatorPositions(zero, p, o), offsets: o, empty: true };
        }
        const base = { x: b.x - half, y: b.y - half, w: b.w + p.stOutWidth, h: b.h + p.stOutWidth };
        return {
            x: base.x - a.left,
            y: base.y - a.top,
            w: base.w + a.left + a.right,
            h: base.h + a.top + a.bottom,
            base,
            // Worked out here so the file and the preview cannot disagree about
            // where an indicator is.
            indicators: indicatorPositions(base, p, o),
            offsets: o,
        };
    });

    // Both rectangles count: a click area pushed outside its subject grows the
    // document, one pulled inside it cannot shrink the document and cut the
    // drawing off, because the subject is still drawn where it always was.
    // A nudged indicator counts too, for the same reason - at its own place it
    // is inside the subject already, so this only ever grows.
    const d = p.indicatorDiameter * p.indicatorScale;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of frames) {
        if (f.empty) continue;
        const boxes = [f, f.base];
        for (const key of INDICATOR_KEYS) {
            if (!f.offsets[key].x && !f.offsets[key].y) continue;
            boxes.push({ x: f.indicators[key].x, y: f.indicators[key].y, w: d, h: d });
        }
        for (const r of boxes) {
            minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
        }
    }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

    const objW = maxX - minX;
    const objH = maxY - minY;

    // The document, and how far the object is moved inside it. x/y/w/h stay the
    // artwork's own throughout - that is what the hatch is measured on and what
    // the click areas and indicators are worked out in - while viewX/viewY/
    // viewW/viewH are the page the preview draws and fileViewBox is the same
    // page as the file writes it.
    //
    // The two differ by the shift, and only by that. KOMPAKS takes the size of
    // the viewBox but ignores where it starts, so a box that began above the
    // artwork would draw the subjects from the top of itself and put the space
    // meant to be above the object underneath it. The file therefore never
    // moves its box; it moves the object, which buildSvg writes as an inline
    // transform on a group around the layers. Because the two boxes are the
    // same size, a point of the artwork lands on the same place on screen in
    // both, which is what keeps the highlight layers on the drawing.
    let viewX, viewY, viewW, viewH, fileViewX, fileViewY, shiftX, shiftY;
    if (isStatic(p)) {
        // A fixed page that the object is placed into, at whichever end of the
        // alignment area the toolbar asks for. The two offsets are about a
        // document that grows, so they have nothing to do here.
        const area = alignArea(p);
        viewW = STATIC_DOC.width;
        viewH = STATIC_DOC.height;
        fileViewX = STATIC_DOC.viewX;
        fileViewY = STATIC_DOC.viewY;
        shiftX = alignOffset(area.x, area.w, objW, p.alignH) - minX;
        shiftY = alignOffset(area.y, area.h, objH, p.alignV) - minY;
        viewX = fileViewX - shiftX;
        viewY = fileViewY - shiftY;
    } else {
        // The artwork with the two offsets around it. The box starts at the
        // artwork's own top, and an artwork that begins above zero is rebased
        // the same way, so no coordinate in the file is ever negative.
        viewW = objW;
        viewH = objH + p.topPadding + p.bottomPadding;
        viewX = minX;
        viewY = minY - p.topPadding;
        fileViewX = minX;
        fileViewY = Math.max(0, minY);
        shiftX = 0;
        shiftY = fileViewY + p.topPadding - minY;
    }

    return {
        p, frames, x: minX, y: minY, w: objW, h: objH,
        // The document's own coordinates: what the preview highlights, the
        // offset bands and the border drags all work in.
        viewX, viewY, viewW, viewH,
        viewBox: `${f2(viewX)} ${f2(viewY)} ${f2(viewW)} ${f2(viewH)}`,
        // What the file's <svg> will carry, so that anything drawn over the
        // file can be given the same and land on it.
        preserveAspectRatio: isStatic(p) ? STATIC_DOC.preserveAspectRatio : null,
        // The file's, which differ by the shift and only ever by that.
        fileViewX, fileViewY, shiftX, shiftY,
        fileViewBox: `${f2(fileViewX)} ${f2(fileViewY)} ${f2(viewW)} ${f2(viewH)}`,
    };
}

/**
 * @param {{fill:string, strokeIn:string, fillBBox:object}[]} subjects
 * @returns {string} the complete SVG document
 */
export function buildSvg(subjects, params) {
    const layout = computeLayout(subjects, params);
    const { p, frames, w: objW, h: objH, viewW, viewH, shiftX, shiftY } = layout;
    // The file's box, not the document's: see computeLayout. Everything written
    // below is in the file's coordinates.
    const viewX = layout.fileViewX;
    const viewY = layout.fileViewY;
    const staticDoc = isStatic(p);

    const set = indicatorSet(p);

    // The hatch is computed on the artwork only, before the bottom padding.
    const hatch = computeHatch(objW, objH, p);

    const stops = hatch.stops
        .map((s) => `            <stop offset="${s.offset.toFixed(2)}%" class="${s.cls}"></stop>`)
        .join('\n');

    const defs = subjects
        .map((s, i) => roleDefs(i, frames[i], s.fill, s.strokeIn))
        .join('');

    // Only s0 carries the background: KOMPAKS draws nothing that no subject
    // layer refers to, and one reference is enough to have it drawn.
    const layers = subjects
        .map((s, i) => subjectLayer(i, frames[i].indicators, staticDoc && i === 0))
        .join('');

    // Where the object sits in the document, as an inline transform - a class
    // would not do, KOMPAKS does not read the stylesheet for this. For a
    // dynamic object this is the space asked for above it; for a static one it
    // is the corner the drawing is placed in. layer_o stays outside the group
    // either way: its rectangles are the document, not the object moving
    // inside it.
    const body = (shiftX || shiftY)
        ? `    <g transform="translate(${f2(shiftX)} ${f2(shiftY)})">
${indent(layers)}    </g>

`
        : layers;

    // The static object's own furniture comes before the subjects, as every
    // file in src_doc/examples/static has it; the dynamic one's box comes after
    // them, as Instruction.pdf 6.2 has it.
    const layerO = staticDoc ? STATIC_LAYER_O : `    <g id="layer_o" inkscape:label="layer_o" style="display:inline">
        <g id="layer_o_background" inkscape:label="layer_o_background" style="display:inline">
            <g id="layer_o_background_off" inkscape:label="layer_o_background_off" style="display:inline"></g>
            <g id="layer_o_background_on" inkscape:label="layer_o_background_on" style="display:inline"></g>
            <rect width="${f2(viewW)}" height="${f2(viewH)}" x="${f2(viewX)}" y="${f2(viewY)}" style="fill:none"></rect>
        </g>
    </g>

`;

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${layout.fileViewBox}" width="${f2(viewW)}" height="${f2(viewH)}"${layout.preserveAspectRatio ? ` preserveAspectRatio="${layout.preserveAspectRatio}"` : ''}>
${styleBlock(p, set)}

    <defs>
${staticDoc ? backgroundElem(shiftX, shiftY) : ''}        <!--gradient-->
        <linearGradient id="linear_grad" x1="${f0(hatch.x1)}" x2="${f0(hatch.x2)}" y1="${f0(hatch.y1)}" y2="${f0(hatch.y2)}" gradientUnits="userSpaceOnUse">
${stops}
        </linearGradient>

${defs}${set.icons}
    </defs>

${staticDoc ? layerO + body : body + layerO}</svg>`;
}
