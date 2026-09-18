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
    // The settings toolbar is laid out for 1920; in a default 800px window its
    // controls are clipped and clicks aimed at them land on the segments.
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--window-size=1600,900',
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
            const svg = document.querySelector('#preview_svg svg');
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
                sidebarBorderColour: cs(side, 'borderRightColor'),
                sidebarPadTop: cs(side, 'paddingTop'),
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
        want('sidebar right border', report.sidebarBorder, '1px');
        want('sidebar right border colour', report.sidebarBorderColour, 'rgb(55, 55, 93)');
        want('sidebar top padding', report.sidebarPadTop, '8px');
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
    const viewBox = `document.querySelector('#preview_svg svg').getAttribute('viewBox')`;

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

    // ---- head line, sort button and subject highlights ----------------------

    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);
    {
        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId, files: [path.join(root, 'src_doc', 'files', 'PK_3m4v7s_R-R-R_ai_draft.svg')],
        });
        await waitUntil(session, `document.body.dataset.loaded === 'true'`);
        await sleep(300);
    }

    await step('head_line carries the title and the sort button', `(() => {
        const head = document.querySelector('.head_line');
        const title = head.querySelector('.sidebar_title');
        const button = document.getElementById('sort_button');
        const icon = button.querySelector('img');
        return {
            inHead: !!title && !!button && button.parentElement === head,
            titleText: title.textContent,
            order: title.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING ? 'button after title' : 'button before title',
            wrapGap: getComputedStyle(document.querySelector('.sub_list_wrap')).rowGap,
            icon: icon.getAttribute('src').split('/').pop(),
            opacity: getComputedStyle(button).opacity,
        };
    })()`, {
        inHead: true,
        titleText: 'Субъекты',
        order: 'button after title',
        wrapGap: '8px',
        icon: 'sort_down_icon.svg',
        opacity: '0.5',
    });

    // The code typed for the last subject has to come out as s0.
    const fills = `[...document.querySelectorAll('#sub_list .sub_block')]
        .map(b => b.querySelector('textarea').value.slice(0, 24)).join('|')`;
    const beforeSort = await session.evaluate(fills);
    await session.evaluate(`document.getElementById('sort_button').click()`);
    await sleep(300);
    const afterSort = await session.evaluate(fills);
    if (afterSort === beforeSort.split('|').reverse().join('|') && beforeSort !== afterSort) {
        console.log('PASS  sort reverses the subjects, last code becomes s0');
    } else {
        failures++;
        console.log(`FAIL  sort reverses the subjects\n        before: ${beforeSort}\n        after:  ${afterSort}`);
    }

    await step('sort flips the arrow and the numbering stays s0..s6', `(() => {
        return {
            icon: document.querySelector('#sort_button img').getAttribute('src').split('/').pop(),
            labels: [...document.querySelectorAll('#sub_list .sub_num')].map(e => e.textContent).join(','),
            layers: !!document.querySelector('#preview_svg #layer_s6') && !document.querySelector('#preview_svg #layer_s7'),
        };
    })()`, { icon: 'sort_up_icon.svg', labels: 's0,s1,s2,s3,s4,s5,s6', layers: true });

    await session.evaluate(`document.getElementById('sort_button').click()`);
    await sleep(300);
    await step('sorting again puts the order and the arrow back', `(() => ({
        icon: document.querySelector('#sort_button img').getAttribute('src').split('/').pop(),
        fills: ${fills},
    }))()`, { icon: 'sort_down_icon.svg', fills: beforeSort });

    await step('each subject has a tint, an outline and a hit area', `(() => {
        const rects = (sel) => document.querySelectorAll(sel).length;
        const outline = document.querySelector('#highlight_front .hl_outline');
        const tint = document.querySelector('#highlight_back .hl_tint');
        const front = document.getElementById('highlight_front');
        const svg = document.querySelector('#preview_svg svg');
        return {
            tints: rects('#highlight_back .hl_tint'),
            outlines: rects('#highlight_front .hl_outline'),
            hits: rects('#highlight_front .hl_hit'),
            // Same viewBox and same box as the file, so the two line up exactly.
            sameViewBox: front.getAttribute('viewBox') === svg.getAttribute('viewBox'),
            stroke: getComputedStyle(outline).stroke,
            strokeWidth: outline.getAttribute('stroke-width'),
            outlineFill: getComputedStyle(outline).fill,
            tintFill: getComputedStyle(tint).fill,
            tintOpacity: getComputedStyle(tint).fillOpacity,
            tintStroke: getComputedStyle(tint).stroke,
            layerTakesNoClicks: getComputedStyle(front).pointerEvents,
        };
    })()`, {
        tints: 7,
        outlines: 7,
        hits: 7,
        sameViewBox: true,
        stroke: 'rgb(255, 0, 251)',
        strokeWidth: '2',
        outlineFill: 'none',
        tintFill: 'rgb(255, 0, 251)',
        tintOpacity: '0.1',
        tintStroke: 'none',
        layerTakesNoClicks: 'none',
    });

    // The frame drawn must be the one the file gives the subject.
    await step('the rectangle covers the subject exactly', `(() => {
        const n = 2;
        const frame = document.querySelector('#preview_svg #layer_s' + n + '_frame rect');
        const outline = document.querySelector('#highlight_front .hl_outline[data-index="' + n + '"]');
        const tint = document.querySelector('#highlight_back .hl_tint[data-index="' + n + '"]');
        const read = (el) => ['x', 'y', 'width', 'height']
            .map(a => Math.round(parseFloat(el.getAttribute(a)) * 100) / 100).join(',');
        return { outline: read(outline) === read(frame), tint: read(tint) === read(frame) };
    })()`, { outline: true, tint: true });

    const lit = `[...document.querySelectorAll('#highlight_front .hl_outline.is_on, #highlight_back .hl_tint.is_on')]
        .map(r => r.dataset.index).join(',')`;

    await session.evaluate(`document.querySelectorAll('#sub_list .sub_block')[3]
        .dispatchEvent(new MouseEvent('mouseenter'))`);
    await sleep(150);
    await step('pointing at a row lights that subject only', lit, '3,3');

    await session.evaluate(`document.querySelectorAll('#sub_list .sub_block')[3]
        .dispatchEvent(new MouseEvent('mouseleave'))`);
    await sleep(150);
    await step('leaving the row puts it out', lit, '');

    // Squeeze the list so that centring a row has somewhere to scroll to.
    await session.evaluate(`(() => {
        const l = document.getElementById('sub_list');
        l.style.height = '120px';
        l.style.flex = '0 0 auto';
    })()`);
    await sleep(150);

    await step('pointing at the drawing marks the row and centres it', `(() => {
        const hit = document.querySelector('#highlight_front .hl_hit[data-index="3"]');
        hit.dispatchEvent(new MouseEvent('mouseenter'));
        const list = document.getElementById('sub_list');
        const block = document.querySelectorAll('#sub_list .sub_block')[3];
        const lb = block.getBoundingClientRect();
        const ll = list.getBoundingClientRect();
        return {
            lit: ${lit},
            rowMarked: block.classList.contains('is_hover'),
            scrolled: list.scrollTop > 0,
            // Rows are fractional pixels tall, so dead centre is within a pixel.
            centred: Math.abs((lb.top + lb.height / 2) - (ll.top + ll.height / 2)) <= 2,
        };
    })()`, { lit: '3,3', rowMarked: true, scrolled: true, centred: true });

    await step('leaving the drawing clears the row', `(() => {
        document.querySelector('#highlight_front .hl_hit[data-index="3"]')
            .dispatchEvent(new MouseEvent('mouseleave'));
        return {
            lit: ${lit},
            marked: document.querySelectorAll('#sub_list .sub_block.is_hover').length,
        };
    })()`, { lit: '', marked: 0 });

    await session.evaluate(`(() => {
        const l = document.getElementById('sub_list');
        l.style.height = '';
        l.style.flex = '';
    })()`);

    await step('clicking a subject in the drawing expands its row', `(() => {
        document.querySelector('#highlight_front .hl_hit[data-index="4"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return {
            open: [...document.querySelectorAll('#sub_list .sub_block')]
                .map((b, i) => b.classList.contains('is_open') ? i : '').filter(v => v !== '').join(','),
            lit: ${lit},
        };
    })()`, { open: '4', lit: '4,4' });

    await step('an expanded row keeps its rectangle without the cursor', lit, '4,4');

    await step('clicking past the subjects collapses everything', `(() => {
        document.getElementById('preview_stage').click();
        return {
            open: document.querySelectorAll('#sub_list .sub_block.is_open').length,
            lit: ${lit},
        };
    })()`, { open: 0, lit: '' });

    // ---- carrying a row to a new place --------------------------------------

    await step('a row is filled #1A1A28 while the cursor is on it', `(() => {
        const block = document.querySelectorAll('#sub_list .sub_block')[1];
        block.classList.add('is_hover');
        const bg = getComputedStyle(block).backgroundColor;
        block.classList.remove('is_hover');
        return bg;
    })()`, 'rgb(26, 26, 40)');

    {
        const mouse = async (type, x, y) => session.send('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
            clickCount: 1, pointerType: 'mouse',
        });
        const rowGeometry = `(() => {
            const rows = [...document.querySelectorAll('#sub_list .sub_block')];
            const r = rows[0].getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), h: Math.round(r.height) };
        })()`;

        const before = await session.evaluate(fills);
        const g = await session.evaluate(rowGeometry);
        const restingHeight = await session.evaluate(`document.getElementById('sub_list').scrollHeight`);

        // Press on s0 and carry it down past three neighbours.
        await mouse('mousePressed', g.x, g.y);
        // Far enough past the third row's midpoint to land there, and not so far
        // as to reach the fourth.
        let travel = 0;
        for (let dy = 8; dy <= g.h * 2 + 16; dy += 8) {
            await mouse('mouseMoved', g.x, g.y + dy);
            travel = dy;
        }
        const carried = await session.evaluate(`(() => {
            const rows = [...document.querySelectorAll('#sub_list .sub_block')];
            // The row in hand is lifted clean out of the list; its copy holds
            // the place in the list that it would drop into.
            const block = document.querySelector('body > .sub_block.is_dragging');
            const ghost = document.querySelector('#sub_list .sub_block_ghost');
            const list = document.getElementById('sub_list').getBoundingClientRect();
            const r = block && block.getBoundingClientRect();
            return {
                lifted: !!block,
                // The numbers are left alone until the drop, so the row keeps
                // the one it was picked up with and the rest keep theirs.
                labels: rows.map(b => b.querySelector('.sub_num').textContent).join(','),
                // The list still holds one row per subject, the copy included.
                rowCount: rows.length,
                copyInGap: !!ghost && ghost.querySelector('.sub_num').textContent === 's0',
                copyFill: ghost ? getComputedStyle(ghost).backgroundColor : '',
                gapAt: ghost ? rows.indexOf(ghost) : -1,
                fill: block ? getComputedStyle(block).backgroundColor : '',
                // It rides with the cursor instead of snapping into a slot.
                lifts: block ? getComputedStyle(block).position : '',
                // It was grabbed at its middle, so its middle is at the cursor.
                middle: r ? Math.round(r.top + r.height / 2) : 0,
                // Nothing else in the list is lit while a row is in hand.
                otherFills: [...new Set(rows.map(b => getComputedStyle(b).backgroundColor))].join(','),
                // The gap it would drop into is marked on the rows either side.
                marked: rows.map((b, i) => b.classList.contains('is_drop_above') ? 'above' + i
                    : (b.classList.contains('is_drop_below') ? 'below' + i : '')).filter(Boolean).join(','),
                markColour: (() => {
                    const above = document.querySelector('#sub_list .is_drop_above');
                    if (!above) return '';
                    const s = getComputedStyle(above, '::after');
                    return [s.backgroundColor, s.height].join(' ');
                })(),
                // A 2px line must not push the rows below it around.
                contentHeight: document.getElementById('sub_list').scrollHeight,
                insideList: r ? r.top >= list.top - 1 && r.bottom <= list.bottom + 1 : false,
            };
        })()`);
        await mouse('mouseReleased', g.x, g.y + travel);
        await sleep(300);

        const after = await session.evaluate(fills);
        const order = before.split('|');
        const expected = [order[1], order[2], order[3], order[0], ...order.slice(4)].join('|');
        const cursorY = g.y + travel;

        const problems = [];
        if (!carried.lifted) problems.push('the row was never picked up');
        if (carried.labels !== 's1,s2,s3,s0,s4,s5,s6') problems.push(`numbering while carried: ${carried.labels}`);
        if (carried.gapAt !== 3) problems.push(`the gap sat at ${carried.gapAt}, expected 3`);
        if (carried.rowCount !== 7) problems.push(`the list holds ${carried.rowCount} rows, expected 7`);
        if (!carried.copyInGap) problems.push('the gap holds no copy of the carried row');
        if (carried.copyFill !== 'rgba(0, 0, 0, 0)') problems.push(`the copy is filled ${carried.copyFill}`);
        if (carried.fill !== 'rgb(26, 26, 40)') problems.push(`carried row fill: ${carried.fill}`);
        if (carried.otherFills !== 'rgba(0, 0, 0, 0)') problems.push(`rows in the list are lit: ${carried.otherFills}`);
        if (carried.lifts !== 'fixed') problems.push(`the carried row is ${carried.lifts}, not lifted out`);
        if (Math.abs(carried.middle - cursorY) > 2) problems.push(`row middle at ${carried.middle}, cursor at ${cursorY}`);
        if (!carried.insideList) problems.push('the carried row left the list');
        if (carried.marked !== 'above2,below4') problems.push(`drop gap marked on: ${carried.marked || 'nothing'}`);
        if (carried.markColour !== 'rgb(147, 147, 255) 2px') problems.push(`drop line is ${carried.markColour}`);
        if (carried.contentHeight !== restingHeight) problems.push(`the marks moved the rows: list grew from ${restingHeight} to ${carried.contentHeight}`);
        if (after !== expected) problems.push(`order after drop: ${after}\n        expected:           ${expected}`);
        if (problems.length) { failures++; console.log('FAIL  dragging a row reorders the list'); problems.forEach(p => console.log('        ' + p)); }
        else console.log('PASS  the carried row follows the cursor, its neighbours move aside, the drop renumbers');

        await step('the drop leaves no drag marks behind', `(() => ({
            dragging: document.querySelectorAll('.sub_block.is_dragging, .sub_block_ghost').length,
            dropGap: document.querySelectorAll('#sub_list .is_drop_above, #sub_list .is_drop_below').length,
            body: document.body.classList.contains('is_row_dragging'),
            labels: [...document.querySelectorAll('#sub_list .sub_num')].map(e => e.textContent).join(','),
            // The rebuilt file has to follow the new order, not the old one.
            firstLayerFill: document.querySelector('#preview_svg #layer_s0_fill').innerHTML.trim().slice(0, 24),
        }))()`, {
            dragging: 0,
            dropGap: 0,
            body: false,
            labels: 's0,s1,s2,s3,s4,s5,s6',
            firstLayerFill: expected.split('|')[0],
        });

        // A press that does not travel is still a click.
        const g2 = await session.evaluate(rowGeometry);
        await mouse('mousePressed', g2.x, g2.y);
        await mouse('mouseReleased', g2.x, g2.y);
        await sleep(250);
        await step('pressing without moving still expands the row',
            `[...document.querySelectorAll('#sub_list .sub_block')].findIndex(b => b.classList.contains('is_open'))`, 0);

        // The empty part of the list belongs to no subject. The window here is
        // too short to be sure of a gap under the last row, so the click is
        // aimed at the list itself rather than at a point in it.
        await step('clicking the list outside any row collapses every row', `(() => {
            document.getElementById('sub_list').click();
            // The cursor is still resting where the last press left it, and a
            // hovered row is lit in its own right; take it off the rows so what
            // is left is only what being expanded was lighting.
            document.querySelectorAll('#sub_list .sub_block')
                .forEach(b => b.dispatchEvent(new MouseEvent('mouseleave')));
            return {
                open: document.querySelectorAll('#sub_list .sub_block.is_open').length,
                lit: ${lit},
            };
        })()`, { open: 0, lit: '' });

        // Carrying a row off the bottom of a list too short to show it all has
        // to bring the rest of the list up to meet it.
        await session.evaluate(`(() => {
            const l = document.getElementById('sub_list');
            l.style.height = '110px';
            l.style.flex = '0 0 auto';
        })()`);
        await sleep(150);

        const g3 = await session.evaluate(rowGeometry);
        const listBottom = await session.evaluate(
            `Math.round(document.getElementById('sub_list').getBoundingClientRect().bottom)`);
        await mouse('mousePressed', g3.x, g3.y);
        for (let y = g3.y + 8; y <= listBottom + 30; y += 10) await mouse('mouseMoved', g3.x, y);
        await sleep(400);   // the edge timer runs on its own once it is armed
        const scrolled = await session.evaluate(`(() => {
            const list = document.getElementById('sub_list');
            const block = document.querySelector('body > .sub_block.is_dragging');
            const r = block.getBoundingClientRect();
            const lr = list.getBoundingClientRect();
            return {
                scrolled: list.scrollTop > 0,
                stillVisible: r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1,
            };
        })()`);
        await mouse('mouseReleased', g3.x, listBottom + 30);
        await sleep(300);

        if (scrolled.scrolled && scrolled.stillVisible) {
            console.log('PASS  carrying a row past the bottom scrolls the list and keeps it in view');
        } else {
            failures++;
            console.log(`FAIL  carrying a row past the bottom scrolls the list\n        got: ${JSON.stringify(scrolled)}`);
        }

        await step('the row ends up last after being carried off the bottom',
            `[...document.querySelectorAll('#sub_list .sub_block')].map(b => b.querySelector('textarea').value.slice(0, 24)).pop()`,
            expected.split('|')[0]);

        await session.evaluate(`(() => {
            const l = document.getElementById('sub_list');
            l.style.height = '';
            l.style.flex = '';
        })()`);
    }

    // ---- settings toolbar ---------------------------------------------------

    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);
    {
        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId, files: [path.join(root, 'src_doc', 'files', 'PG_2m1v2s_S-S_figma_draft.svg')],
        });
        await waitUntil(session, `document.body.dataset.loaded === 'true'`);
        await sleep(300);
    }

    await step('the toolbar sits above the preview and is 40px tall', `(() => {
        const bar = document.getElementById('settings_toolbar');
        const preview = document.getElementById('svg_privew_block');
        const r = bar.getBoundingClientRect();
        const cs = getComputedStyle(bar);
        return {
            height: Math.round(r.height),
            abovePreview: Math.round(r.bottom) <= Math.round(preview.getBoundingClientRect().top),
            rightOfSidebar: Math.round(r.left) >= Math.round(document.getElementById('sud_sidebloсk').getBoundingClientRect().right),
            background: cs.backgroundColor,
            rule: [cs.borderBottomWidth, cs.borderBottomColor].join(' '),
            blocks: [...bar.querySelectorAll('.indicators_settings, .lines_settings, .hatching_settings, .layer_selection_block')]
                .map(b => b.className.split(' ')[0]).join(','),
        };
    })()`, {
        height: 40,
        abovePreview: true,
        rightOfSidebar: true,
        background: 'rgb(17, 17, 28)',
        rule: '1px rgb(55, 55, 93)',
        blocks: 'indicators_settings,lines_settings,hatching_settings,layer_selection_block',
    });

    // ---- layer segments

    const shownLayers = `(() => {
        const on = new Set();
        for (const g of document.querySelectorAll('#preview_svg g[id^="layer_s"]')) {
            const m = /^layer_s\\d+_(otlichno|norm|tpm|ndp|repair|background)$/.exec(g.id);
            if (m && getComputedStyle(g).display !== 'none') on.add(m[1]);
        }
        return [...on].join(',');
    })()`;

    await step('six segments, otlichno chosen, and only that layer showing', `(() => {
        const segs = [...document.querySelectorAll('#segments .segment')];
        const on = document.querySelector('#segments .segment.is_on');
        const cs = getComputedStyle(on);
        return {
            order: segs.map(s => s.dataset.layer).join(','),
            chosen: on.dataset.layer,
            name: document.getElementById('layer_name').textContent,
            // A 2px white ring, raised so it draws over the segments beside it.
            ring: [cs.outlineWidth, cs.outlineColor, cs.outlineStyle].join(' '),
            raised: cs.zIndex,
            showing: ${shownLayers},
        };
    })()`, {
        order: 'otlichno,norm,tpm,ndp,repair,background',
        chosen: 'otlichno',
        name: 'Отлично',
        ring: '2px rgb(255, 255, 255) solid',
        raised: '1',
        showing: 'otlichno',
    });

    await step('every layer is still in the document, just hidden', `(() => {
        const all = [...document.querySelectorAll('#preview_svg g[id^="layer_s"]')]
            .filter(g => /^layer_s\\d+_(otlichno|norm|tpm|ndp|repair|background)$/.test(g.id));
        const hidden = all.filter(g => g.style.display === 'none');
        return {
            // 2 subjects x 6 state layers.
            groups: all.length,
            hiddenInline: hidden.length,
            // The labels the file carries: 20 per subject plus 4 for layer_o.
            labels: document.querySelectorAll('#preview_svg [inkscape\\\\:label]').length,
        };
    })()`, { groups: 12, hiddenInline: 10, labels: 44 });

    await step('pointing at a segment shows that layer', `(() => {
        document.querySelector('#segments [data-layer="ndp"]').dispatchEvent(new MouseEvent('mouseenter'));
        return {
            showing: ${shownLayers},
            name: document.getElementById('layer_name').textContent,
            ringOn: document.querySelector('#segments .segment.is_on').dataset.layer,
        };
    })()`, { showing: 'ndp', name: 'НДП', ringOn: 'ndp' });

    await step('leaving the segments falls back to the one last clicked', `(() => {
        document.getElementById('segments').dispatchEvent(new MouseEvent('mouseleave'));
        return { showing: ${shownLayers}, name: document.getElementById('layer_name').textContent };
    })()`, { showing: 'otlichno', name: 'Отлично' });

    await step('clicking a segment keeps it after the cursor leaves', `(() => {
        const seg = document.querySelector('#segments [data-layer="repair"]');
        seg.dispatchEvent(new MouseEvent('mouseenter'));
        seg.click();
        document.getElementById('segments').dispatchEvent(new MouseEvent('mouseleave'));
        return { showing: ${shownLayers}, name: document.getElementById('layer_name').textContent };
    })()`, { showing: 'repair', name: 'Ремонт' });

    {
        // The stripe is 15px tall in a 40px bar; the pointer gets the whole
        // height of the bar over the same width.
        const aim = await session.evaluate(`(() => {
            const seg = document.querySelector('#segments [data-layer="tpm"]');
            const bar = document.getElementById('settings_toolbar').getBoundingClientRect();
            const r = seg.getBoundingClientRect();
            return {
                x: Math.round(r.left + r.width / 2),
                // Well above the stripe, but still inside the bar.
                y: Math.round(bar.top + 3),
                stripeTop: Math.round(r.top),
                left: Math.round(r.left - 3),
            };
        })()`);
        const mouse = async (type, x, y) => session.send('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse',
        });
        await mouse('mouseMoved', aim.x, aim.y);
        await sleep(200);
        const hovered = await session.evaluate(`(document.querySelector('#segments .segment.is_on') || {dataset:{}}).dataset.layer`);
        await mouse('mousePressed', aim.x, aim.y);
        await mouse('mouseReleased', aim.x, aim.y);
        await sleep(200);
        const clicked = await session.evaluate(`document.getElementById('layer_name').textContent`);

        // The area grew in height only: at the top of the bar the segment
        // answers across its own width and no further.
        const bounds = await session.evaluate(`(() => {
            const seg = document.querySelector('#segments [data-layer="tpm"]');
            const segs = document.getElementById('segments').getBoundingClientRect();
            const r = seg.getBoundingClientRect();
            const y = ${aim.y};
            const at = (x) => {
                const hit = document.elementFromPoint(Math.round(x), y);
                return hit && hit.closest('.segment') ? hit.closest('.segment').dataset.layer : 'none';
            };
            return {
                middle: at(r.left + r.width / 2),
                justInside: at(r.left + 1),
                nextOne: at(r.left - 2),
                pastTheEnd: at(segs.right + 3),
                beforeTheStart: at(segs.left - 3),
            };
        })()`);

        const ok = hovered === 'tpm' && clicked === 'ТПМ' && aim.y < aim.stripeTop - 5
            && bounds.middle === 'tpm' && bounds.justInside === 'tpm'
            && bounds.nextOne === 'norm'
            && bounds.pastTheEnd === 'none' && bounds.beforeTheStart === 'none';
        if (ok) console.log('PASS  a segment answers to the whole height of the bar, at its own width');
        else {
            failures++;
            console.log(`FAIL  a segment answers to the whole height of the bar\n        hovered ${hovered} at y=${aim.y} (stripe starts ${aim.stripeTop}), clicked ${clicked}\n        across the bar top: ${JSON.stringify(bounds)}`);
        }
    }

    await session.evaluate(`document.querySelector('#segments [data-layer="otlichno"]').click()`);

    // ---- indicator switch

    const indicatorsShown = `[...document.querySelectorAll('#preview_svg g[id^="layer_s"]')]
        .filter(g => /^layer_s\\d+_(fail|old_sost|old_repair|old_lock|insert)$/.test(g.id))
        .filter(g => getComputedStyle(g).display !== 'none').length`;

    await step('the switch starts on with every indicator showing',
        `({ on: document.getElementById('indicators_switch').classList.contains('is_on'), showing: ${indicatorsShown} })`,
        { on: true, showing: 10 });

    await step('switching off hides the indicators but keeps them in the file', `(() => {
        document.getElementById('indicators_switch').click();
        const groups = [...document.querySelectorAll('#preview_svg g[id^="layer_s"]')]
            .filter(g => /^layer_s\\d+_(fail|old_sost|old_repair|old_lock|insert)$/.test(g.id));
        return {
            on: document.getElementById('indicators_switch').classList.contains('is_on'),
            showing: ${indicatorsShown},
            stillThere: groups.length,
            // Hidden by an inline style on the copy, not cut out of the markup.
            hiddenInline: groups.every(g => g.style.display === 'none'),
            uses: document.querySelectorAll('#preview_svg use[*|href="#fail"]').length,
        };
    })()`, { on: false, showing: 0, stillThere: 10, hiddenInline: true, uses: 2 });

    await session.evaluate(`document.getElementById('indicators_switch').click()`);
    await step('switching back on shows them again', indicatorsShown, 10);

    // ---- indicator size slider

    await step('the slider starts on the 45px template', `(() => {
        const knob = document.getElementById('slider_knob');
        const slider = document.getElementById('indicators_slider');
        return {
            label: document.getElementById('indicators_label').textContent,
            // 45 is the sixth of the seven prepared sizes.
            atFraction: Math.round((parseFloat(knob.style.left) / (slider.clientWidth - 8)) * 6),
            circle: document.querySelector('#preview_svg #circle circle').getAttribute('r'),
            stroke: document.querySelector('#preview_svg style').textContent.includes('stroke-width:3.40'),
        };
    })()`, { label: 'Индикаторы 45 px', atFraction: 5, circle: '20.8', stroke: true });

    {
        const box = await session.evaluate(`(() => {
            const r = document.getElementById('indicators_slider').getBoundingClientRect();
            return { left: Math.round(r.left), top: Math.round(r.top + r.height / 2), width: Math.round(r.width) };
        })()`);
        const mouse = async (type, x, y) => session.send('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse',
        });
        // Drag the knob to the far left: the smallest prepared template.
        await mouse('mousePressed', box.left + box.width - 4, box.top);
        await mouse('mouseMoved', box.left + box.width / 2, box.top);
        await mouse('mouseMoved', box.left + 1, box.top);
        await mouse('mouseReleased', box.left + 1, box.top);
        await sleep(300);

        await step('dragging the knob swaps in another prepared template', `(() => ({
            label: document.getElementById('indicators_label').textContent,
            circle: document.querySelector('#preview_svg #circle circle').getAttribute('r'),
            // Each size brings its own outer stroke; nothing is scaled.
            stroke: document.querySelector('#preview_svg style').textContent.includes('stroke-width:1.60'),
            noScale: document.querySelector('#preview_svg style').textContent.includes('scale(1.00)'),
            filled: Math.round(parseFloat(document.getElementById('slider_filled').style.width)),
        }))()`, { label: 'Индикаторы 20 px', circle: '9.2', stroke: true, noScale: true, filled: 4 });

        await mouse('mousePressed', box.left + box.width - 1, box.top);
        await mouse('mouseReleased', box.left + box.width - 1, box.top);
        await sleep(300);
        await step('and back up to the largest', `document.getElementById('indicators_label').textContent`,
            'Индикаторы 60 px');
    }

    // Stepping back down to 45 also puts the defaults back for what follows.
    await step('a size change turns the indicators back on', `(() => {
        document.getElementById('indicators_switch').click();
        const off = { on: document.getElementById('indicators_switch').classList.contains('is_on'), showing: ${indicatorsShown} };
        const s = document.getElementById('indicators_slider');
        s.focus();
        s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        return {
            off,
            // Arrow keys step through the sizes as dragging does.
            label: document.getElementById('indicators_label').textContent,
            on: document.getElementById('indicators_switch').classList.contains('is_on'),
            showing: ${indicatorsShown},
        };
    })()`, {
        off: { on: false, showing: 0 },
        label: 'Индикаторы 45 px',
        on: true,
        showing: 10,
    });

    // ---- number fields

    await step('the fields show their units until they are edited', `(() => {
        const v = (id) => document.getElementById(id).value;
        return [v('line_out'), v('line_in'), v('hatch_angle'), v('hatch_width'), v('hatch_coverage')].join('|');
    })()`, '2 px|2 px|45°|4 px|30 %');

    await step('focus drops the unit and selects the number', `(() => {
        const f = document.getElementById('line_out');
        f.focus();
        return { value: f.value, selected: f.value.slice(f.selectionStart, f.selectionEnd) };
    })()`, { value: '2', selected: '2' });

    await step('only digits go in', `(() => {
        const f = document.getElementById('line_out');
        f.focus();
        f.value = '';
        const typed = [];
        for (const ch of ['5', '-', '.', 'e', ',', '7']) {
            const ev = new InputEvent('beforeinput', { data: ch, inputType: 'insertText', cancelable: true, bubbles: true });
            const allowed = f.dispatchEvent(ev);
            if (allowed) { f.value = f.value + ch; f.dispatchEvent(new Event('input', { bubbles: true })); }
            typed.push(ch + ':' + (allowed ? 'in' : 'out'));
        }
        return { typed: typed.join(','), value: f.value };
    })()`, { typed: '5:in,-:out,.:out,e:out,,:out,7:in', value: '57' });

    await step('the outer line width reaches the file and the frames', `(() => {
        const f = document.getElementById('line_out');
        f.focus();
        f.value = '6';
        f.dispatchEvent(new Event('input', { bubbles: true }));
        return {
            style: document.querySelector('#preview_svg style').textContent
                .includes('.st_out {fill:none;stroke:white;stroke-width:6.00'),
            // The frame grows with the stroke it has to cover.
            frame: document.querySelector('#preview_svg #layer_s0_frame rect').getAttribute('width'),
        };
    })()`, { style: true, frame: '226.00' });

    await step('arrows step by one, with shift by ten', `(() => {
        const f = document.getElementById('line_out');
        f.focus();
        const press = (key, shiftKey) => f.dispatchEvent(
            new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
        press('ArrowUp'); const up = f.value;
        press('ArrowDown'); press('ArrowDown'); const down = f.value;
        press('ArrowUp', true); const jump = f.value;
        press('ArrowDown', true);
        return { up, down, jump, back: f.value };
    })()`, { up: '7', down: '5', jump: '15', back: '5' });

    await session.evaluate(`(() => {
        const f = document.getElementById('line_out');
        f.focus(); f.value = '2'; f.dispatchEvent(new Event('input', { bubbles: true })); f.blur();
    })()`);
    await sleep(200);
    await step('blur puts the unit back', `document.getElementById('line_out').value`, '2 px');

    // ---- hatching

    await step('reaching for a hatch field brings up the layer that shows it', `(() => {
        const grad = () => {
            const g = document.querySelector('#preview_svg #linear_grad');
            return [g.getAttribute('x1'), g.getAttribute('x2'), g.getAttribute('y2')].join(' ');
        };
        const at45 = grad();
        const f = document.getElementById('hatch_angle');
        // Focus alone, before a single keystroke.
        f.focus();
        const onFocus = {
            showing: ${shownLayers},
            name: document.getElementById('layer_name').textContent,
            ringOn: document.querySelector('#segments .segment.is_on').dataset.layer,
        };
        f.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        return {
            onFocus,
            value: f.value,
            stillShowing: ${shownLayers},
            at45,
            at46: grad(),
        };
    })()`, {
        onFocus: { showing: 'background', name: 'Резерв', ringOn: 'background' },
        value: '46',
        stillShowing: 'background',
        // What the reference PG file carries for this object at 45 degrees.
        at45: '354 51 303',
        at46: '354 57 307',
    });

    await step('leaving the field goes back to the layer that was chosen', `(() => {
        document.getElementById('hatch_angle').blur();
        return {
            value: document.getElementById('hatch_angle').value,
            showing: ${shownLayers},
            name: document.getElementById('layer_name').textContent,
        };
    })()`, { value: '46°', showing: 'otlichno', name: 'Отлично' });

    await step('hatch width and coverage change the stripes', `(() => {
        const count = () => document.querySelectorAll('#preview_svg #linear_grad stop').length;
        const before = count();
        const w = document.getElementById('hatch_width');
        w.focus(); w.value = '8'; w.dispatchEvent(new Event('input', { bubbles: true })); w.blur();
        const wider = count();
        const c = document.getElementById('hatch_coverage');
        c.focus(); c.value = '60'; c.dispatchEvent(new Event('input', { bubbles: true })); c.blur();
        return { fewerWhenThicker: wider < before, moreWhenDenser: count() > wider };
    })()`, { fewerWhenThicker: true, moreWhenDenser: true });

    // ---- the bar gives up its blocks in order when the window narrows

    {
        // Read from the markup, so a block added to the bar is picked up here
        // without the test being touched.
        const shown = `(() => {
            const bar = document.getElementById('settings_toolbar');
            const settings = document.querySelector('.settings');
            return {
                blocks: [...bar.querySelectorAll('[data-drop]')]
                    .filter(b => getComputedStyle(b).display !== 'none')
                    .map(b => b.id).join(','),
                clipped: settings.scrollWidth > settings.clientWidth + 1
                    || bar.scrollWidth > bar.clientWidth + 1,
            };
        })()`;
        const atWidth = async (width) => {
            await session.send('Emulation.setDeviceMetricsOverride',
                { width, height: 700, deviceScaleFactor: 1, mobile: false });
            await sleep(250);
            return session.evaluate(shown);
        };

        // No width is written down here either: the bar is swept from wide to
        // narrow and what must hold at every step is checked instead.
        const order = await session.evaluate(`[...document.querySelectorAll('#settings_toolbar [data-drop]')]
            .sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop))
            .map(b => b.id).join(',')`);
        const dropOrder = order.split(',');

        const problems = [];
        let previous = null;
        for (let width = 1800; width >= 400; width -= 100) {
            const got = await atWidth(width);
            const visible = got.blocks ? got.blocks.split(',') : [];

            if (got.clipped) problems.push(`at ${width}px the bar is still cut off`);

            // Whatever is gone has to be gone in order: if a block is showing,
            // every block due to go after it is showing too.
            const shouldBeGone = dropOrder.slice(0, dropOrder.length - visible.length);
            const expected = dropOrder.filter((id) => !shouldBeGone.includes(id));
            if (visible.slice().sort().join(',') !== expected.slice().sort().join(',')) {
                problems.push(`at ${width}px: ${got.blocks || 'nothing'}, expected ${expected.join(',') || 'nothing'}`);
            }
            // Narrowing never brings a block back.
            if (previous !== null && visible.length > previous) {
                problems.push(`at ${width}px the bar grew back from ${previous} blocks to ${visible.length}`);
            }
            previous = visible.length;
        }
        if (previous !== 0) problems.push(`the narrowest window still showed ${previous} blocks`);

        // And everything comes back when there is room again.
        const back = await atWidth(1800);
        if (back.blocks.split(',').length !== dropOrder.length) {
            problems.push(`widening again left: ${back.blocks}`);
        }
        await session.send('Emulation.clearDeviceMetricsOverride');
        await sleep(200);

        if (problems.length) {
            failures++;
            console.log('FAIL  the bar drops its blocks in order as the window narrows');
            problems.forEach((p) => console.log('        ' + p));
        } else {
            console.log(`PASS  the bar drops its blocks in order (${order}) as the window narrows, and takes them back`);
        }
    }

    // ---- the bar is only there when there is a preview under it

    await step('the bar is hidden until something has been entered', `(() => {
        const bar = () => getComputedStyle(document.getElementById('settings_toolbar')).display;
        const withFile = bar();
        // Empty every field: the first screen comes back, and the bar with it.
        const kept = [];
        for (const a of document.querySelectorAll('#sub_list textarea')) {
            kept.push(a.value);
            a.value = '';
            a.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const empty = { bar: bar(), firstScreen: getComputedStyle(document.getElementById('first_screen')).display };
        const areas = [...document.querySelectorAll('#sub_list textarea')];
        areas[0].value = kept[0];
        areas[0].dispatchEvent(new Event('input', { bubbles: true }));
        return { withFile, empty, backAgain: bar() };
    })()`, {
        withFile: 'flex',
        empty: { bar: 'none', firstScreen: 'flex' },
        backAgain: 'flex',
    });

    // ---- wheel zoom ---------------------------------------------------------

    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);
    {
        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId, files: [path.join(root, 'src_doc', 'files', 'PG_2m1v2s_S-S_figma_draft.svg')],
        });
        await waitUntil(session, `document.body.dataset.loaded === 'true'`);
        await sleep(400);
    }

    // The drawing's own size on screen, however it is being scaled.
    const drawnSize = `(() => {
        const svg = document.querySelector('#preview_svg svg');
        const box = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        // The svg element fills the stage; the drawing is letterboxed inside it.
        const fit = Math.min(box.width / vb.width, box.height / vb.height);
        return { w: vb.width * fit, h: vb.height * fit };
    })()`;

    await step('it opens at the size that fits the block, with no scaling', `(() => {
        const stage = document.getElementById('preview_stage');
        const drawn = ${drawnSize};
        const block = document.getElementById('svg_privew_block').getBoundingClientRect();
        return {
            transform: stage.style.transform,
            // Filling the block means touching one of its sides, bar the padding.
            fills: Math.round(Math.min(block.width - drawn.w, block.height - drawn.h)) <= 41,
        };
    })()`, { transform: '', fills: true });

    {
        const wheel = async (deltaY, times) => {
            const at = await session.evaluate(`(() => {
                const r = document.getElementById('svg_privew_block').getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()`);
            for (let i = 0; i < times; i++) {
                await session.send('Input.dispatchMouseEvent', {
                    type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY, pointerType: 'mouse',
                });
            }
            await sleep(250);
        };

        const before = await session.evaluate(drawnSize);
        await wheel(120, 3);
        const smaller = await session.evaluate(drawnSize);
        if (smaller.w < before.w && smaller.h < before.h) {
            console.log('PASS  scrolling down zooms out');
        } else {
            failures++;
            console.log(`FAIL  scrolling down zooms out\n        ${JSON.stringify(before)} -> ${JSON.stringify(smaller)}`);
        }

        // All the way out: the longer side stops at 150px.
        await wheel(120, 30);
        await step('zooming all the way out stops at 150px on the longer side', `(() => {
            const d = ${drawnSize};
            return Math.round(Math.max(d.w, d.h));
        })()`, 150);

        // All the way back in: the drawing fits the block again and nothing is scaled.
        await wheel(-120, 30);
        await step('zooming all the way in stops at the size that fits', `(() => {
            const d = ${drawnSize};
            return {
                transform: document.getElementById('preview_stage').style.transform,
                w: Math.round(d.w),
                h: Math.round(d.h),
            };
        })()`, { transform: '', w: Math.round(before.w), h: Math.round(before.h) });

        // Both ends are measured off the block, so a narrower window moves them.
        await wheel(120, 6);
        const midway = await session.evaluate(drawnSize);
        await session.send('Emulation.setDeviceMetricsOverride',
            { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(400);
        const narrowed = await session.evaluate(drawnSize);
        const narrowedMax = await session.evaluate(`(() => {
            document.getElementById('preview_stage').style.transform = '';
            const d = ${drawnSize};
            return { w: d.w, h: d.h };
        })()`);
        await session.send('Emulation.clearDeviceMetricsOverride');
        await sleep(400);
        const restored = await session.evaluate(drawnSize);

        const problems = [];
        if (!(narrowed.w < midway.w)) problems.push(`narrowing did not shrink the drawing: ${midway.w} -> ${narrowed.w}`);
        // The kept quantity is the place in the range, not the size: 0 is
        // filling the block, 1 is the 150px floor. Both ends moved with the
        // block, so the drawing is a different size at the same level.
        const level = (drawn, filled) => {
            const floor = 150 / Math.max(filled.w, filled.h);
            return Math.log(drawn.w / filled.w) / Math.log(floor);
        };
        const was = level(midway, before);
        const now = level(narrowed, narrowedMax);
        if (Math.abs(was - now) > 0.02) {
            problems.push(`zoom level moved: ${was.toFixed(3)} -> ${now.toFixed(3)} of the range`);
        }
        if (!(narrowedMax.w < before.w)) {
            problems.push(`the maximum did not follow the block: ${before.w} -> ${narrowedMax.w}`);
        }
        if (Math.abs(restored.w - midway.w) > 1) {
            problems.push(`widening back did not restore the size: ${midway.w} -> ${restored.w}`);
        }
        if (problems.length) {
            failures++;
            console.log('FAIL  the zoom range follows the width of the block');
            problems.forEach((p) => console.log('        ' + p));
        } else {
            console.log('PASS  the zoom range follows the width of the block, keeping the level');
        }
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
            preview: !!document.querySelector('#preview_svg svg'),
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
