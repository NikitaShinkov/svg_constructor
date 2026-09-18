// End-to-end check of the real app: drives index.html in headless Chrome via
// the DevTools protocol, feeds a fixture through the actual file input, and
// asserts that the subject list and the preview really populated.
//
//   node server.mjs 8099 &
//   node test/e2e.mjs [port] [chromePort]

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPort = Number(process.argv[2]) || 8099;
const cdpPort = Number(process.argv[3]) || 9333;

const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

if (!CHROME) { console.error('No Chrome or Edge found.'); process.exit(1); }

const FIXTURES = [
    ['Object_1m1v1s_ai_draft.svg', 1],
    ['PG_2m1v2s_S-S_figma_draft.svg', 2],
    ['PK_3m4v7s_R-R-R_ai_draft.svg', 7],
    ['PV_3m4v6s_R-RS-S_figma_draft.svg', 6],
];

const userDataDir = path.join(root, '.chrome-e2e');
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp() {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
            if (r.ok) return;
        } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error('Chrome DevTools endpoint did not come up.');
}

class Session {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
    static async open(wsUrl) {
        const ws = new WebSocket(wsUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
        const s = new Session(ws);
        ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            const p = s.pending.get(msg.id);
            if (!p) return;
            s.pending.delete(msg.id);
            msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
        };
        return s;
    }
    send(method, params) {
        const id = ++this.id;
        this.ws.send(JSON.stringify({ id, method, params: params || {} }));
        return new Promise((res, rej) => this.pending.set(id, { res, rej }));
    }
    async evaluate(expression) {
        const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
        return r.result.value;
    }
    close() { this.ws.close(); }
}

let failures = 0;

/** Polls the page until the expression is truthy, so a cold first load cannot race. */
async function waitUntil(session, expression, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await session.evaluate(expression)) return true;
        await sleep(100);
    }
    return false;
}

try {
    await waitForCdp();

    const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?http://localhost:${appPort}/index.html`, { method: 'PUT' })).json();
    const session = await Session.open(target.webSocketDebuggerUrl);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('DOM.enable');

    // Surface any page error rather than letting it pass silently.
    const errors = [];
    session.ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown') {
            errors.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || ''));
        }
    });

    for (const [fixture, expectedSubjects] of FIXTURES) {
        await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
        // The module must have finished wiring up, or the file input has no listener yet.
        if (!await waitUntil(session, `document.body.dataset.ready === 'true'`)) {
            failures++; console.log(`FAIL  ${fixture} - app never became ready`); continue;
        }

        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId,
            files: [path.join(root, 'src_doc', 'files', fixture)],
        });
        await waitUntil(session, `document.body.dataset.loaded === 'true'`);

        // Expand the first row so its fields are measurable.
        await session.evaluate(`(document.querySelector('#sub_list .sub_num')||{click(){}}).click()`);
        await sleep(200);

        const report = await session.evaluate(`(() => {
            const cs = (el, prop) => getComputedStyle(el)[prop];
            const side = document.getElementById('sud_sidebloсk');
            const area = document.querySelector('#sub_list textarea');
            const label = document.querySelector('#sub_list .field_label');
            const block = document.querySelector('#sub_list .sub_block');
            const stage = document.getElementById('preview_stage');
            const svg = document.querySelector('#preview_stage svg');
            return {
                blocks: document.querySelectorAll('#sub_list .sub_block').length,
                labels: [...document.querySelectorAll('#sub_list .sub_num')].map(e => e.textContent).join(','),
                fields: document.querySelectorAll('#sub_list textarea').length,
                firstFill: area ? area.value : '',
                readOnly: area ? area.readOnly : true,
                areaScrolls: area ? area.scrollHeight > area.clientHeight + 1 : false,
                areaOverflow: area ? cs(area, 'overflowY') : '',
                labelText: [...document.querySelectorAll('#sub_list .field_label')].slice(0, 2).map(e => e.textContent).join(','),
                addButtons: document.querySelectorAll('#sub_list .add_sub_button').length,
                deleteButtons: document.querySelectorAll('#sub_list .delete_sub_button').length,
                chevrons: document.querySelectorAll('#sub_list .chevron').length,
                sidebarW: Math.round(side.getBoundingClientRect().width),
                sidebarMinW: cs(side, 'minWidth'),
                sidebarBorder: cs(side, 'borderRightWidth'),
                previewBg: cs(document.getElementById('svg_privew_block'), 'backgroundColor'),
                blockRadius: block ? cs(block, 'borderTopLeftRadius') : '',
                blockBorderTop: block ? cs(block, 'borderTopWidth') : '',
                blockBorderLeft: block ? cs(block, 'borderLeftWidth') : '',
                listGap: cs(document.getElementById('sub_list'), 'rowGap'),
                fontFamily: cs(document.body, 'fontFamily'),
                fontSizes: [...new Set([...document.querySelectorAll('body, .sub_num, .field_label, textarea, .upload_button, .sidebar_title')].map(e => cs(e, 'fontSize')))].join(','),
                hasToast: !!document.getElementById('toast'),
                copyEnabled: !!document.getElementById('copy_button') && !document.getElementById('copy_button').disabled,
                previewSvg: !!svg,
                previewLayers: document.querySelectorAll('#preview_stage [id^="layer_s"]').length,
                downloadEnabled: !document.getElementById('download_button').disabled,
                svgW: svg ? svg.clientWidth : 0,
                stageW: stage.clientWidth,
                titleWeight: cs(document.querySelector('.sidebar_title'), 'fontWeight'),
                blockBg: (() => {
                    const c = document.querySelector('#sub_list .sub_block:not(.is_open)');
                    return c ? cs(c, 'backgroundColor') : '';
                })(),
                uploadW: Math.round(document.getElementById('upload_button').getBoundingClientRect().width),
                downloadW: Math.round(document.getElementById('download_button').getBoundingClientRect().width),
                copyW: Math.round(document.getElementById('copy_button').getBoundingClientRect().width),
                buttonRowW: Math.round(document.querySelector('.button_block').getBoundingClientRect().width),
                buttonsWrap: ['#upload_button', '#download_button'].some((s) => {
                    const b = document.querySelector(s);
                    return b.getBoundingClientRect().height > 36 || b.scrollWidth > b.clientWidth + 1;
                }),
                collapsedFieldsHidden: [...document.querySelectorAll('#sub_list .sub_block:not(.is_open) .text_fields_block')]
                    .every((f) => cs(f, 'display') === 'none'),
                deleteAtRight: (() => {
                    const c = document.querySelector('#sub_list .sub_block:not(.is_open)');
                    if (!c) return true;
                    const d = c.querySelector('.delete_sub_button');
                    // A lone subject cannot be deleted, so it carries no button.
                    if (!d) return true;
                    return Math.abs(c.getBoundingClientRect().right - d.getBoundingClientRect().right) <= 6;
                })(),
                handleLineW: cs(document.getElementById('resize_handle'), 'width'),
                handleAfterW: getComputedStyle(document.getElementById('resize_handle'), '::after').width,
                hintsRemoved: !document.getElementById('preview_hint') && !document.querySelector('.empty_hint'),
                labelBaselineDelta: (label && area)
                    ? Math.round(label.getBoundingClientRect().top - area.getBoundingClientRect().top)
                    : -999,
            };
        })()`);

        const problems = [];
        const want = (label, got, expected) => { if (got !== expected) problems.push(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); };

        want('subject blocks', report.blocks, expectedSubjects);
        want('numbering', report.labels, Array.from({ length: expectedSubjects }, (_, i) => `s${i}`).join(','));
        want('textareas (2 per subject)', report.fields, expectedSubjects * 2);
        want('field labels', report.labelText, 'fill,str');
        want('fields editable', report.readOnly, false);
        want('no textarea scrollbar', report.areaOverflow, 'hidden');
        want('textarea fits content', report.areaScrolls, false);
        want('add buttons', report.addButtons, expectedSubjects);
        // The last subject cannot be deleted, so a one-subject file gets no button.
        want('delete buttons', report.deleteButtons, expectedSubjects > 1 ? expectedSubjects : 0);
        want('chevrons removed', report.chevrons, 0);
        want('sidebar width', report.sidebarW, 360);
        want('sidebar min-width', report.sidebarMinW, '360px');
        want('sidebar has no border', report.sidebarBorder, '0px');
        want('preview background', report.previewBg, 'rgb(32, 32, 53)');
        want('sub_block no radius', report.blockRadius, '0px');
        want('sub_block top border', report.blockBorderTop, '1px');
        want('sub_block no side border', report.blockBorderLeft, '0px');
        want('sub_list gap', report.listGap, '0px');
        want('single font size', report.fontSizes, '12px');
        want('status toast removed', report.hasToast, false);
        want('copy button enabled', report.copyEnabled, true);
        want('preview rendered', report.previewSvg, true);
        want('download enabled', report.downloadEnabled, true);

        want('title is not bold', report.titleWeight, '400');
        want('sub_block has no default fill', report.blockBg, 'rgba(0, 0, 0, 0)');
        want('hint texts removed', report.hintsRemoved, true);
        want('collapsed rows hide their fields', report.collapsedFieldsHidden, true);
        want('delete button sits at the right edge', report.deleteAtRight, true);
        want('resize line is 1px', report.handleAfterW, '1px');
        // upload and download must be exactly equal; copy stays icon-sized.
        want('buttons are single-line', report.buttonsWrap, false);
        want('upload and download are equal width', report.uploadW, report.downloadW);
        if (Math.abs(report.uploadW + report.downloadW + report.copyW + 12 - report.buttonRowW) > 2) {
            problems.push(`buttons do not fill the row: ${report.uploadW}+${report.downloadW}+${report.copyW}+12 != ${report.buttonRowW}`);
        }
        if (!/Inter/.test(report.fontFamily)) problems.push(`font family is ${report.fontFamily}`);
        if (!/^<path d="M/.test(report.firstFill)) problems.push(`first fill field does not contain a path: ${report.firstFill.slice(0, 60)}`);
        if (report.svgW === 0 || report.svgW > report.stageW + 1) {
            problems.push(`preview svg width ${report.svgW} does not fit stage ${report.stageW}`);
        }
        // Label and the field's first text line share a baseline, so their tops match.
        if (Math.abs(report.labelBaselineDelta) > 1) {
            problems.push(`label is ${report.labelBaselineDelta}px off the field's first line`);
        }

        if (problems.length) {
            failures++;
            console.log(`FAIL  ${fixture}`);
            problems.forEach((p) => console.log(`        ${p}`));
        } else {
            console.log(`PASS  ${fixture}  (${report.blocks} subjects, ${report.previewLayers} layer groups, svg ${report.svgW}px in ${report.stageW}px stage)`);
        }
    }

    // ---- interaction: edit, add, delete -------------------------------------

    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);
    {
        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId, files: [path.join(root, 'src_doc', 'files', 'PG_2m1v2s_S-S_figma_draft.svg')],
        });
        await sleep(900);
    }

    const step = async (label, expression, expected) => {
        const got = await session.evaluate(expression);
        const ok = JSON.stringify(got) === JSON.stringify(expected);
        if (!ok) { failures++; console.log(`FAIL  ${label}\n        got:      ${JSON.stringify(got)}\n        expected: ${JSON.stringify(expected)}`); }
        else console.log(`PASS  ${label}`);
        return got;
    };

    const nums = `[...document.querySelectorAll('#sub_list .sub_num')].map(e=>e.textContent).join(',')`;
    const viewBox = `document.querySelector('#preview_stage svg').getAttribute('viewBox')`;

    await step('starts with two subjects', nums, 's0,s1');
    const beforeViewBox = await session.evaluate(viewBox);

    // Delete button is only offered while the row is collapsed.
    await step('delete visible when collapsed',
        `getComputedStyle(document.querySelector('#sub_list .sub_block .delete_sub_button')).display !== 'none'`, true);
    await session.evaluate(`document.querySelector('#sub_list .sub_num').click()`);
    await sleep(200);
    await step('delete hidden when expanded',
        `getComputedStyle(document.querySelector('#sub_list .sub_block.is_open .delete_sub_button')).display === 'none'`, true);

    // Editing a code field must rebuild the file.
    await session.evaluate(`(() => {
        const a = document.querySelector('#sub_list .sub_block.is_open textarea');
        a.value = '<path d="M0,0L500,0L500,400L0,400Z"></path>';
        a.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    const afterViewBox = await session.evaluate(viewBox);
    if (afterViewBox === beforeViewBox) {
        failures++;
        console.log(`FAIL  editing a field rebuilds the svg\n        viewBox unchanged: ${afterViewBox}`);
    } else {
        console.log(`PASS  editing a field rebuilds the svg (${beforeViewBox} -> ${afterViewBox})`);
    }
    await step('edited geometry reaches the defs',
        `document.querySelector('#preview_stage #layer_s0_fill path').getAttribute('d')`,
        'M0,0L500,0L500,400L0,400Z');

    // Whatever is typed goes into the file unchanged - no validation, no marking.
    await session.evaluate(`(() => {
        const a = document.querySelector('#sub_list .sub_block.is_open textarea');
        a.value = '<circle cx="10" cy="10" r="5"></circle>';
        a.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(250);
    await step('field text is written through verbatim',
        `[document.getElementById('preview_stage').innerHTML.includes('<circle cx="10" cy="10" r="5">'),
          document.querySelector('#sub_list .sub_block.is_open textarea').classList.contains('is_invalid')]`,
        [true, false]);

    // Restore a shape with a known box for the checks that follow.
    await session.evaluate(`(() => {
        const a = document.querySelector('#sub_list .sub_block.is_open textarea');
        a.value = '<path d="M0,0L500,0L500,400L0,400Z"></path>';
        a.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(250);

    // Adding inserts directly below and renumbers.
    await session.evaluate(`document.querySelectorAll('#sub_list .add_sub_button')[0].click()`);
    await sleep(300);
    await step('add inserts below and renumbers', nums, 's0,s1,s2');
    await step('only one row is expanded at a time',
        `document.querySelectorAll('#sub_list .sub_block.is_open').length`, 1);
    await step('new subject is empty',
        `document.querySelectorAll('#sub_list .sub_block')[1].querySelector('textarea').value`, '');
    await step('new subject has its own layer group',
        `!!document.querySelector('#preview_stage #layer_s1') && !!document.querySelector('#preview_stage #layer_s2')`, true);

    // Deleting removes that row and renumbers again.
    await session.evaluate(`document.querySelectorAll('#sub_list .delete_sub_button')[1].click()`);
    await sleep(300);
    await step('delete removes the row and renumbers', nums, 's0,s1');
    await step('layer count follows the list',
        `document.querySelectorAll('#preview_stage g[id^="layer_s"][inkscape\\\\:label]').length > 0
         && !document.querySelector('#preview_stage #layer_s2')`, true);

    // An empty field must be exactly one line tall.
    await session.evaluate(`document.querySelectorAll('#sub_list .add_sub_button')[0].click()`);
    await sleep(300);
    await step('empty field is one line tall', `(() => {
        const a = document.querySelectorAll('#sub_list .sub_block')[1].querySelector('textarea');
        const cs = getComputedStyle(a);
        const oneLine = parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
            + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        return Math.round(a.getBoundingClientRect().height) === Math.round(oneLine);
    })()`, true);
    await session.evaluate(`document.querySelectorAll('#sub_list .delete_sub_button')[1].click()`);
    await sleep(250);

    // Clicking the expanded area (not a field or button) collapses the row.
    await session.evaluate(`document.querySelector('#sub_list .sub_num').click()`);
    await sleep(250);
    await step('row expands on click', `document.querySelectorAll('#sub_list .sub_block.is_open').length`, 1);
    await session.evaluate(`document.querySelector('#sub_list .sub_block.is_open .text_fields_block').click()`);
    await sleep(250);
    await step('clicking the expanded body collapses the row',
        `document.querySelectorAll('#sub_list .sub_block.is_open').length`, 0);
    await session.evaluate(`document.querySelector('#sub_list .sub_block textarea').click()`);
    await sleep(200);
    await step('clicking a field does not toggle the row',
        `document.querySelectorAll('#sub_list .sub_block.is_open').length`, 0);

    // Force the list to overflow so the scrollbar is really there to measure.
    await step('sub_list scrollbar is 4px wide', `(() => {
        const l = document.getElementById('sub_list');
        const prev = l.style.cssText;
        l.style.height = '40px';
        l.style.flex = '0 0 auto';
        const overflowing = l.scrollHeight > l.clientHeight;
        const width = l.offsetWidth - l.clientWidth;
        l.style.cssText = prev;
        return overflowing ? width : 'no-overflow';
    })()`, 4);

    // ---- sidebar resize: the whole right edge must be draggable --------------

    await step('resize handle spans the full sidebar height', `(() => {
        const s = document.getElementById('sud_sidebloсk').getBoundingClientRect();
        const h = document.getElementById('resize_handle').getBoundingClientRect();
        return Math.round(h.height) === Math.round(s.height)
            && Math.abs(h.left + h.width / 2 - s.right) <= 4;
    })()`, true);

    {
        const box = await session.evaluate(`(() => {
            const h = document.getElementById('resize_handle').getBoundingClientRect();
            return { x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height / 2) };
        })()`);
        const drag = async (type, x, y) => session.send('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
            pointerType: 'mouse',
        });
        // Grab the middle of the edge, not the corner, and pull right.
        await drag('mousePressed', box.x, box.y);
        await drag('mouseMoved', box.x + 120, box.y);
        await drag('mouseReleased', box.x + 120, box.y);
        await sleep(200);
        const widened = await session.evaluate(
            `Math.round(document.getElementById('sud_sidebloсk').getBoundingClientRect().width)`);
        if (widened !== 480) {
            failures++;
            console.log(`FAIL  dragging the edge resizes the sidebar\n        got: ${widened}, expected 480`);
        } else {
            console.log('PASS  dragging the middle of the right edge resizes the sidebar (360 -> 480)');
        }

        // And it must refuse to go below the 360px minimum.
        await drag('mousePressed', box.x + 120, box.y);
        await drag('mouseMoved', box.x - 400, box.y);
        await drag('mouseReleased', box.x - 400, box.y);
        await sleep(200);
        await step('sidebar stops at the 360px minimum',
            `Math.round(document.getElementById('sud_sidebloсk').getBoundingClientRect().width)`, 360);
    }

    // ---- first screen: nothing loaded yet -----------------------------------

    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);
    await sleep(200);

    await step('starts with a single expanded s0', `(() => {
        return {
            blocks: document.querySelectorAll('#sub_list .sub_block').length,
            label: document.querySelector('#sub_list .sub_num').textContent,
            open: document.querySelectorAll('#sub_list .sub_block.is_open').length,
            fields: document.querySelectorAll('#sub_list textarea').length,
            empty: [...document.querySelectorAll('#sub_list textarea')].every(a => a.value === ''),
        };
    })()`, { blocks: 1, label: 's0', open: 1, fields: 2, empty: true });

    await step('a lone subject offers no delete button',
        `document.querySelectorAll('#sub_list .delete_sub_button').length`, 0);

    await step('only the filled upload button is offered', `(() => {
        const cs = (id, p) => getComputedStyle(document.getElementById(id))[p];
        return {
            upload: cs('upload_button', 'backgroundColor'),
            download: cs('download_button', 'display'),
            copy: cs('copy_button', 'display'),
        };
    })()`, { upload: 'rgb(76, 76, 255)', download: 'none', copy: 'none' });

    await step('preview shows the drop target instead of an svg', `(() => {
        const cs = (id, p) => getComputedStyle(document.getElementById(id))[p];
        const outer = document.getElementById('svg_privew_block').getBoundingClientRect();
        const inner = document.getElementById('first_screen').getBoundingClientRect();
        const rect = document.querySelector('#first_screen .dash_frame rect');
        return {
            firstScreen: cs('first_screen', 'display') !== 'none',
            stageHidden: cs('preview_stage', 'display') === 'none',
            icon: !!document.querySelector('#first_screen .upload_file_icon'),
            text: document.querySelector('#first_screen .first_screen_text').textContent,
            lineBreak: !!document.querySelector('#first_screen .first_screen_text br'),
            inset: [inner.left - outer.left, inner.top - outer.top,
                    outer.right - inner.right, outer.bottom - inner.bottom].map(Math.round).join(','),
            stroke: getComputedStyle(rect).stroke,
            dashes: getComputedStyle(rect).strokeDasharray,
        };
    })()`, {
        firstScreen: true,
        stageHidden: true,
        icon: true,
        text: 'Перетащите в окно svg-файлили введите svg-код для заливки (fill) и внутренних линий (str) первого субъекта',
        lineBreak: true,
        inset: '10,10,10,10',
        stroke: 'rgb(255, 255, 255)',
        dashes: '14px, 14px',
    });

    // ---- drag overlay -------------------------------------------------------
    // Still on the first screen, so the frame underneath is there to be hidden.

    await step('a dragged file veils the page with a bordered block', `(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['<svg></svg>'], 'x.svg', { type: 'image/svg+xml' }));
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        const overlay = document.getElementById('drop_overlay');
        const block = overlay.querySelector('.drag_and_drop_block');
        const outer = overlay.getBoundingClientRect();
        const inner = block.getBoundingClientRect();
        const rect = block.querySelector('.dash_frame rect');
        const out = {
            shown: getComputedStyle(overlay).display !== 'none',
            covers: getComputedStyle(overlay).position === 'fixed'
                && Math.round(outer.width) === document.documentElement.clientWidth
                && Math.round(outer.height) === document.documentElement.clientHeight,
            bg: getComputedStyle(overlay).backgroundColor,
            text: overlay.textContent.trim(),
            inset: [inner.left - outer.left, inner.top - outer.top,
                    outer.right - inner.right, outer.bottom - inner.bottom].map(Math.round).join(','),
            stroke: getComputedStyle(rect).stroke,
            dashes: getComputedStyle(rect).strokeDasharray,
            // The overlay draws the only frame while the drag lasts.
            firstScreenVisible: getComputedStyle(document.getElementById('first_screen')).display !== 'none',
            firstFrameHidden: getComputedStyle(
                document.querySelector('#first_screen .dash_frame')).display === 'none',
        };
        window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, cancelable: true }));
        return out;
    })()`, {
        shown: true,
        covers: true,
        bg: 'rgba(17, 17, 28, 0.8)',
        text: '',
        inset: '10,10,10,10',
        stroke: 'rgb(255, 255, 255)',
        dashes: '14px, 14px',
        firstScreenVisible: true,
        firstFrameHidden: true,
    });

    await step('the veil and the first screen frame come back as they were', `(() => {
        const cs = (el, p) => getComputedStyle(el)[p];
        return {
            overlay: cs(document.getElementById('drop_overlay'), 'display'),
            firstFrame: cs(document.querySelector('#first_screen .dash_frame'), 'display'),
        };
    })()`, { overlay: 'none', firstFrame: 'block' });

    // Typing into the empty fields is the other way off the first screen.
    await session.evaluate(`(() => {
        const a = document.querySelector('#sub_list .sub_block.is_open textarea');
        a.value = '<path d="M0,0L100,0L100,80L0,80Z"></path>';
        a.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);

    await step('typed code brings back the preview and the export buttons', `(() => {
        const cs = (id, p) => getComputedStyle(document.getElementById(id))[p];
        return {
            firstScreenGone: cs('first_screen', 'display') === 'none',
            preview: !!document.querySelector('#preview_stage svg'),
            upload: cs('upload_button', 'backgroundColor'),
            download: cs('download_button', 'display') !== 'none'
                && !document.getElementById('download_button').disabled,
            copy: cs('copy_button', 'display') !== 'none'
                && !document.getElementById('copy_button').disabled,
        };
    })()`, {
        firstScreenGone: true, preview: true, upload: 'rgba(0, 0, 0, 0)', download: true, copy: true,
    });

    if (errors.length) {
        failures++;
        console.log('\nPage errors:');
        errors.forEach((e) => console.log('  ' + e));
    }

    session.close();
} catch (err) {
    failures++;
    console.error('E2E harness error:', err.message);
} finally {
    chrome.kill();
    await sleep(300);
    fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll end-to-end checks passed.');
process.exit(failures ? 1 : 0);
