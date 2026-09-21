// Reads an SVG exported from a vector editor and works out, for every subject,
// which element is the fill (silhouette) and which is the internal-line art.
//
// Verified against the fixtures in src_doc/files:
//   * Illustrator - subjects are <g> groups whose id encodes the index
//     (_x30_ = "0", _x31_5 = "15", s_x5F_10 = "s_10"); paint comes from an
//     internal <style> block, fill role has a real fill, lines have fill:none.
//   * Figma - no groups and no ids at all: a background <rect> followed by
//     alternating fill/stroke <path> pairs; the root carries fill="none",
//     so the line paths simply omit the fill attribute.

import {
    parsePath, normalizePath, applyMatrix, parseTransform, matMul,
    IDENTITY, isIdentity, pathBBox, shapeToPathData, writePath,
} from './geometry.js';

const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const SKIP_TAGS = new Set([
    'defs', 'clippath', 'mask', 'filter', 'marker', 'symbol', 'pattern',
    'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata',
    'script', 'foreignobject', 'text', 'tspan', 'image',
]);

const FILL_WORDS = ['fill', 'заливка', 'залив', 'фон', 'background', 'силуэт', 'silhouette', 'плашка'];
const STROKE_WORDS = ['stroke_in', 'st_in', 'stroke', 'обводка', 'обвод', 'линии', 'линия', 'lines', 'внутр', 'inner'];
const WEAK_STROKE_WORDS = ['str', 'line', 'outline', 'контур'];

/**
 * Illustrator escapes any id character that is not XML-name-safe as _xHH_.
 * Ids that begin with a digit get the first character escaped, so a layer
 * literally named "15" is exported as id="_x31_5".
 */
export function decodeIllustratorId(id) {
    if (!id) return '';
    return id.replace(/_x([0-9A-Fa-f]{2,4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Pulls a subject index out of a layer name such as "0", "s1", "s_10", "subject 3". */
export function indexFromName(rawName) {
    const name = decodeIllustratorId(rawName).trim().toLowerCase();
    if (!name) return null;
    let m = name.match(/^s[_\-\s]?(\d{1,3})$/);
    if (m) return parseInt(m[1], 10);
    m = name.match(/^(\d{1,3})$/);
    if (m) return parseInt(m[1], 10);
    m = name.match(/^(?:layer[_\-\s]?)?s(?:ubject)?[_\-\s]?(\d{1,3})$/);
    if (m) return parseInt(m[1], 10);
    m = name.match(/^(?:субъект|суб)[_\-\s]?(\d{1,3})$/);
    if (m) return parseInt(m[1], 10);
    return null;
}

function normalizeName(s) {
    return decodeIllustratorId(s || '').toLowerCase().replace(/[\s\-.]+/g, '_');
}

function nameSignal(names) {
    const joined = names.map(normalizeName).join(' ');
    if (!joined.trim()) return null;
    for (const w of STROKE_WORDS) if (joined.includes(w)) return 1;
    for (const w of FILL_WORDS) if (joined.includes(w)) return -1;
    for (const w of WEAK_STROKE_WORDS) if (joined.includes(w)) return 0.4;
    return null;
}

/**
 * Mounts the parsed SVG inside a shadow root so that an Illustrator <style>
 * block (.st0 { fill: ... }) resolves through real CSS without its class names
 * leaking into the application's own stylesheet.
 */
function withComputedStyles(svgEl, fn) {
    const host = document.createElement('div');
    host.setAttribute('style',
        'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none');
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    const clone = svgEl.cloneNode(true);
    root.appendChild(clone);
    document.body.appendChild(host);
    try {
        return fn(clone);
    } finally {
        host.remove();
    }
}

function collectDrawables(svgEl) {
    const out = [];
    let order = 0;

    const walk = (node, ctm, ancestorNames, hidden) => {
        for (const el of Array.from(node.children)) {
            const tag = el.tagName.toLowerCase();
            if (SKIP_TAGS.has(tag)) continue;

            const local = parseTransform(el.getAttribute('transform'));
            const nextCtm = isIdentity(local) ? ctm : matMul(ctm, local);

            const styleAttr = el.getAttribute('style') || '';
            const isHidden = hidden
                || el.getAttribute('display') === 'none'
                || /display\s*:\s*none/.test(styleAttr)
                || el.getAttribute('visibility') === 'hidden'
                || parseFloat(el.getAttribute('opacity')) === 0;

            const names = [
                el.getAttribute('id'), el.getAttribute('inkscape:label'),
                el.getAttribute('data-name'), el.getAttribute('class'),
            ].filter(Boolean);

            if (tag === 'g' || tag === 'a' || tag === 'svg') {
                walk(el, nextCtm, ancestorNames.concat(names), isHidden);
                continue;
            }
            if (!SHAPE_TAGS.has(tag) || isHidden) continue;

            const d = shapeToPathData(el);
            if (!d) continue;
            let path = normalizePath(parsePath(d));
            const transformed = isIdentity(nextCtm);
            if (!transformed) path = applyMatrix(path, nextCtm);
            const bbox = pathBBox(path);
            if (!bbox || (bbox.w < 1e-6 && bbox.h < 1e-6)) continue;

            out.push({
                el, tag, names, ancestorNames, bbox, path,
                docIndex: order++,
                // Keep the author's own d string when nothing had to be baked in,
                // so Illustrator output survives byte-for-byte into the result.
                d: transformed && tag === 'path' ? d.trim() : writePath(path),
                parent: el.parentElement,
            });
        }
    };

    walk(svgEl, IDENTITY, [], false);
    return out;
}

/** Reads resolved paint for each drawable through getComputedStyle. */
function resolvePaint(svgEl, count) {
    const paints = [];
    withComputedStyles(svgEl, (clone) => {
        const nodes = [];
        const walk = (node) => {
            for (const el of Array.from(node.children)) {
                const tag = el.tagName.toLowerCase();
                if (SKIP_TAGS.has(tag)) continue;
                if (tag === 'g' || tag === 'a' || tag === 'svg') { walk(el); continue; }
                if (SHAPE_TAGS.has(tag)) nodes.push(el);
            }
        };
        walk(clone);
        for (const el of nodes) {
            const cs = getComputedStyle(el);
            paints.push({
                fill: (cs.fill || '').trim().toLowerCase(),
                stroke: (cs.stroke || '').trim().toLowerCase(),
                strokeWidth: parseFloat(cs.strokeWidth) || 0,
                display: cs.display,
                opacity: parseFloat(cs.opacity),
            });
        }
    });
    // The style walk mirrors the geometry walk, but it does not drop
    // zero-area shapes, so only trust it when the counts agree.
    return paints.length === count ? paints : null;
}

const isNone = (v) => !v || v === 'none' || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';

/** Rejects Figma's full-bleed artboard <rect>, which is never part of the artwork. */
function isArtboardBackground(dr, rootBox) {
    if (dr.tag !== 'rect') return false;
    if (!rootBox || !rootBox.w || !rootBox.h) return false;
    if (!isNone(dr.paint && dr.paint.stroke)) return false;
    const covers = dr.bbox.w >= rootBox.w * 0.98 && dr.bbox.h >= rootBox.h * 0.98;
    return covers && dr.docIndex === 0;
}

function scoreRole(dr, siblings, subjectSize) {
    const signals = [];
    const add = (w, s, why) => { if (s !== null && s !== undefined) signals.push({ w, s, why }); };

    add(6.0, nameSignal(dr.names), 'name');
    add(3.0, nameSignal(dr.ancestorNames), 'ancestor name');

    const p = dr.paint;
    if (p) {
        const hasFill = !isNone(p.fill);
        const hasStroke = !isNone(p.stroke);
        if (hasFill && !hasStroke) add(4.0, -1, 'filled, no stroke');
        else if (!hasFill && hasStroke) add(4.0, 1, 'stroked, fill:none');
        else if (hasFill && hasStroke) add(4.0, -0.3, 'filled and stroked');
    }

    // Containment: the silhouette encloses the detail lines.
    const others = siblings.filter((o) => o !== dr);
    if (others.length) {
        const contains = (a, b) =>
            a.x <= b.x + 0.5 && a.y <= b.y + 0.5 &&
            a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
        const area = (b) => b.w * b.h;
        if (others.every((o) => contains(dr.bbox, o.bbox)) && others.some((o) => area(o.bbox) < area(dr.bbox))) {
            add(5.0, -1, 'encloses the other shapes');
        } else if (others.some((o) => contains(o.bbox, dr.bbox) && area(dr.bbox) < area(o.bbox))) {
            add(5.0, 1, 'sits inside another shape');
        }
    }

    // Open subpaths and many of them mean line art.
    const nSub = dr.path.filter((s) => s.c === 'M').length;
    const nClose = dr.path.filter((s) => s.c === 'Z').length;
    const openFrac = nSub ? 1 - nClose / nSub : 0;
    add(3.0, clamp(0.6 * (2 * openFrac - 1) + 0.4 * Math.tanh((nSub - 1) / 3)), 'subpath shape');

    // Ink density separates a solid silhouette from outlined ribbons (Figma).
    if (p && !isNone(p.fill) && subjectSize > 0) {
        const density = Math.abs(polyArea(dr.path)) / Math.max(1e-6, dr.bbox.w * dr.bbox.h);
        add(2.5, density >= 0.35 ? -1 : density <= 0.15 ? 1 : 1 - 2 * ((density - 0.15) / 0.2), 'ink density');
    }

    if (siblings.length > 1) {
        const rank = siblings.indexOf(dr);
        add(1.5, (2 * rank) / (siblings.length - 1) - 1, 'paint order');
    }

    const wsum = signals.reduce((a, s) => a + s.w, 0);
    const R = wsum ? signals.reduce((a, s) => a + s.w * s.s, 0) / wsum : 0;
    return { R, signals };
}

const clamp = (v) => Math.max(-1, Math.min(1, v));

function polyArea(path) {
    let area = 0, cx = 0, cy = 0, sx = 0, sy = 0;
    for (const s of path) {
        if (s.c === 'M') { sx = cx = s.x; sy = cy = s.y; continue; }
        if (s.c === 'Z') { area += cx * sy - sx * cy; cx = sx; cy = sy; continue; }
        area += cx * s.y - s.x * cy;
        cx = s.x; cy = s.y;
    }
    return area / 2;
}

/**
 * Groups drawables into subjects.
 * Strategy 1 - a <g> ancestor whose name decodes to an index (Illustrator).
 * Strategy 2 - one subject per <g> that holds drawables.
 * Strategy 3 - consecutive drawables paired by role (flat Figma output).
 */
function groupSubjects(drawables, svgEl) {
    const byNamedGroup = new Map();
    let namedCount = 0;
    for (const dr of drawables) {
        let node = dr.parent, idx = null;
        while (node && node !== svgEl && node.tagName) {
            const found = indexFromName(node.getAttribute('id') || node.getAttribute('inkscape:label') || '');
            if (found !== null) { idx = found; break; }
            node = node.parentElement;
        }
        if (idx !== null) {
            namedCount++;
            if (!byNamedGroup.has(idx)) byNamedGroup.set(idx, []);
            byNamedGroup.get(idx).push(dr);
        }
    }
    if (byNamedGroup.size >= 2 && namedCount >= drawables.length * 0.8) {
        return {
            strategy: 'names',
            groups: [...byNamedGroup.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]),
        };
    }

    const byGroup = new Map();
    for (const dr of drawables) {
        let node = dr.parent, key = null;
        while (node && node !== svgEl && node.tagName) {
            if (node.tagName.toLowerCase() === 'g') key = node;
            node = node.parentElement;
        }
        if (key) {
            if (!byGroup.has(key)) byGroup.set(key, []);
            byGroup.get(key).push(dr);
        }
    }
    if (byGroup.size >= 1 && [...byGroup.values()].reduce((a, g) => a + g.length, 0) === drawables.length) {
        return { strategy: 'groups', groups: [...byGroup.values()] };
    }

    // Flat document: walk in paint order and start a new subject on every fill.
    const groups = [];
    let current = null;
    for (const dr of drawables) {
        const looksLikeFill = dr.paint ? !isNone(dr.paint.fill) : true;
        if (looksLikeFill || !current) { current = [dr]; groups.push(current); }
        else current.push(dr);
    }
    return { strategy: 'flat', groups };
}

/** Parses an SVG document and returns the subjects it contains. */
export function detectSubjects(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('Файл не является корректным SVG.');
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') throw new Error('В файле нет элемента <svg>.');

    const drawables = collectDrawables(svgEl);
    if (!drawables.length) throw new Error('В файле не найдено ни одной фигуры.');

    const paints = resolvePaint(svgEl, drawables.length);
    if (paints) drawables.forEach((dr, i) => { dr.paint = paints[i]; });

    const vb = (svgEl.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const rootBox = vb.length === 4 && vb.every(Number.isFinite)
        ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
        : null;

    const artwork = drawables.filter((dr) => !isArtboardBackground(dr, rootBox));
    artwork.forEach((dr, i) => { dr.docIndex = i; });
    if (!artwork.length) throw new Error('В файле нет фигур, кроме фона.');

    const { strategy, groups } = groupSubjects(artwork, svgEl);

    const subjects = groups.map((members) => {
        const boxes = members.map((m) => m.bbox);
        const size = Math.min(
            Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
            Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
        );
        const scored = members.map((m) => ({ ...m, ...scoreRole(m, members, size) }));

        let fills = scored.filter((m) => m.R < 0);
        let lines = scored.filter((m) => m.R >= 0);
        // Every subject needs a silhouette, and a lone shape is always the fill.
        if (!fills.length && scored.length) {
            const best = scored.reduce((a, b) => (a.R < b.R ? a : b));
            fills = [best];
            lines = scored.filter((m) => m !== best);
        }
        if (!lines.length && scored.length > 1) {
            const best = fills.reduce((a, b) => (a.R > b.R ? a : b));
            lines = [best];
            fills = fills.filter((m) => m !== best);
        }

        const confidence = Math.min(1, Math.min(...scored.map((m) => Math.abs(m.R))) / 0.6);
        // Subjects carry ready-to-insert markup: the builder drops it into the
        // defs unchanged, and the code fields show exactly what will be written.
        const asPath = (members) => {
            const d = members.map((m) => m.d).join('');
            return d ? `<path d="${d}"></path>` : '';
        };
        return {
            fill: asPath(fills),
            strokeIn: asPath(lines),
            fillBBox: fills.length ? unionOf(fills.map((m) => m.bbox)) : null,
            strokeBBox: lines.length ? unionOf(lines.map((m) => m.bbox)) : null,
            // A freshly read subject is clicked where it is drawn; the sidebar
            // moves these borders afterwards.
            clickArea: { top: 0, right: 0, bottom: 0, left: 0 },
            confidence,
            members: scored,
        };
    }).filter((s) => s.fill || s.strokeIn);

    // Editors write the layer stack top-first, so a file with no usable names
    // arrives with the highest subject index first.
    if (strategy !== 'names' && subjects.length > 1) subjects.reverse();

    return { subjects, strategy, rootBox };
}

/**
 * Parses the markup a user typed into one of the code fields, e.g.
 * `<path d="M0,0..."></path>`. Bare path data is accepted too.
 * Returns null when the markup does not parse, so the caller can keep the last
 * good drawing on screen instead of blanking it mid-edit.
 *
 * @returns {{d: string, bbox: object|null}|null}
 */
export function parseGeometryFragment(markup) {
    const text = (markup || '').trim();
    if (!text) return { d: '', bbox: null };

    // Allow pasting just the path data without the surrounding element.
    if (!text.includes('<')) {
        if (!/^[Mm]/.test(text)) return null;
        const p = normalizePath(parsePath(text));
        return p.length ? { d: text, bbox: pathBBox(p) } : null;
    }

    const doc = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${text}</svg>`, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;

    const ds = [];
    const all = [];
    for (const el of Array.from(doc.documentElement.children)) {
        if (!SHAPE_TAGS.has(el.tagName.toLowerCase())) continue;
        const d = shapeToPathData(el);
        if (!d) continue;
        const local = parseTransform(el.getAttribute('transform'));
        const identity = isIdentity(local);
        let p = normalizePath(parsePath(d));
        if (!identity) p = applyMatrix(p, local);
        ds.push(identity && el.tagName.toLowerCase() === 'path' ? d.trim() : writePath(p));
        all.push(...p);
    }
    if (!ds.length) return null;
    return { d: ds.join(''), bbox: all.length ? pathBBox(all) : null };
}

function unionOf(boxes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
        if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
