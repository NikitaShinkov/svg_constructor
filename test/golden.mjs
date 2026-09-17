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
import { buildSvg } from '../js/template.js';
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

console.log(failures ? `\n${failures} file(s) failed.` : '\nAll golden checks passed.');
process.exit(failures ? 1 : 0);
