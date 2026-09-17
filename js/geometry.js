// Path parsing, transform flattening and analytic bounding boxes.
// Pure module: no DOM access, so it can be unit-tested in Node.

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function parsePath(d) {
    const out = [];
    const re = /([MmZzLlHhVvCcSsQqTtAa])([^MmZzLlHhVvCcSsQqTtAa]*)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
        const letter = m[1];
        const upper = letter.toUpperCase();
        const need = ARG_COUNT[upper];
        const nums = (m[2].match(NUM) || []).map(Number);
        if (need === 0) { out.push({ cmd: upper, rel: false, args: [] }); continue; }
        for (let i = 0; i + need <= nums.length; i += need) {
            // An implicit repeat after a moveto is a lineto.
            const cmd = (i > 0 && upper === 'M') ? 'L' : upper;
            out.push({ cmd, rel: letter !== upper, args: nums.slice(i, i + need) });
        }
    }
    return out;
}

export function normalizePath(segs) {
    const out = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let prevCubic = null, prevQuad = null;

    for (const s of segs) {
        const a = s.args;
        const rx = s.rel ? cx : 0, ry = s.rel ? cy : 0;
        let thisCubic = null, thisQuad = null;

        switch (s.cmd) {
            case 'M':
                cx = a[0] + rx; cy = a[1] + ry; sx = cx; sy = cy;
                out.push({ c: 'M', x: cx, y: cy });
                break;
            case 'L':
                cx = a[0] + rx; cy = a[1] + ry;
                out.push({ c: 'L', x: cx, y: cy });
                break;
            case 'H':
                cx = a[0] + rx;
                out.push({ c: 'L', x: cx, y: cy });
                break;
            case 'V':
                cy = a[0] + ry;
                out.push({ c: 'L', x: cx, y: cy });
                break;
            case 'C': {
                const p = { c: 'C', x1: a[0] + rx, y1: a[1] + ry, x2: a[2] + rx, y2: a[3] + ry, x: a[4] + rx, y: a[5] + ry };
                out.push(p); thisCubic = [p.x2, p.y2]; cx = p.x; cy = p.y;
                break;
            }
            case 'S': {
                // Reflect the previous cubic control point; identity when there was none.
                const r = prevCubic ? [2 * cx - prevCubic[0], 2 * cy - prevCubic[1]] : [cx, cy];
                const p = { c: 'C', x1: r[0], y1: r[1], x2: a[0] + rx, y2: a[1] + ry, x: a[2] + rx, y: a[3] + ry };
                out.push(p); thisCubic = [p.x2, p.y2]; cx = p.x; cy = p.y;
                break;
            }
            case 'Q': {
                const qx = a[0] + rx, qy = a[1] + ry, ex = a[2] + rx, ey = a[3] + ry;
                out.push(quadToCubic(cx, cy, qx, qy, ex, ey));
                thisQuad = [qx, qy]; cx = ex; cy = ey;
                break;
            }
            case 'T': {
                const r = prevQuad ? [2 * cx - prevQuad[0], 2 * cy - prevQuad[1]] : [cx, cy];
                const ex = a[0] + rx, ey = a[1] + ry;
                out.push(quadToCubic(cx, cy, r[0], r[1], ex, ey));
                thisQuad = r; cx = ex; cy = ey;
                break;
            }
            case 'A': {
                const ex = a[5] + rx, ey = a[6] + ry;
                for (const seg of arcToCubics(cx, cy, a[0], a[1], a[2], !!a[3], !!a[4], ex, ey)) out.push(seg);
                cx = ex; cy = ey;
                break;
            }
            case 'Z':
                out.push({ c: 'Z' });
                // A following relative command is relative to the subpath start.
                cx = sx; cy = sy;
                break;
        }
        prevCubic = thisCubic; prevQuad = thisQuad;
    }
    return out;
}

function quadToCubic(x0, y0, qx, qy, x, y) {
    return {
        c: 'C',
        x1: x0 + (2 / 3) * (qx - x0), y1: y0 + (2 / 3) * (qy - y0),
        x2: x + (2 / 3) * (qx - x), y2: y + (2 / 3) * (qy - y),
        x, y,
    };
}

// SVG 1.1 Appendix F.6.5 endpoint -> centre parameterization.
// Arcs are converted before any matrix is applied, because an affine map does not
// carry an SVG arc to another SVG arc under non-uniform scale or rotation.
export function arcToCubics(x1, y1, rx, ry, phiDeg, fA, fS, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [{ c: 'L', x: x2, y: y2 }];

    const phi = (phiDeg * Math.PI) / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cosP * dx + sinP * dy;
    const y1p = -sinP * dx + cosP * dy;

    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

    const sign = fA !== fS ? 1 : -1;
    const numer = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const k = sign * Math.sqrt(Math.max(0, numer / denom));
    const cxp = k * ((rx * y1p) / ry);
    const cyp = k * (-(ry * x1p) / rx);
    const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
    const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

    const ang = (ux, uy, vx, vy) => {
        const dot = ux * vx + uy * vy;
        const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const theta1 = ang(1, 0, ux, uy);
    let dTheta = ang(ux, uy, vx, vy);
    if (!fS && dTheta > 0) dTheta -= 2 * Math.PI;
    if (fS && dTheta < 0) dTheta += 2 * Math.PI;

    // <= 45 deg per segment keeps radial error near 4e-6 * r, below the last emitted digit.
    const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 4)));
    const delta = dTheta / n;
    const alpha = (4 / 3) * Math.tan(delta / 4);

    const E = (t) => [
        cx + rx * cosP * Math.cos(t) - ry * sinP * Math.sin(t),
        cy + rx * sinP * Math.cos(t) + ry * cosP * Math.sin(t),
    ];
    const Ed = (t) => [
        -rx * cosP * Math.sin(t) - ry * sinP * Math.cos(t),
        -rx * sinP * Math.sin(t) + ry * cosP * Math.cos(t),
    ];

    const out = [];
    for (let i = 0; i < n; i++) {
        const t0 = theta1 + i * delta, t1 = t0 + delta;
        const p0 = E(t0), d0 = Ed(t0), p1 = E(t1), d1 = Ed(t1);
        out.push({
            c: 'C',
            x1: p0[0] + alpha * d0[0], y1: p0[1] + alpha * d0[1],
            x2: p1[0] - alpha * d1[0], y2: p1[1] - alpha * d1[1],
            x: p1[0], y: p1[1],
        });
    }
    return out;
}

// Mat = [a,b,c,d,e,f];  x' = a*x + c*y + e,  y' = b*x + d*y + f
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function isIdentity(m) {
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

export function matMul(m1, m2) {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
}

export function parseTransform(str) {
    let m = IDENTITY;
    if (!str) return m;
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let t;
    while ((t = re.exec(str)) !== null) {
        const fn = t[1].toLowerCase();
        const a = (t[2].match(NUM) || []).map(Number);
        let local = IDENTITY;
        if (fn === 'matrix' && a.length >= 6) local = a.slice(0, 6);
        else if (fn === 'translate') local = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
        else if (fn === 'scale') local = [a.length ? a[0] : 1, 0, 0, a.length > 1 ? a[1] : (a.length ? a[0] : 1), 0, 0];
        else if (fn === 'rotate') {
            const r = ((a[0] || 0) * Math.PI) / 180;
            const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
            local = a.length >= 3
                ? matMul(matMul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]])
                : rot;
        } else if (fn === 'skewx') local = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
        else if (fn === 'skewy') local = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        m = matMul(m, local);
    }
    return m;
}

export function applyMatrix(path, m) {
    const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    return path.map((s) => {
        if (s.c === 'Z') return s;
        if (s.c === 'C') {
            const a = pt(s.x1, s.y1), b = pt(s.x2, s.y2), e = pt(s.x, s.y);
            return { c: 'C', x1: a[0], y1: a[1], x2: b[0], y2: b[1], x: e[0], y: e[1] };
        }
        const e = pt(s.x, s.y);
        return { c: s.c, x: e[0], y: e[1] };
    });
}

function cubicExtrema(p0, p1, p2, p3) {
    // B'(t) = At^2 + Bt + C
    const A = -p0 + 3 * p1 - 3 * p2 + p3;
    const B = 2 * (p0 - 2 * p1 + p2);
    const C = -p0 + p1;
    const ts = [];
    if (Math.abs(A) < 1e-12) {
        if (Math.abs(B) > 1e-12) ts.push(-C / B);
    } else {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
            const s = Math.sqrt(disc);
            ts.push((-B + s) / (2 * A), (-B - s) / (2 * A));
        }
    }
    const at = (t) => {
        const u = 1 - t;
        return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    };
    return ts.filter((t) => t > 0 && t < 1).map(at);
}

export function pathBBox(path) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cx = 0, cy = 0, seen = false;
    const hitX = (v) => { if (v < minX) minX = v; if (v > maxX) maxX = v; };
    const hitY = (v) => { if (v < minY) minY = v; if (v > maxY) maxY = v; };
    for (const s of path) {
        if (s.c === 'Z') continue;
        if (s.c === 'C') {
            hitX(cx); hitY(cy);
            hitX(s.x); hitY(s.y);
            for (const v of cubicExtrema(cx, s.x1, s.x2, s.x)) hitX(v);
            for (const v of cubicExtrema(cy, s.y1, s.y2, s.y)) hitY(v);
        } else {
            hitX(s.x); hitY(s.y);
        }
        seen = true;
        cx = s.x; cy = s.y;
    }
    if (!seen) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBBox(boxes) {
    const valid = boxes.filter(Boolean);
    if (!valid.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of valid) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
        if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function shapeToPathData(el) {
    const n = (name, dflt) => {
        const v = parseFloat(el.getAttribute(name));
        return Number.isFinite(v) ? v : (dflt || 0);
    };
    const tag = el.tagName.toLowerCase();
    if (tag === 'path') return el.getAttribute('d') || '';
    if (tag === 'rect') {
        const x = n('x'), y = n('y'), w = n('width'), h = n('height');
        if (w <= 0 || h <= 0) return '';
        let rx = el.hasAttribute('rx') ? n('rx') : NaN;
        let ry = el.hasAttribute('ry') ? n('ry') : NaN;
        if (!Number.isFinite(rx) && !Number.isFinite(ry)) { rx = 0; ry = 0; }
        else if (!Number.isFinite(rx)) rx = ry;
        else if (!Number.isFinite(ry)) ry = rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        if (rx === 0 || ry === 0) {
            return `M${x},${y}L${x + w},${y}L${x + w},${y + h}L${x},${y + h}Z`;
        }
        return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}` +
               `V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}` +
               `H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
               `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
    }
    if (tag === 'circle') {
        const cx = n('cx'), cy = n('cy'), r = n('r');
        if (r <= 0) return '';
        return `M${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}Z`;
    }
    if (tag === 'ellipse') {
        const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry');
        if (rx <= 0 || ry <= 0) return '';
        return `M${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}Z`;
    }
    if (tag === 'line') return `M${n('x1')},${n('y1')}L${n('x2')},${n('y2')}`;
    if (tag === 'polyline' || tag === 'polygon') {
        const pts = (el.getAttribute('points') || '').match(NUM);
        if (!pts || pts.length < 4) return '';
        const p = pts.map(Number);
        let d = `M${p[0]},${p[1]}`;
        for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]},${p[i + 1]}`;
        return tag === 'polygon' ? d + 'Z' : d;
    }
    return '';
}

export function num(v, prec) {
    if (prec === undefined) prec = 2;
    if (!Number.isFinite(v)) return '0';
    if (Math.abs(v) < 0.5 * Math.pow(10, -prec)) return '0';
    return String(Math.round(v * Math.pow(10, prec)) / Math.pow(10, prec));
}

export function writePath(path, prec) {
    let out = '';
    for (const s of path) {
        if (s.c === 'Z') { out += 'Z'; continue; }
        if (s.c === 'C') {
            out += `C${num(s.x1, prec)},${num(s.y1, prec)} ${num(s.x2, prec)},${num(s.y2, prec)} ${num(s.x, prec)},${num(s.y, prec)}`;
            continue;
        }
        out += `${s.c}${num(s.x, prec)},${num(s.y, prec)}`;
    }
    return out;
}
