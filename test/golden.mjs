// Golden test: take the fill / stroke_in geometry out of a reference file in
// src_doc/examples, rebuild it with our template, and diff against the original.
//
// Run: node test/golden.mjs
//
// Levels, chosen from what each reference file actually contains:
//   full       - everything must match, including indicator coordinates.
//   no-offsets - everything except indicator <use> x/y. Some subjects in these
//                files were authored with per-subject indicator nudges, which
//                this version does not model (see README).
//   structure  - viewBox, frames, gradient and label counts only.
//
// CC2_4m7v26s is excluded: several of its frames were hand-edited after export
// (x="139", width="57" - integers that bypass the generator's toFixed(2)), so no
// correct implementation can reproduce it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSvg, computeLayout, alignArea, STATIC_DOC } from '../js/template.js';
import { parsePath, normalizePath, pathBBox } from '../js/geometry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src_doc', 'examples');

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function pointsToPath(points, close) {
    const p = (points.match(NUM) || []).map(Number);
    if (p.length < 4) return '';
    let d = `M${p[0]},${p[1]}`;
    for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]},${p[i + 1]}`;
    return close ? d + 'Z' : d;
}

function rectToPath(attrs) {
    const at = (name) => {
        const m = attrs.match(new RegExp(`\\s${name}="([^"]*)"`));
        return m ? parseFloat(m[1]) || 0 : 0;
    };
    const x = at('x'), y = at('y'), w = at('width'), h = at('height');
    if (w <= 0 || h <= 0) return '';
    return `M${x},${y}L${x + w},${y}L${x + w},${y + h}L${x},${y + h}Z`;
}

/**
 * Rewrites <polygon>/<polyline> as the <path> our builder emits for the same
 * geometry. <rect> is deliberately left alone: every rect in a reference file
 * is template output (the frame rects and the layer_o rect), so both sides
 * already agree on it.
 */
function shapesToPaths(svg) {
    return svg.replace(/<(polygon|polyline)\b([^>]*)>(?:<\/\1>)?/g, (whole, tag, attrs) => {
        const pts = (attrs.match(/\spoints="([^"]*)"/) || [])[1];
        const d = pts ? pointsToPath(pts, tag === 'polygon') : '';
        return d ? `<path d="${d}"></path>` : whole;
    });
}

function extractSubjects(svg) {
    const subjects = [];
    for (let i = 0; ; i++) {
        const fm = svg.match(new RegExp(`<g id="layer_s${i}_fill">([\\s\\S]*?)</g>`));
        const sm = svg.match(new RegExp(`<g id="layer_s${i}_stroke_in">([\\s\\S]*?)</g>`));
        if (!fm) break;
        const grab = (block) => {
            const out = [];
            const re = /<(path|polygon|polyline|rect)\b([^>]*)>/g;
            let m;
            while ((m = re.exec(block)) !== null) {
                const [, tag, attrs] = m;
                if (tag === 'path') {
                    const d = attrs.match(/\sd="([^"]*)"/);
                    if (d) out.push(d[1]);
                } else if (tag === 'rect') {
                    out.push(rectToPath(attrs));
                } else {
                    const pts = (attrs.match(/\spoints="([^"]*)"/) || [])[1];
                    if (pts) out.push(pointsToPath(pts, tag === 'polygon'));
                }
            }
            return out.filter(Boolean).join('');
        };
        const fill = grab(fm[1]);
        const strokeIn = sm ? grab(sm[1]) : '';
        // Subjects hold ready-to-insert markup, exactly like the app's fields.
        const wrap = (d) => (d ? `<path d="${d}"></path>` : '');
        subjects.push({
            fill: wrap(fill),
            strokeIn: wrap(strokeIn),
            fillBBox: pathBBox(normalizePath(parsePath(fill))),
        });
    }
    return subjects;
}

// The reference files carry trailing spaces on some lines and one attribute
// written x="0.000" instead of x="0.00" - both artifacts of the old generator's
// DOM round-trip and token-substitution bug. Normalise them away before diffing.
const normalise = (s) => shapesToPaths(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/(\sx=")(-?\d+)\.000"/g, '$1$2.00"')
    .replace(/-0\.00/g, '0.00');

const stripIndicatorXY = (s) =>
    s.replace(/(<use xlink:href="#(?:fail|circle|old_repair|old_lock_\w+|insert)"[^>]*?) x="[^"]*" y="[^"]*"/g, '$1');

const CASES = [
    { name: 'PV_3m4v6s_R-RS-S.svg', level: 'full' },
    { name: 'PK_3m4v7s_R-R-R.svg', level: 'no-offsets' },
    { name: 'PG_2m1v2s_S-S.svg', level: 'structure' },
    { name: 'Object_1m1v1s.svg', level: 'structure' },
];

let failures = 0;

for (const { name, level } of CASES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { console.log(`SKIP  ${name} (missing)`); continue; }

    const original = fs.readFileSync(file, 'utf8');
    const subjects = extractSubjects(original);
    const built = buildSvg(subjects);

    const a0 = normalise(original).trimEnd();
    const b0 = normalise(built).trimEnd();

    const labels = (s) => (s.match(/inkscape:label/g) || []).length;
    const frames = (s) => [...s.matchAll(/<g id="layer_s\d+_frame">\s*<rect ([^>]*)>/g)].map((m) => m[1]);
    const viewBox = (s) => (s.match(/viewBox="([^"]*)"/) || [])[1];
    const stops = (s) => (s.match(/<stop /g) || []).length;
    const grad = (s) => (s.match(/<linearGradient[^>]*>/) || [])[0];

    const problems = [];
    const check = (label, want, got) => {
        if (String(want) !== String(got)) {
            problems.push(`      ${label}\n        expected: ${want}\n        actual:   ${got}`);
        }
    };

    check('viewBox', viewBox(a0), viewBox(b0));
    check('label count', labels(a0), labels(b0));
    check('label arithmetic (20N+4)', 20 * subjects.length + 4, labels(b0));
    check('frames', JSON.stringify(frames(a0)), JSON.stringify(frames(b0)));
    check('gradient vector', grad(a0), grad(b0));
    check('gradient stop count', stops(a0), stops(b0));

    if (level !== 'structure') {
        const a = level === 'no-offsets' ? stripIndicatorXY(a0) : a0;
        const b = level === 'no-offsets' ? stripIndicatorXY(b0) : b0;
        if (a !== b) {
            const la = a.split('\n'), lb = b.split('\n');
            let shown = 0;
            for (let i = 0; i < Math.max(la.length, lb.length) && shown < 5; i++) {
                if (la[i] !== lb[i]) {
                    problems.push(`      line ${i + 1}\n        expected: ${JSON.stringify(la[i])}\n        actual:   ${JSON.stringify(lb[i])}`);
                    shown++;
                }
            }
            if (la.length !== lb.length) problems.push(`      line count ${la.length} vs ${lb.length}`);
        }
    }

    if (!problems.length) {
        console.log(`PASS  ${name}  (${subjects.length} subjects, ${level})`);
    } else {
        failures++;
        console.log(`FAIL  ${name}  (${subjects.length} subjects, ${level})`);
        problems.forEach((p) => console.log(p));
    }
}

// ---------------------------------------------------------------- static

// The static object is the same drawing under a different template: a page of a
// fixed size with the object placed into a corner of it. There is nothing to
// diff whole against, because the references in src_doc/examples/static were
// drawn in place - every one of them carries translate(0 0) - and they hold
// background elements the simplified template does not write yet. What can be
// checked is everything the template decides for itself.
{
    const name = 'AE_Separator_8.svg';
    const file = path.join(dir, 'static', name);
    const problems = [];
    const check = (label, want, got) => {
        if (String(want) !== String(got)) {
            problems.push(`      ${label}\n        expected: ${want}\n        actual:   ${got}`);
        }
    };

    if (!fs.existsSync(file)) {
        console.log(`SKIP  ${name} (missing)`);
    } else {
        const original = normalise(fs.readFileSync(file, 'utf8')).trimEnd();
        const subjects = extractSubjects(original);
        const built = normalise(buildSvg(subjects, { objectType: 'static' })).trimEnd();

        const first = (s, re) => (s.match(re) || [])[0];
        const layerO = (s) => s.slice(s.indexOf('<g id="layer_o"'), s.indexOf('<g transform="translate'));

        // The page is the format's, not the drawing's.
        check('header', first(original, /<svg [^>]*>/), first(built, /<svg [^>]*>/));

        // The frames and the hatch are the drawing's, not the template's, and
        // the dynamic cases above already hold them to the reference files.
        // This one's frames were adjusted by hand after export, exactly as
        // CC2's were, so there is nothing here to compare them against.

        // The frame KOMPAKS fills in is copied from the reference verbatim, and
        // it comes before the subjects rather than after them.
        check('layer_o', layerO(original), layerO(built));
        check('layer_o comes first',
            true, built.indexOf('<g id="layer_o"') < built.indexOf('<g id="layer_s0"'));

        // The markup of the frame is kept verbatim rather than built from the
        // constants the alignment is worked out from, so the two are held
        // against each other here instead.
        const viewRect = first(built, /<rect id="View"[\s\S]*?\/>/) || '';
        const attr = (name) => Number((viewRect.match(new RegExp(`${name}="([^"]*)"`)) || [])[1]);
        check('the View rectangle is where the constants say',
            JSON.stringify(STATIC_DOC.view),
            JSON.stringify({ x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') }));
        check('the caption starts where the constants say',
            STATIC_DOC.captionX,
            Number((first(built, /<text x="[^"]*"/) || '').match(/"([^"]*)"/)[1]));

        // The object is laid in the alignment area, and the caption is given
        // the opposite move so that it stays where it is whatever the object
        // does. Where the object lands is checked against the area rather than
        // against the shift, which is the thing being checked.
        const caption = first(built, /<g class="text text_src" transform="translate\([^"]*\)">/);
        const numbers = (s) => (s.match(/-?[\d.]+/g) || []).map(Number);
        const shiftOf = (params) => {
            const file = buildSvg(subjects, { objectType: 'static', ...params });
            return numbers(first(file, /<g transform="translate\([^"]*\)">/));
        };
        const box = computeLayout(subjects, { objectType: 'static' });
        const at = (params) => {
            const [dx, dy] = shiftOf(params);
            return [Number((box.x + dx).toFixed(2)), Number((box.y + dy).toFixed(2))];
        };
        const area = alignArea({});
        const round2 = (v) => Number(v.toFixed(2));

        check('centred is the default',
            JSON.stringify([round2(area.x + (area.w - box.w) / 2), round2(area.y + (area.h - box.h) / 2)]),
            JSON.stringify(at({})));
        check('left and top put the corner on the caption and the View',
            JSON.stringify([STATIC_DOC.captionX, STATIC_DOC.view.y]),
            JSON.stringify(at({ alignH: 'left', alignV: 'top' })));
        check('right and bottom put it on the far corner',
            JSON.stringify([round2(area.x + area.w - box.w), round2(area.y + area.h - box.h)]),
            JSON.stringify(at({ alignH: 'right', alignV: 'bottom' })));
        // The margin is taken off the right edge and nothing else, so only an
        // object laid against that edge moves by it.
        check('the margin moves the right edge in',
            JSON.stringify([round2(at({ alignH: 'right' })[0] - 40), at({ alignH: 'right' })[1]]),
            JSON.stringify(at({ alignH: 'right', alignMargin: 40 })));
        check('and leaves the left edge alone',
            JSON.stringify(at({ alignH: 'left' })),
            JSON.stringify(at({ alignH: 'left', alignMargin: 40 })));

        check('the caption moves the other way',
            JSON.stringify(shiftOf({}).map((v) => -v)), JSON.stringify(numbers(caption)));

        // KOMPAKS draws nothing no subject layer points at, so s0 - and only
        // s0 - carries the background.
        check('s0 refers to the background', 1, (built.match(/<use xlink:href="#background_elem">/g) || []).length);
        check('the background is in the defs',
            true, built.indexOf('<g id="background_elem">') < built.indexOf('</defs>'));

        // Nothing of the static template leaks into the dynamic one.
        const dynamic = buildSvg(subjects);
        check('the dynamic file has none of it', 'none',
            ['background_elem', 'text_src', 'id="View"', 'preserveAspectRatio']
                .filter((s) => dynamic.includes(s)).join(',') || 'none');

        if (!problems.length) {
            console.log(`PASS  static/${name}  (${subjects.length} subjects, static template)`);
        } else {
            failures++;
            console.log(`FAIL  static/${name}  (${subjects.length} subjects, static template)`);
            problems.forEach((p) => console.log(p));
        }
    }
}

console.log(failures ? `\n${failures} file(s) failed.` : '\nAll golden checks passed.');
process.exit(failures ? 1 : 0);
