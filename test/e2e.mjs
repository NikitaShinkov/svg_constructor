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
        // The click area block has a head line of its own, so this one is
        // asked for by the list it belongs to.
        const head = document.querySelector('.sub_list_wrap .head_line');
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

    await step('each subject has a tint, an outline and hit areas for shape and click area', `(() => {
        const rects = (sel) => document.querySelectorAll(sel).length;
        const outline = document.querySelector('#highlight_front .hl_outline');
        const tint = document.querySelector('#highlight_back .hl_tint');
        const front = document.getElementById('highlight_front');
        const svg = document.querySelector('#preview_svg svg');
        return {
            tints: rects('#highlight_back .hl_tint'),
            outlines: rects('#highlight_front .hl_outline'),
            // One for the click area and one for the subject's own shape: they
            // part company as soon as a border is moved, and the subject
            // answers the pointer over both.
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
        hits: 14,
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
            blocks: [...bar.querySelectorAll('.cursor_settings, .indicators_settings, .lines_settings, .hatching_settings, .offset_settings, .layer_selection_block')]
                .map(b => b.className.split(' ')[0]).join(','),
        };
    })()`, {
        height: 40,
        abovePreview: true,
        rightOfSidebar: true,
        background: 'rgb(17, 17, 28)',
        rule: '1px rgb(55, 55, 93)',
        blocks: 'cursor_settings,indicators_settings,lines_settings,hatching_settings,offset_settings,layer_selection_block',
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
        name: 'ХОР',
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
    })()`, { showing: 'otlichno', name: 'ХОР' });

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
            // 45 is the ninth of the twelve prepared sizes.
            atFraction: Math.round((parseFloat(knob.style.left) / (slider.clientWidth - 8)) * 11),
            circle: document.querySelector('#preview_svg #circle circle').getAttribute('r'),
            stroke: document.querySelector('#preview_svg style').textContent.includes('stroke-width:3.40'),
        };
    })()`, { label: 'Индикаторы Ø45', atFraction: 8, circle: '20.8', stroke: true });

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
            stroke: document.querySelector('#preview_svg style').textContent.includes('stroke-width:0.50'),
            noScale: document.querySelector('#preview_svg style').textContent.includes('scale(1.00)'),
            filled: Math.round(parseFloat(document.getElementById('slider_filled').style.width)),
        }))()`, { label: 'Индикаторы Ø6', circle: '2.75', stroke: true, noScale: true, filled: 4 });

        // Measured again: the label is shorter at Ø6 than it was at Ø45, so the
        // bar has laid itself out afresh and the slider is not where it was.
        const now = await session.evaluate(`(() => {
            const r = document.getElementById('indicators_slider').getBoundingClientRect();
            return { left: Math.round(r.left), top: Math.round(r.top + r.height / 2), width: Math.round(r.width) };
        })()`);
        await mouse('mousePressed', now.left + now.width - 1, now.top);
        await mouse('mouseReleased', now.left + now.width - 1, now.top);
        await sleep(300);
        await step('and back up to the largest', `document.getElementById('indicators_label').textContent`,
            'Индикаторы Ø100');
    }

    // Stepping back down to 45 also puts the defaults back for what follows.
    await step('a size change turns the indicators back on', `(() => {
        document.getElementById('indicators_switch').click();
        const off = { on: document.getElementById('indicators_switch').classList.contains('is_on'), showing: ${indicatorsShown} };
        const s = document.getElementById('indicators_slider');
        s.focus();
        // 100 -> 82 -> 60 -> 45, one prepared size a press.
        for (let i = 0; i < 3; i++) {
            s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        }
        return {
            off,
            // Arrow keys step through the sizes as dragging does.
            label: document.getElementById('indicators_label').textContent,
            on: document.getElementById('indicators_switch').classList.contains('is_on'),
            showing: ${indicatorsShown},
        };
    })()`, {
        off: { on: false, showing: 0 },
        label: 'Индикаторы Ø45',
        on: true,
        showing: 10,
    });

    // ---- number fields

    // Pixels are left unwritten everywhere; the two that are not pixels say so.
    await step('the fields show the number, and a unit only where it is not px', `(() => {
        const v = (id) => document.getElementById(id).value;
        return [v('line_out'), v('line_in'), v('hatch_angle'), v('hatch_width'), v('hatch_coverage')].join('|');
    })()`, '2|2|45°|4|30 %');

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
    await step('blur leaves the number as it is', `document.getElementById('line_out').value`, '2');

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
    })()`, { value: '46°', showing: 'otlichno', name: 'ХОР' });

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

    // ---- the offsets around the object

    // The block is the first the bar gives up, so it needs the width it was
    // drawn for; every check here puts it back afterwards.
    const wide = async () => {
        await session.send('Emulation.setDeviceMetricsOverride',
            { width: 1920, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(300);
    };
    const backToTest = async () => {
        await session.send('Emulation.clearDeviceMetricsOverride');
        await sleep(300);
    };

    await wide();

    await step('the offsets sit after the hatching, with the one the format has', `(() => {
        const block = document.getElementById('offset_settings');
        const bar = document.getElementById('settings_toolbar');
        const ids = [...bar.querySelectorAll('[data-drop]')].map(b => b.id);
        return {
            shown: !block.classList.contains('is_hidden'),
            // After the hatching, with only the alignment - which shares its
            // place on the bar and is never there at the same time - between.
            afterHatching: ids.indexOf('offset_settings') > ids.indexOf('hatching_settings')
                && ids.slice(ids.indexOf('hatching_settings') + 1, ids.indexOf('offset_settings'))
                    .every(id => id === 'align_settings'),
            // The first to be given up when the bar runs out of room.
            drop: block.dataset.drop,
            labels: [...block.querySelectorAll('.settings_label')].map(s => s.textContent).join('|'),
            bottom: document.getElementById('offset_bottom').value,
            top: document.getElementById('offset_top').value,
            viewBox: document.querySelector('#preview_svg svg').getAttribute('viewBox'),
        };
    })()`, {
        shown: true,
        afterHatching: true,
        drop: '1',
        labels: 'Отступ снизу|, сверху',
        bottom: '70',
        top: '0',
        viewBox: '0.00 0.00 354.00 322.00',
    });

    // Something picked out, so that reaching for an offset can put it down.
    await session.evaluate("document.querySelector('#sub_list .sub_num').click()");
    await sleep(200);
    await session.evaluate(`(() => {
        const h = [...document.querySelectorAll('.hl_ind')]
            .find(x => x.dataset.index === '0' && x.dataset.key === 'insert');
        h.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    })()`);
    await sleep(200);
    await session.evaluate("document.getElementById('offset_top').focus()");
    await sleep(250);

    await step('reaching for an offset lights its strip and the edge of the document', `(() => {
        const band = (side) => [...document.querySelectorAll('.hl_offset')]
            .find(b => b.dataset.side === side);
        const bounds = document.querySelector('.hl_bounds');
        const box = (el) => ['x', 'y', 'width', 'height'].map(a => Math.round(Number(el.getAttribute(a)))).join(',');
        const cs = (el, p) => getComputedStyle(el)[p];
        return {
            lit: [...document.querySelectorAll('.hl_offset.is_on')].map(b => b.dataset.side).join(','),
            // Nothing to see yet at 0, but it is the strip that is lit.
            topBox: box(band('top')),
            bottomBox: box(band('bottom')),
            // Lit the way a selected subject is.
            fill: [cs(band('top'), 'fill'), cs(band('top'), 'fillOpacity'), cs(band('top'), 'stroke')].join(' '),
            boundsOn: bounds.classList.contains('is_on'),
            boundsBox: box(bounds),
            boundsLine: [cs(bounds, 'stroke'), cs(bounds, 'strokeDasharray')].join(' '),
            // The offsets are about the document, so nothing else stays picked.
            rows: document.querySelectorAll('#sub_list .sub_block.is_open').length,
            blocks: [getComputedStyle(document.getElementById('click_area_settings')).display,
                     getComputedStyle(document.getElementById('indicator_position_settings')).display].join(','),
            indicator: document.querySelectorAll('.ind_fields.is_selected').length,
        };
    })()`, {
        lit: 'top',
        topBox: '0,0,354,0',
        bottomBox: '0,252,354,70',
        fill: 'rgb(255, 0, 251) 0.1 rgb(255, 0, 251)',
        boundsOn: true,
        boundsBox: '0,0,354,322',
        boundsLine: 'rgb(255, 0, 251) 14px, 14px',
        rows: 0,
        blocks: 'none,none',
        indicator: 0,
    });

    await session.evaluate(`(() => {
        const i = document.getElementById('offset_top');
        i.value = '40';
        i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(250);

    await step('typing into it grows the document as it is typed', `(() => {
        const svg = document.querySelector('#preview_svg svg');
        const band = [...document.querySelectorAll('.hl_offset')].find(b => b.dataset.side === 'top');
        const r = document.querySelector('#preview_svg #layer_o_background rect');
        // The offset is the group the layers sit in, not the origin of the
        // box: KOMPAKS reads the height but ignores a negative origin, and
        // would leave the space at the foot of the object instead.
        const wrap = [...svg.children].find(el => el.tagName === 'g' && !el.id);
        return {
            viewBox: svg.getAttribute('viewBox'),
            size: [svg.getAttribute('width'), svg.getAttribute('height')].join(','),
            // An inline attribute: the stylesheet is not read for this one.
            transform: wrap ? wrap.getAttribute('transform') : null,
            wraps: wrap ? [...wrap.children].map(el => el.id).join(',') : '',
            // layer_o covers the whole document, offsets and all, and is not
            // in the group: its rect is the box, not the object inside it.
            layerO: ['x', 'y', 'width', 'height'].map(a => r.getAttribute(a)).join(','),
            outside: r.closest('g[transform]') === null,
            // And nothing in the file sits above the origin any more.
            // Nothing in this file is drawn above or left of the origin, so
            // no attribute in it may begin with a minus.
            negatives: document.getElementById('preview_svg').innerHTML.includes('="-'),
            band: ['x', 'y', 'width', 'height'].map(a => Math.round(Number(band.getAttribute(a)))).join(','),
            // The artwork itself has not moved.
            s0Frame: document.querySelector('#preview_svg #layer_s0_frame rect').getAttribute('y'),
        };
    })()`, {
        viewBox: '0.00 0.00 354.00 362.00',
        size: '354.00,362.00',
        transform: 'translate(0.00 40.00)',
        wraps: 'layer_s0,layer_s1',
        layerO: '0.00,0.00,354.00,362.00',
        outside: true,
        negatives: false,
        band: '0,-40,354,40',
        s0Frame: '0.00',
    });

    await session.evaluate("document.getElementById('offset_top').blur()");
    await sleep(250);
    await step('and letting go of the field takes the lighting away, not the offset', `(() => ({
        bands: document.querySelectorAll('.hl_offset.is_on').length,
        bounds: document.querySelectorAll('.hl_bounds.is_on').length,
        top: document.getElementById('offset_top').value,
        viewBox: document.querySelector('#preview_svg svg').getAttribute('viewBox'),
    }))()`, { bands: 0, bounds: 0, top: '40', viewBox: '0.00 0.00 354.00 362.00' });

    // The other field lights the strip at the foot of the document.
    await session.evaluate("document.getElementById('offset_bottom').focus()");
    await sleep(250);
    await step('the bottom field lights the strip under the object', `(() => {
        const lit = [...document.querySelectorAll('.hl_offset.is_on')];
        return {
            lit: lit.map(b => b.dataset.side).join(','),
            box: lit.map(b => ['x', 'y', 'width', 'height']
                .map(a => Math.round(Number(b.getAttribute(a)))).join(',')).join(''),
            bounds: document.querySelectorAll('.hl_bounds.is_on').length,
        };
    })()`, { lit: 'bottom', box: '0,252,354,70', bounds: 1 });

    await session.evaluate(`(() => {
        const i = document.getElementById('offset_top');
        i.focus(); i.value = '0'; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur();
    })()`);
    await sleep(250);
    await step('back to no offset above, and the document is as it was', `(() => {
        const svg = document.querySelector('#preview_svg svg');
        // And the group goes with the offset that called for it.
        const wrap = [...svg.children].find(el => el.tagName === 'g' && !el.id);
        return [svg.getAttribute('viewBox'), svg.getAttribute('height'), String(!wrap)].join(' | ');
    })()`, '0.00 0.00 354.00 322.00 | 322.00 | true');

    await backToTest();

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
        // A block with nothing to set for the object being built is not on the
        // bar at any width, so it is not one of the blocks the bar gives up.
        const order = await session.evaluate(`[...document.querySelectorAll('#settings_toolbar [data-drop]')]
            .filter(b => !b.classList.contains('is_off'))
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

    // ---- click area: the frame the third-party app makes clickable -----------

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

    // Real pointer input, so the bands are met the way a user meets them.
    const mouse = (type, x, y, modifiers = 0) => session.send('Input.dispatchMouseEvent', {
        type, x, y, modifiers, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
    });
    const bandAt = (selector) => session.evaluate(`(() => {
        const b = document.querySelector('${selector}');
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                 scale: document.getElementById('highlight_front').getScreenCTM().a };
    })()`);
    const type = (id, value) => session.evaluate(`(() => {
        const i = document.getElementById('${id}');
        i.focus();
        i.value = '${value}';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.blur();
    })()`);

    await step('with nothing selected there are no settings blocks', `[
        getComputedStyle(document.getElementById('click_area_settings')).display,
        getComputedStyle(document.getElementById('indicator_position_settings')).display,
    ].join(',')`, 'none,none');

    await session.evaluate("document.querySelector('#sub_list .sub_num').click()");
    await sleep(300);

    await step('selecting a subject opens the block, drawn as designed', `(() => {
        const cs = (el, p) => getComputedStyle(el)[p];
        const block = document.getElementById('click_area_settings');
        const side = document.getElementById('sud_sidebloсk');
        const fields = [...block.querySelectorAll('.click_input')];
        const first = fields[0];
        const inputs = [...block.querySelectorAll('.click_input input')];
        return {
            shown: cs(block, 'display') !== 'none',
            aboveList: block.getBoundingClientRect().bottom
                <= document.querySelector('.sub_list_wrap').getBoundingClientRect().top,
            inSidebar: block.parentElement === side,
            title: block.querySelector('.sidebar_title').textContent,
            resetIcon: block.querySelector('#reset_button img').getAttribute('src').split('/').pop(),
            resetAtRight: Math.round(block.querySelector('#reset_button').getBoundingClientRect().right)
                === Math.round(block.querySelector('.head_line').getBoundingClientRect().right),
            columns: block.querySelectorAll('.click_column').length,
            fieldCount: fields.length,
            fieldH: Math.round(first.getBoundingClientRect().height),
            radius: cs(first, 'borderTopLeftRadius'),
            background: cs(first, 'backgroundColor'),
            border: [cs(first, 'borderTopWidth'), cs(first, 'borderTopColor')].join(' '),
            icons: fields.map(f => f.querySelector('img').getAttribute('src').split('/').pop()).join(','),
            values: inputs.map(i => i.value).join(','),
            gaps: [cs(block, 'rowGap'), cs(block.querySelector('.inputs_block'), 'columnGap'),
                   cs(block.querySelectorAll('.click_column')[1], 'rowGap')].join(','),
        };
    })()`, {
        shown: true,
        aboveList: true,
        inSidebar: true,
        title: 'Область нажатия',
        resetIcon: 'reset_icon.svg',
        resetAtRight: true,
        columns: 3,
        fieldCount: 4,
        fieldH: 23,
        radius: '6px',
        background: 'rgb(36, 36, 60)',
        border: '1px rgb(55, 55, 93)',
        icons: 'border_left_icon.svg,border_top_icon.svg,border_bottom_icon.svg,border_right_icon.svg',
        values: '0,0,0,0',
        gaps: '8px,6px,6px',
    });

    // The frame is what KOMPAKS makes clickable, so a border moves the rect in
    // the file and the pink outline together - or the file and what is shown
    // have come apart. The indicators belong to the subject, not to its click
    // area, and must sit still through all of it.
    const clickAreaState = `(() => {
        const rect = document.querySelector('#preview_svg #layer_s0_frame rect');
        const outline = document.querySelector('.hl_outline.is_on');
        const box = (el, attrs) => attrs.map(a => Math.round(Number(el.getAttribute(a)))).join(',');
        return {
            frame: box(rect, ['x', 'y', 'width', 'height']),
            outline: box(outline, ['x', 'y', 'width', 'height']),
            topLeftIndicator: box(document.querySelector('#preview_svg #layer_s0_old_repair use'), ['x', 'y']),
            viewBox: document.querySelector('#preview_svg svg').getAttribute('viewBox'),
            fields: [...document.querySelectorAll('.click_input input')].map(i => i.value).join(','),
        };
    })()`;

    await step('an untouched subject is clickable exactly where it is drawn', clickAreaState, {
        frame: '0,0,222,252',
        outline: '0,0,222,252',
        topLeftIndicator: '0,0',
        viewBox: '0.00 0.00 354.00 322.00',
        fields: '0,0,0,0',
    });

    await type('click_left', '10');
    await sleep(300);

    await step('a border pushed out grows the frame and the document, and leaves the indicators', clickAreaState, {
        frame: '-10,0,232,252',
        outline: '-10,0,232,252',
        topLeftIndicator: '0,0',
        viewBox: '-10.00 0.00 364.00 322.00',
        fields: '10,0,0,0',
    });

    // A border may be pulled inside the subject as well as pushed out of it.
    await type('click_top', '-20');
    await sleep(300);
    await step('a negative border eats into the subject', clickAreaState, {
        frame: '-10,20,232,232',
        outline: '-10,20,232,232',
        topLeftIndicator: '0,0',
        viewBox: '-10.00 0.00 364.00 322.00',
        fields: '10,-20,0,0',
    });

    await session.evaluate("document.getElementById('reset_button').click()");
    await sleep(200);

    // s0 is the leftmost subject of this file, so a click area pulled inside it
    // used to take the document's left edge with it and cut the drawing off.
    await type('click_left', '-30');
    await sleep(300);
    await step('shrinking the outermost click area does not crop the drawing', clickAreaState, {
        frame: '30,0,192,252',
        outline: '30,0,192,252',
        topLeftIndicator: '0,0',
        viewBox: '0.00 0.00 354.00 322.00',
        fields: '-30,0,0,0',
    });

    await session.evaluate("document.getElementById('reset_button').click()");
    await sleep(300);
    await step('reset puts every border back to the subject itself', clickAreaState, {
        frame: '0,0,222,252',
        outline: '0,0,222,252',
        topLeftIndicator: '0,0',
        viewBox: '0.00 0.00 354.00 322.00',
        fields: '0,0,0,0',
    });

    await step('the borders are grab bands of their own, pointing the right way', `(() => {
        const bands = [...document.querySelectorAll('.hl_edge.is_live')];
        const scale = document.getElementById('highlight_front').getScreenCTM().a;
        const thickness = bands.map(b => Math.round(Number(b.getAttribute(
            b.dataset.side === 'left' || b.dataset.side === 'right' ? 'width' : 'height')) * scale));
        return {
            count: bands.length,
            sides: bands.map(b => b.dataset.side).join(','),
            cursors: bands.map(b => getComputedStyle(b).cursor).join(','),
            thickness: [...new Set(thickness)].join(','),
            // A subject that is neither selected nor under the cursor has none.
            others: document.querySelectorAll('.hl_edge:not(.is_live)').length,
            othersInert: [...document.querySelectorAll('.hl_edge:not(.is_live)')]
                .every(b => getComputedStyle(b).pointerEvents === 'none'),
        };
    })()`, {
        count: 4,
        sides: 'top,right,bottom,left',
        cursors: 'ns-resize,ew-resize,ns-resize,ew-resize',
        thickness: '9',
        others: 4,
        othersInert: true,
    });

    // Dragging a border with the real pointer, and the field must follow it.
    {
        const band = await bandAt('.hl_edge_left.is_live');
        await mouse('mousePressed', band.x, band.y);
        for (let i = 1; i <= 6; i++) await mouse('mouseMoved', band.x - i * 5, band.y);
        await mouse('mouseReleased', band.x - 30, band.y);
        await sleep(300);

        const after = await session.evaluate(`(() => ({
            left: document.getElementById('click_left').value,
            frame: (() => {
                const r = document.querySelector('#preview_svg #layer_s0_frame rect');
                return [r.getAttribute('x'), r.getAttribute('width')].map(Number).map(Math.round).join(',');
            })(),
            stillSelected: document.querySelectorAll('.hl_edge.is_live').length === 4,
        }))()`);
        // 30 screen pixels of travel, in file units, allowing for the drawing
        // being scaled down as the area it has to fit grows.
        const grown = Number(after.left);
        const wanted = Math.round(30 / band.scale);
        const ok = grown > 0 && Math.abs(grown - wanted) <= 2
            && after.frame === `${-grown},${222 + grown}`
            && after.stillSelected;
        if (ok) console.log('PASS  dragging a border outwards grows the click area and the field with it');
        else {
            failures++;
            console.log(`FAIL  dragging a border outwards grows the click area and the field with it
        got:      ${JSON.stringify(after)}
        expected: about ${wanted}px of growth, still selected`);
        }
        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);
    }

    // A border can be taken hold of on a subject that is only being pointed at,
    // and taking hold of it is what picks that subject out.
    {
        const inside = await session.evaluate(`(() => {
            const r = document.querySelector('#preview_svg #layer_s1_frame rect');
            const ctm = document.getElementById('highlight_front').getScreenCTM();
            const at = (a) => Number(r.getAttribute(a));
            const p = document.getElementById('highlight_front').createSVGPoint();
            p.x = at('x') + at('width') / 2;
            p.y = at('y') + at('height') / 2;
            const s = p.matrixTransform(ctm);
            return { x: s.x, y: s.y };
        })()`);
        await mouse('mouseMoved', inside.x, inside.y);
        await sleep(200);

        await step('pointing at a subject offers its borders too', `(() => {
            const live = [...document.querySelectorAll('.hl_edge.is_live')];
            const s1 = live.filter(b => b.dataset.index === '1');
            return {
                lit: [...new Set(live.map(b => b.dataset.index))].sort().join(','),
                s1Bands: s1.length,
                s1Cursors: [...new Set(s1.map(b => getComputedStyle(b).cursor))].sort().join(','),
                s1Selected: document.querySelectorAll('#sub_list .sub_block')[1].classList.contains('is_open'),
            };
        })()`, { lit: '0,1', s1Bands: 4, s1Cursors: 'ew-resize,ns-resize', s1Selected: false });

        const band = await bandAt('.hl_edge_left[data-index="1"]');
        await mouse('mousePressed', band.x, band.y);
        for (let i = 1; i <= 5; i++) await mouse('mouseMoved', band.x - i * 4, band.y);
        await mouse('mouseReleased', band.x - 20, band.y);
        await sleep(300);

        await step('dragging that border picks the subject up with it', `(() => ({
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
            left: document.getElementById('click_left').value,
            s1Frame: (() => {
                const r = document.querySelector('#preview_svg #layer_s1_frame rect');
                return [r.getAttribute('x'), r.getAttribute('width')].map(Number).map(Math.round).join(',');
            })(),
            s0Untouched: document.querySelector('#preview_svg #layer_s0_frame rect').getAttribute('x') === '0.00',
        }))()`, {
            selected: 1,
            left: `${Math.round(20 / band.scale)}`,
            s1Frame: `${226 - Math.round(20 / band.scale)},${128 + Math.round(20 / band.scale)}`,
            s0Untouched: true,
        });

        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);
    }

    // Alt: the border across the area mirrors the one being dragged.
    {
        await session.evaluate("document.querySelectorAll('#sub_list .sub_num')[0].click()");
        await sleep(300);
        const band = await bandAt('.hl_edge_left[data-index="0"]');
        const ALT = 1;
        // Well clear of the snapping range, or the pair would land back on the
        // shape and prove nothing.
        await mouse('mousePressed', band.x, band.y, ALT);
        for (let i = 1; i <= 6; i++) await mouse('mouseMoved', band.x - i * 10, band.y, ALT);
        await mouse('mouseReleased', band.x - 60, band.y, ALT);
        await sleep(300);

        await step('holding Alt moves the border across with it, about the centre', `(() => {
            const r = document.querySelector('#preview_svg #layer_s0_frame rect');
            const at = (a) => Number(r.getAttribute(a));
            const px = (id) => Number(document.getElementById(id).value);
            return {
                grew: px('click_left') > 15,
                mirrored: px('click_left') === px('click_right'),
                widthIsBoth: Math.round(at('width')) === 222 + px('click_left') + px('click_right'),
                // The subject's own middle is 111; the area must still be on it.
                centred: Math.abs(at('x') + at('width') / 2 - 111) < 0.01,
                vertical: [document.getElementById('click_top').value,
                           document.getElementById('click_bottom').value].join(','),
            };
        })()`, {
            grew: true,
            mirrored: true,
            widthIsBoth: true,
            centred: true,
            vertical: '0,0',
        });

        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);
    }

    // Snapping: near the subject's own edge the border takes it exactly.
    {
        await type('click_left', '40');
        await sleep(300);
        const band = await bandAt('.hl_edge_left[data-index="0"]');
        // Back inwards by the whole 40px, which is the shape's own edge; the
        // reach is 3% of the subject's 222px width, so 6px either way.
        const travel = Math.round(40 * band.scale);
        await mouse('mousePressed', band.x, band.y);
        for (let i = 1; i <= 6; i++) await mouse('mouseMoved', band.x + (travel * i) / 6, band.y);
        await mouse('mouseReleased', band.x + travel, band.y);
        await sleep(300);

        await step('a border let go near the shape snaps onto it', clickAreaState, {
            frame: '0,0,222,252',
            outline: '0,0,222,252',
            topLeftIndicator: '0,0',
            viewBox: '0.00 0.00 354.00 322.00',
            fields: '0,0,0,0',
        });
    }

    // What else a border can land on: the next subject along, and the edge of
    // the document. s0 is 222 wide, s1 starts at 226, the document ends at 354.
    {
        await session.evaluate(`(() => {
            const row = document.querySelectorAll('#sub_list .sub_block')[0];
            if (!row.classList.contains('is_open')) row.querySelector('.sub_num').click();
        })()`);
        await sleep(300);
        const band = await bandAt('.hl_edge_right.is_live[data-index="0"]');
        const state = `(() => {
            const g = document.querySelector('.hl_guide');
            const cs = getComputedStyle(g);
            const doc = document.querySelector('#preview_svg svg').viewBox.baseVal;
            return {
                on: g.classList.contains('is_on'),
                at: Math.round(Number(g.getAttribute('x1'))),
                // Across the document and no further.
                spans: Math.round(Number(g.getAttribute('y1'))) === Math.round(doc.y)
                    && Math.round(Number(g.getAttribute('y2'))) === Math.round(doc.y + doc.height)
                    && g.getAttribute('x1') === g.getAttribute('x2'),
                line: [cs.stroke, cs.strokeWidth].join(' '),
                lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
                right: document.getElementById('click_right').value,
            };
        })()`;

        await mouse('mousePressed', band.x, band.y);
        for (let i = 1; i <= 4; i++) await mouse('mouseMoved', band.x + i * band.scale, band.y);
        await sleep(200);
        await step('a border landing on the next subject takes its edge and lights it', state, {
            on: true,
            at: 226,
            spans: true,
            line: 'rgb(255, 0, 251) 1px',
            // s0 is the one being adjusted, s1 the one its border landed on.
            lit: '0,1',
            right: '4',
        });

        await mouse('mouseMoved', band.x + 40 * band.scale, band.y);
        await sleep(200);
        await step('carried past it, the line goes and so does the lighting', state, {
            on: false,
            at: 226,
            spans: true,
            line: 'rgb(255, 0, 251) 1px',
            lit: '0',
            right: '40',
        });

        await mouse('mouseMoved', band.x + 131 * band.scale, band.y);
        await sleep(200);
        // 354 is where the document ends - and, in this file, where s1 ends
        // too, so it is s1's click area that answers for the line.
        await step('and the edge of the document is a line to land on too', state, {
            on: true,
            at: 354,
            spans: true,
            line: 'rgb(255, 0, 251) 1px',
            lit: '0,1',
            right: '132',
        });

        await mouse('mouseReleased', band.x + 131 * band.scale, band.y);
        await sleep(200);
        await step('letting go leaves the border where it landed, without the line', state, {
            on: false,
            at: 354,
            spans: true,
            line: 'rgb(255, 0, 251) 1px',
            lit: '0',
            right: '132',
        });

        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);

        // The foot of the document belongs to nobody: it is the offset below
        // the object, 70px under s0's own bottom edge at 252.
        const foot = await bandAt('.hl_edge_bottom.is_live[data-index="0"]');
        await mouse('mousePressed', foot.x, foot.y);
        for (let i = 1; i <= 5; i++) await mouse('mouseMoved', foot.x, foot.y + (i * 70 * foot.scale) / 5);
        await sleep(200);
        await step('the foot of the document is one as well, and belongs to nobody', `(() => {
            const g = document.querySelector('.hl_guide');
            const doc = document.querySelector('#preview_svg svg').viewBox.baseVal;
            return {
                on: g.classList.contains('is_on'),
                at: Math.round(Number(g.getAttribute('y1'))),
                spans: g.getAttribute('y1') === g.getAttribute('y2')
                    && Math.round(Number(g.getAttribute('x1'))) === Math.round(doc.x)
                    && Math.round(Number(g.getAttribute('x2'))) === Math.round(doc.x + doc.width),
                lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
                bottom: document.getElementById('click_bottom').value,
            };
        })()`, { on: true, at: 322, spans: true, lit: '0', bottom: '70' });

        await mouse('mouseReleased', foot.x, foot.y + 70 * foot.scale);
        await sleep(200);
        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);
    }

    // A border being carried owns the pointer until it is let go: the subjects it
    // passes over must not light up, and nothing under it may take the cursor.
    {
        // The row toggles, so it is only clicked if s0 is not already the one
        // selected - and the band has to be live, or the press lands past it.
        await session.evaluate(`(() => {
            const row = document.querySelectorAll('#sub_list .sub_block')[0];
            if (!row.classList.contains('is_open')) row.querySelector('.sub_num').click();
        })()`);
        await sleep(300);
        const band = await bandAt('.hl_edge_right.is_live[data-index="0"]');
        const over = await session.evaluate(`(() => {
            const r = document.querySelector('.hl_hit[data-index="1"]').getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);

        await mouse('mousePressed', band.x, band.y);
        await mouse('mouseMoved', (band.x + over.x) / 2, band.y);
        await mouse('mouseMoved', over.x, over.y);
        await sleep(200);
        const during = await session.evaluate(`(() => {
            const under = document.elementFromPoint(${over.x}, ${over.y});
            return {
                lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
                bodyCursor: getComputedStyle(document.body).cursor,
                underPointer: under ? getComputedStyle(under).cursor : '',
            };
        })()`);
        await mouse('mouseReleased', over.x, over.y);
        await sleep(200);

        const ok = JSON.stringify(during) === JSON.stringify(
            { lit: '0', bodyCursor: 'ew-resize', underPointer: 'ew-resize' });
        if (ok) console.log('PASS  a border being dragged keeps the cursor and lights nothing else');
        else {
            failures++;
            console.log(`FAIL  a border being dragged keeps the cursor and lights nothing else
        got:      ${JSON.stringify(during)}
        expected: {"lit":"0","bodyCursor":"ew-resize","underPointer":"ew-resize"}`);
        }

        await mouse('mouseMoved', over.x + 2, over.y + 2);
        await sleep(200);
        await step('and hands both back once it is let go', `(() => ({
            lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
            bodyCursor: getComputedStyle(document.body).cursor,
        }))()`, { lit: '0,1', bodyCursor: 'auto' });

        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);
    }

    // ---- indicator positions -------------------------------------------------

    await step('the indicator block is drawn as designed, under the click area', `(() => {
        const cs = (el, p) => getComputedStyle(el)[p];
        const block = document.getElementById('indicator_position_settings');
        const first = block.querySelector('.ind_input');
        const r = first.getBoundingClientRect();
        return {
            shown: cs(block, 'display') !== 'none',
            underTheClickArea: block.getBoundingClientRect().top
                >= document.getElementById('click_area_settings').getBoundingClientRect().bottom,
            aboveTheList: block.getBoundingClientRect().bottom
                <= document.querySelector('.sub_list_wrap').getBoundingClientRect().top,
            title: block.querySelector('.sidebar_title').textContent,
            resetAtRight: Math.round(block.querySelector('#reset_indicators_button').getBoundingClientRect().right)
                === Math.round(block.querySelector('.head_line').getBoundingClientRect().right),
            rows: block.querySelectorAll('.ind_row').length,
            fields: block.querySelectorAll('.ind_input').length,
            icons: [...block.querySelectorAll('.ind_row > img')]
                .map(i => i.getAttribute('src').split('/').pop()).join(','),
            fieldBox: [Math.round(r.width), Math.round(r.height)].join('x'),
            radius: cs(first, 'borderTopLeftRadius'),
            background: cs(first, 'backgroundColor'),
            values: [...block.querySelectorAll('.ind_input')].map(i => i.value).join(','),
            gaps: [cs(block, 'rowGap'), cs(block.querySelector('.ind_row'), 'columnGap'),
                   cs(block.querySelector('.ind_fields'), 'columnGap')].join(','),
        };
    })()`, {
        shown: true,
        underTheClickArea: true,
        aboveTheList: true,
        title: 'Индикаторы',
        resetAtRight: true,
        rows: 5,
        fields: 10,
        icons: 'old_repair_icon.svg,old_sost_icon.svg,insert_icon.svg,old_lock_icon.svg,fail_icon.svg',
        fieldBox: '43x23',
        radius: '6px',
        background: 'rgb(36, 36, 60)',
        values: '0,0,0,0,0,0,0,0,0,0',
        gaps: '8px,4px,2px',
    });

    // A point of the drawing, in screen coordinates.
    const at = (x, y) => session.evaluate(`(() => {
        const svg = document.getElementById('highlight_front');
        const p = svg.createSVGPoint();
        p.x = ${x}; p.y = ${y};
        const s = p.matrixTransform(svg.getScreenCTM());
        return { x: s.x, y: s.y };
    })()`);

    // An indicator belongs to its subject: pointing at one is pointing at the
    // subject, and clicking one picks both out, selected or not.
    {
        await mouse('mouseMoved', 20, 800);
        await session.evaluate("document.getElementById('preview_stage').click()");
        await sleep(200);

        // s0 is 222x252 with 45px indicators; this is the middle of the one in
        // its bottom-right corner.
        const spot = await at(222 - 45 / 2, 252 - 45 / 2);
        await mouse('mouseMoved', spot.x, spot.y);
        await sleep(200);
        const lit = `(() => ({
            lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
            blocks: [getComputedStyle(document.getElementById('click_area_settings')).display,
                     getComputedStyle(document.getElementById('indicator_position_settings')).display].join(','),
        }))()`;
        await step('pointing at an indicator lights its subject', lit,
            { lit: '0', selected: -1, blocks: 'none,none' });

        // The subject must stay lit while the pointer wanders over the
        // indicator: what answers the pointer may not depend on what is lit, or
        // the two take turns and the highlight flickers.
        for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', spot.x + i, spot.y + i); await sleep(60); }
        await step('the subject stays lit while the pointer rests on the indicator', lit,
            { lit: '0', selected: -1, blocks: 'none,none' });

        await mouse('mousePressed', spot.x, spot.y);
        await mouse('mouseReleased', spot.x, spot.y);
        await sleep(250);
        await step('clicking an indicator picks out its subject as well', `(() => ({
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
            blocks: [getComputedStyle(document.getElementById('click_area_settings')).display,
                     getComputedStyle(document.getElementById('indicator_position_settings')).display].join(','),
            // Which indicator is in hand shows on its pair of fields; the
            // drawing itself is left alone.
            fields: [...document.querySelectorAll('.ind_fields.is_selected')]
                .map(f => f.dataset.indicator).join(','),
            inTheDrawing: document.querySelectorAll('.hl_ind_mark').length,
        }))()`, { selected: 0, blocks: 'flex,flex', fields: 'fail', inTheDrawing: 0 });
    }

    // Clicking an indicator in the drawing is how one is picked up.
    {
        const spot = await session.evaluate(`(() => {
            const hit = [...document.querySelectorAll('.hl_ind')]
                .find(h => h.dataset.index === '0' && h.dataset.key === 'fail');
            const r = hit.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        await mouse('mouseMoved', spot.x, spot.y);
        await mouse('mousePressed', spot.x, spot.y);
        await mouse('mouseReleased', spot.x, spot.y);
        await sleep(300);

        await step('clicking an indicator picks it out', `(() => ({
            fields: [...document.querySelectorAll('.ind_fields.is_selected')]
                .map(f => f.dataset.indicator).join(','),
            // Every indicator on show answers the pointer, on any subject:
            // clicking one is how its subject is picked out in the first place.
            live: document.querySelectorAll('.hl_ind.is_live').length,
            all: document.querySelectorAll('.hl_ind').length,
            stillSelected: document.querySelectorAll('#sub_list .sub_block.is_open').length,
        }))()`, { fields: 'fail', live: 10, all: 10, stillSelected: 1 });
    }

    const arrow = async (key, shift) => {
        const code = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key];
        for (const type of ['rawKeyDown', 'keyUp']) {
            await session.send('Input.dispatchKeyEvent', {
                type, key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0,
            });
        }
    };

    await arrow('ArrowLeft');
    await arrow('ArrowLeft');
    await arrow('ArrowUp', true);
    await sleep(300);

    await step('the arrows move the indicator, 1px a press and 10 with Shift', `(() => ({
        x: document.getElementById('ind_fail_x').value,
        y: document.getElementById('ind_fail_y').value,
        // fail sits in the bottom-right corner of the subject: 222-45, 252-45.
        fail: (() => {
            const u = document.querySelector('#preview_svg #layer_s0_fail use');
            return [u.getAttribute('x'), u.getAttribute('y')].join(',');
        })(),
        // Its neighbours stay where the format puts them.
        oldRepair: (() => {
            const u = document.querySelector('#preview_svg #layer_s0_old_repair use');
            return [u.getAttribute('x'), u.getAttribute('y')].join(',');
        })(),
        viewBox: document.querySelector('#preview_svg svg').getAttribute('viewBox'),
    }))()`, {
        x: '-2',
        y: '-10',
        fail: '175.00,197.00',
        oldRepair: '0.00,0.00',
        viewBox: '0.00 0.00 354.00 322.00',
    });

    // Esc puts the indicator down, and then the arrows are nobody's.
    {
        const esc = async () => {
            for (const type of ['rawKeyDown', 'keyUp']) {
                await session.send('Input.dispatchKeyEvent', {
                    type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
                });
            }
        };
        await esc();
        await sleep(200);
        await arrow('ArrowLeft');
        await sleep(200);
        await step('Esc puts the indicator down and the arrows stop moving it', `(() => ({
            fields: document.querySelectorAll('.ind_fields.is_selected').length,
            x: document.getElementById('ind_fail_x').value,
            // The subject itself is still selected.
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
        }))()`, { fields: 0, x: '-2', selected: 0 });
    }

    // The shape sticking out of a click area that has been pulled inside it is
    // still the subject, and still picks it out.
    {
        await type('click_left', '-60');
        await sleep(300);
        await mouse('mouseMoved', 20, 800);
        await session.evaluate("document.getElementById('preview_stage').click()");
        await sleep(200);

        // Inside the shape, left of the click area, clear of the indicators in
        // the corners.
        const spot = await at(25, 126);
        await mouse('mouseMoved', spot.x, spot.y);
        await sleep(200);
        await step('the shape outside the click area lights the subject', `(() => ({
            lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
        }))()`, { lit: '0', selected: -1 });

        await mouse('mousePressed', spot.x, spot.y);
        await mouse('mouseReleased', spot.x, spot.y);
        await sleep(250);
        await step('and picks the subject out', `(() => ({
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
            left: document.getElementById('click_left').value,
        }))()`, { selected: 0, left: '-60' });

        await session.evaluate("document.getElementById('reset_button').click()");
        await sleep(200);
    }

    // An indicator nudged out of the subject takes the document with it, the
    // way a click area pushed outwards does.
    await type('ind_old_repair_x', '-40');
    await sleep(300);
    await step('an indicator pushed outside the subject grows the document', `(() => {
        const svg = document.querySelector('#preview_svg svg');
        const u = document.querySelector('#preview_svg #layer_s0_old_repair use');
        return {
            oldRepair: [u.getAttribute('x'), u.getAttribute('y')].join(','),
            viewBox: svg.getAttribute('viewBox'),
            width: svg.getAttribute('width'),
        };
    })()`, { oldRepair: '-40.00,0.00', viewBox: '-40.00 0.00 394.00 322.00', width: '394.00' });

    // The other subject gets a nudge too, so the reset has to reach past the
    // subject in hand.
    await session.evaluate("document.querySelectorAll('#sub_list .sub_num')[1].click()");
    await sleep(300);
    await type('ind_insert_y', '25');
    await sleep(300);
    await step('the block follows the selection from subject to subject', `(() => ({
        insertY: document.getElementById('ind_insert_y').value,
        failX: document.getElementById('ind_fail_x').value,
        s1Insert: (() => {
            const u = document.querySelector('#preview_svg #layer_s1_insert use');
            return u.getAttribute('y');
        })(),
    }))()`, { insertY: '25', failX: '0', s1Insert: '128.50' });

    const everything = `(() => {
        const use = (id) => {
            const u = document.querySelector('#preview_svg #' + id + ' use');
            return [u.getAttribute('x'), u.getAttribute('y')].join(',');
        };
        return {
            indFields: [...document.querySelectorAll('.ind_input')].map(i => i.value).join(','),
            clickFields: [...document.querySelectorAll('.click_input input')].map(i => i.value).join(','),
            s0Fail: use('layer_s0_fail'),
            s0OldRepair: use('layer_s0_old_repair'),
            s1Insert: use('layer_s1_insert'),
            viewBox: document.querySelector('#preview_svg svg').getAttribute('viewBox'),
        };
    })()`;

    await session.evaluate("document.getElementById('reset_indicators_button').click()");
    await sleep(300);
    // s1 is the one on show, and the only one the button reaches: s0 keeps the
    // nudges it was given, and the document it grew for them.
    await step('the reset button puts back the subject on show, and no other', everything, {
        indFields: '0,0,0,0,0,0,0,0,0,0',
        clickFields: '0,0,0,0',
        s0Fail: '175.00,197.00',
        s0OldRepair: '-40.00,0.00',
        s1Insert: '267.50,103.50',
        viewBox: '-40.00 0.00 394.00 322.00',
    });

    // Back to s0, with a border moved as well, so that R has both to undo.
    await session.evaluate("document.querySelectorAll('#sub_list .sub_num')[0].click()");
    await sleep(300);
    await type('click_left', '30');
    await sleep(250);

    const press = async (code, modifiers = 0) => {
        const codes = { KeyR: 82, KeyZ: 90 };
        for (const kind of ['rawKeyDown', 'keyUp']) {
            await session.send('Input.dispatchKeyEvent', {
                type: kind, key: code.slice(3).toLowerCase(), code,
                windowsVirtualKeyCode: codes[code], modifiers,
            });
        }
        await sleep(250);
    };

    await press('KeyR');
    await step('R gives the selected subject its indicators and its click area back', everything, {
        indFields: '0,0,0,0,0,0,0,0,0,0',
        clickFields: '0,0,0,0',
        s0Fail: '177.00,207.00',
        s0OldRepair: '0.00,0.00',
        // s1 is not the selected subject, so R does not reach it either.
        s1Insert: '267.50,103.50',
        viewBox: '0.00 0.00 354.00 322.00',
    });

    // ---- one step back, and no further

    await session.evaluate("document.getElementById('ind_fail_x').focus()");
    await session.evaluate(`(() => {
        const i = document.getElementById('ind_fail_x');
        i.value = '12';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.blur();
    })()`);
    await sleep(250);
    await type('click_top', '8');
    await sleep(250);
    await press('KeyZ', 2);   // Ctrl
    await step('Ctrl+Z puts the last change back, the border and not the number before it', everything, {
        indFields: '0,0,0,0,0,0,0,0,12,0',
        clickFields: '0,0,0,0',
        s0Fail: '189.00,207.00',
        s0OldRepair: '0.00,0.00',
        s1Insert: '267.50,103.50',
        viewBox: '0.00 0.00 354.00 322.00',
    });

    await press('KeyZ', 2);
    await step('and a second Ctrl+Z puts nothing else back', everything, {
        indFields: '0,0,0,0,0,0,0,0,12,0',
        clickFields: '0,0,0,0',
        s0Fail: '189.00,207.00',
        s0OldRepair: '0.00,0.00',
        s1Insert: '267.50,103.50',
        viewBox: '0.00 0.00 354.00 322.00',
    });

    await press('KeyR');
    await sleep(250);

    // ---- several indicators at once

    {
        const clickIndicator = async (subject, key, shift) => {
            const spot = await session.evaluate(`(() => {
                const h = [...document.querySelectorAll('.hl_ind')]
                    .find(x => x.dataset.index === '${subject}' && x.dataset.key === '${key}');
                const r = h.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            })()`);
            const mod = shift ? 8 : 0;
            await mouse('mouseMoved', spot.x, spot.y, mod);
            await mouse('mousePressed', spot.x, spot.y, mod);
            await mouse('mouseReleased', spot.x, spot.y, mod);
            await sleep(250);
        };
        // Alt and a letter, by where the key sits: the app reads e.code, so a
        // Cyrillic layout lines a group up just the same.
        const alt = async (code) => {
            const codes = { KeyA: 65, KeyD: 68, KeyS: 83, KeyW: 87, KeyH: 72, KeyV: 86 };
            for (const type of ['rawKeyDown', 'keyUp']) {
                await session.send('Input.dispatchKeyEvent', {
                    type, key: code.slice(3).toLowerCase(), code,
                    windowsVirtualKeyCode: codes[code], modifiers: 1,
                });
            }
            await sleep(250);
        };
        const group = `(() => {
            const use = (id) => {
                const u = document.querySelector('#preview_svg #' + id + ' use');
                return [u.getAttribute('x'), u.getAttribute('y')].join(',');
            };
            const g = document.querySelector('.hl_guide');
            return {
                // The fields belong to the subject on show, so only its own
                // members of the group are marked on them.
                fields: [...document.querySelectorAll('.ind_fields.is_selected')]
                    .map(f => f.dataset.indicator).join(','),
                lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
                selected: [...document.querySelectorAll('#sub_list .sub_block')]
                    .findIndex(b => b.classList.contains('is_open')),
                s0repair: use('layer_s0_old_repair'),
                s0fail: use('layer_s0_fail'),
                s1insert: use('layer_s1_insert'),
                guide: g.classList.contains('is_on')
                    ? ['x1', 'y1', 'x2', 'y2'].map(a => Math.round(Number(g.getAttribute(a)))).join(',')
                    : 'off',
            };
        })()`;

        await clickIndicator(0, 'oldRepair');
        await clickIndicator(0, 'fail', true);
        await clickIndicator(1, 'insert', true);
        await step('Shift gathers indicators into a group, across subjects', group, {
            fields: 'oldRepair,fail',
            // s1 is lit because one of its indicators is in the group; the
            // subject with the say is still the first one's.
            lit: '0,1',
            selected: 0,
            s0repair: '0.00,0.00',
            s0fail: '177.00,207.00',
            s1insert: '267.50,103.50',
            guide: 'off',
        });

        await arrow('ArrowRight');
        await arrow('ArrowDown', true);
        await step('the arrows move the whole group, 1px and 10 with Shift', group, {
            fields: 'oldRepair,fail',
            lit: '0,1',
            selected: 0,
            s0repair: '1.00,10.00',
            s0fail: '178.00,217.00',
            s1insert: '268.50,113.50',
            guide: 'off',
        });

        // Tops to the highest of them, which is old_repair at 10.
        await alt('KeyW');
        await step('Alt+W lines their top edges up and draws the line', group, {
            fields: 'oldRepair,fail',
            lit: '0,1',
            selected: 0,
            s0repair: '1.00,10.00',
            s0fail: '178.00,10.00',
            // Offsets are whole pixels, and this one sits on a half.
            s1insert: '268.50,10.50',
            guide: '0,10,354,10',
        });

        // Left edges to the leftmost, old_repair at 1.
        await alt('KeyA');
        await step('Alt+A lines their left edges up', group, {
            fields: 'oldRepair,fail',
            lit: '0,1',
            selected: 0,
            s0repair: '1.00,10.00',
            s0fail: '1.00,10.00',
            s1insert: '1.50,10.50',
            guide: '1,0,1,322',
        });

        // The middles go to the first one picked, not to an edge of the group.
        // Alt+V is the horizontal line through them; Alt+H the vertical one.
        await alt('KeyV');
        await step('Alt+V puts their middles on the first one picked', group, {
            fields: 'oldRepair,fail',
            lit: '0,1',
            selected: 0,
            s0repair: '1.00,10.00',
            s0fail: '1.00,10.00',
            s1insert: '1.50,10.50',
            // 10 + 45/2, the middle of the indicator the group was started from.
            guide: '0,33,354,33',
        });

        await arrow('ArrowRight');
        await step('moving them on puts the line away', `document.querySelector('.hl_guide').classList.contains('is_on')`, false);

        // Lined up, the three of them are sitting on top of each other, so they
        // go back to their corners before anything is aimed at one of them.
        await session.evaluate("document.getElementById('reset_indicators_button').click()");
        await sleep(250);

        // A click without Shift starts again from one indicator.
        await clickIndicator(0, 'fail');
        await step('a plain click starts a new group', `(() => ({
            fields: [...document.querySelectorAll('.ind_fields.is_selected')]
                .map(f => f.dataset.indicator).join(','),
            lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
        }))()`, { fields: 'fail', lit: '0' });

        // And a click on anything else puts the group down altogether.
        await mouse('mouseMoved', 20, 800);
        await mouse('mousePressed', 20, 800);
        await mouse('mouseReleased', 20, 800);
        await sleep(250);
        await step('a click away puts the group down', `(() => ({
            fields: document.querySelectorAll('.ind_fields.is_selected').length,
            lit: [...document.querySelectorAll('.hl_outline.is_on')].map(o => o.dataset.index).join(','),
            // The subject the group was started from is still the selected one.
            selected: [...document.querySelectorAll('#sub_list .sub_block')]
                .findIndex(b => b.classList.contains('is_open')),
        }))()`, { fields: 0, lit: '0', selected: 0 });
    }

    // ---- the pointer at the foot of the click area

    await step('the pointer is a third of the average subject and clears the border', `(() => {
        const marks = [...document.querySelectorAll('.hl_cursor')];
        const shown = marks.filter(m => getComputedStyle(m).visibility === 'visible');
        const pts = shown[0].getAttribute('points').split(' ').map(p => p.split(',').map(Number));
        const w = pts[1][0] - pts[2][0];
        const h = pts[1][1] - pts[0][1];
        const widths = [...document.querySelectorAll('#preview_svg [id$="_frame"] rect')]
            .map(r => Number(r.getAttribute('width')));
        const average = widths.reduce((s, v) => s + v, 0) / widths.length;
        const frame = document.querySelector('#preview_svg #layer_s0_frame rect');
        const at = (a) => Number(frame.getAttribute(a));
        const near = (a, b) => Math.abs(a - b) < 0.01;
        return {
            drawnForEverySubject: marks.length,
            shown: shown.length,
            forTheSelected: shown[0].dataset.index === '0',
            widthIsAThirdOfAverage: near(w, average / 3),
            shapeOfTheIcon: near(h, w * 0.8),          // design/icons/pointer.svg is 100x80
            centred: near(pts[0][0], at('x') + at('width') / 2),
            tipAboveTheBorder: near(at('y') + at('height') - pts[0][1], h / 3),
            fill: getComputedStyle(shown[0]).fill,
            stroke: getComputedStyle(shown[0]).stroke,
        };
    })()`, {
        drawnForEverySubject: 2,
        shown: 1,
        forTheSelected: true,
        widthIsAThirdOfAverage: true,
        shapeOfTheIcon: true,
        centred: true,
        tipAboveTheBorder: true,
        fill: 'rgb(255, 255, 255)',
        stroke: 'rgb(0, 0, 0)',
    });

    await session.evaluate("document.getElementById('cursor_switch').click()");
    await sleep(200);
    await step('the cursor switch only changes the preview', `(() => ({
        off: !document.getElementById('cursor_switch').classList.contains('is_on'),
        checked: document.getElementById('cursor_switch').getAttribute('aria-checked'),
        shown: [...document.querySelectorAll('.hl_cursor')]
            .filter(m => getComputedStyle(m).visibility === 'visible').length,
        // Nothing of any of this may reach the file: no pointer, no highlight.
        inFile: /polygon|hl_cursor|hl_edge|hl_outline/.test(document.getElementById('preview_svg').innerHTML),
    }))()`, { off: true, checked: 'false', shown: 0, inFile: false });

    await session.evaluate("document.getElementById('cursor_switch').click()");
    await sleep(200);

    // Putting the selection away takes the blocks and the marks with it. The
    // pointer is taken off the drawing first: bands and indicators answer for a
    // hovered subject too, and the cursor is still sitting on one.
    await mouse("mouseMoved", 20, 800);
    await session.evaluate("document.getElementById('preview_stage').click()");
    await sleep(300);
    await step('deselecting puts the blocks, the borders and the marks away', `(() => ({
        block: getComputedStyle(document.getElementById('click_area_settings')).display,
        indicatorBlock: getComputedStyle(document.getElementById('indicator_position_settings')).display,
        bands: document.querySelectorAll('.hl_edge.is_live').length,
        // The indicators stay there to be clicked - that is one of the ways a
        // subject is picked out - but none of them is picked.
        indicators: document.querySelectorAll('.hl_ind.is_live').length,
        picked: document.querySelectorAll('.ind_fields.is_selected').length,
        pointer: [...document.querySelectorAll('.hl_cursor')]
            .filter(m => getComputedStyle(m).visibility === 'visible').length,
    }))()`, { block: 'none', indicatorBlock: 'none', bands: 0, indicators: 10, picked: 0, pointer: 0 });

    // Hidden indicators answer to nothing: the one thing that takes their hit
    // areas away, and it cannot happen under the cursor.
    await session.evaluate("document.getElementById('indicators_switch').click()");
    await sleep(200);
    await step('indicators that are not shown cannot be picked', `(() => ({
        live: document.querySelectorAll('.hl_ind.is_live').length,
        inert: [...document.querySelectorAll('.hl_ind')]
            .every(h => getComputedStyle(h).pointerEvents === 'none'),
    }))()`, { live: 0, inert: true });
    await session.evaluate("document.getElementById('indicators_switch').click()");
    await sleep(200);

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

    // ---- reading back a file this app wrote ---------------------------------

    // Every file in src_doc/examples is in the format the app writes, so each
    // one is a file that could have come out of it - including what a sketch
    // never carries: the hand-edited click areas of CC2, the nudged indicators
    // of PK, the 32px indicator set, a hatch six pixels wide.
    //
    // The modules are imported into the page rather than driven through the
    // interface: what is checked here is that a file goes in and the same file
    // comes back out, which the sidebar can only show a corner of.
    const roundTrip = (name) => `(async () => {
        const [restore, template] = await Promise.all([
            import('/js/restore.js'), import('/js/template.js'),
        ]);
        const text = await (await fetch('/src_doc/examples/${name}')).text();
        const first = restore.restoreDocument(text);
        if (!first) return { restored: false };

        const built = template.buildSvg(first.subjects, first.params);
        // Reading our own output back has to give the same state again, or
        // something in the file is not being read.
        const again = restore.restoreDocument(built);
        const rebuilt = template.buildSvg(again.subjects, again.params);

        const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');
        const numbers = (svg, selector, attrs) => [...parse(svg).querySelectorAll(selector)]
            .map((el) => attrs.map((a) => Number(el.getAttribute(a))));
        // The file's numbers are written to two decimals, so a border read back
        // out of one can land half a hundredth from where it was.
        const same = (a, b) => a.length === b.length
            && a.every((row, i) => row.every((v, j) => Math.abs(v - b[i][j]) <= 0.01));
        const viewBox = (svg) => [(parse(svg).documentElement.getAttribute('viewBox') || '')
            .trim().split(/[\\s,]+/).map(Number)];

        return {
            restored: true,
            subjects: first.subjects.length,
            diameter: first.params.indicatorDiameter,
            lineWidths: [first.params.stOutWidth, first.params.stInWidth],
            hatch: [first.params.hatchAngle, first.params.hatchLineWidth, first.params.hatchCoverage],
            padding: [first.params.topPadding, first.params.bottomPadding],
            // What the file says, against what we build from what we read.
            frames: same(numbers(text, '[id$="_frame"] rect', ['x', 'y', 'width', 'height']),
                         numbers(built, '[id$="_frame"] rect', ['x', 'y', 'width', 'height'])),
            indicators: same(numbers(text, 'use[x]', ['x', 'y']),
                             numbers(built, 'use[x]', ['x', 'y'])),
            viewBox: same(viewBox(text), viewBox(built)),
            stable: built === rebuilt,
        };
    })()`;

    await step('PV comes back as it went in', roundTrip('PV_3m4v6s_R-RS-S.svg'), {
        restored: true, subjects: 6, diameter: 45, lineWidths: [2, 2], hatch: [45, 4, 30],
        padding: [0, 70], frames: true, indicators: true, viewBox: true, stable: true,
    });
    await step('PK comes back with the indicators it was drawn with', roundTrip('PK_3m4v7s_R-R-R.svg'), {
        restored: true, subjects: 7, diameter: 45, lineWidths: [2, 2], hatch: [45, 4, 30],
        padding: [0, 70], frames: true, indicators: true, viewBox: true, stable: true,
    });
    await step('CC2 comes back with its click areas and its 32px indicators', roundTrip('CC2_4m7v26s_S-R-S-S.svg'), {
        restored: true, subjects: 26, diameter: 32, lineWidths: [2, 2], hatch: [45, 6, 30],
        padding: [0, 70], frames: true, indicators: true, viewBox: true, stable: true,
    });

    // A drawing from an editor still goes through the detection: which of the
    // two ways a file is read is decided by the file, not by the user.
    await step('a drawing from an editor is not mistaken for one of ours', `(async () => {
        const { restoreDocument } = await import('/js/restore.js');
        const text = await (await fetch('/src_doc/files/PG_2m1v2s_S-S_figma_draft.svg')).text();
        return { restored: restoreDocument(text) };
    })()`, { restored: null });

    // Now the app itself, through the file input it always uses. This is the
    // file the detection could only say "no shapes but the background" about.
    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);
    {
        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId, files: [path.join(root, 'src_doc', 'examples', 'CC2_4m7v26s_S-R-S-S.svg')],
        });
        await waitUntil(session, `document.body.dataset.loaded === 'true'`);
        await sleep(400);
    }

    await step('a file of ours loads, where the detection saw only a background', `(() => ({
        subjects: document.querySelectorAll('#sub_list .sub_block').length,
        errorShown: document.getElementById('error_bar').classList.contains('is_visible'),
        preview: !!document.querySelector('#preview_svg svg'),
        toolbar: getComputedStyle(document.getElementById('settings_toolbar')).display !== 'none',
    }))()`, { subjects: 26, errorShown: false, preview: true, toolbar: true });

    await step('the settings on the bar are the ones the file was written with', `(() => {
        const at = (id) => document.getElementById(id).value;
        return {
            out: at('line_out'), in: at('line_in'),
            angle: at('hatch_angle'), hatchWidth: at('hatch_width'), coverage: at('hatch_coverage'),
            bottom: at('offset_bottom'), top: at('offset_top'),
            size: document.getElementById('indicators_label').textContent,
        };
    })()`, {
        out: '2', in: '2', angle: '45°', hatchWidth: '6', coverage: '30 %',
        bottom: '70', top: '0', size: 'Индикаторы Ø32',
    });

    // s6 is one of the subjects whose frame was narrowed by hand and whose
    // indicators were pushed off their corners: the two things the sidebar
    // holds, and both have to be sitting in its fields.
    await session.evaluate(`[...document.querySelectorAll('#sub_list .sub_num')][6].click()`);
    await sleep(300);
    await step('the click area and the indicator nudges are in the sidebar', `(() => {
        const at = (id) => document.getElementById(id).value;
        return {
            left: at('click_left'), top: at('click_top'), right: at('click_right'), bottom: at('click_bottom'),
            oldRepairX: at('ind_old_repair_x'), oldRepairY: at('ind_old_repair_y'),
            insertX: at('ind_insert_x'), failX: at('ind_fail_x'),
        };
    })()`, {
        left: '-53', top: '0', right: '-1', bottom: '0',
        oldRepairX: '32', oldRepairY: '0', insertX: '16', failX: '0',
    });

    // And the journey the user actually makes: a sketch loaded, the settings
    // changed, the file written, the file opened again. The preview holds the
    // copy of what would be exported, so it stands in for the disk.
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

    await session.evaluate(`(() => {
        const type = (id, value) => {
            const input = document.getElementById(id);
            input.focus();
            input.value = value;
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.blur();
        };
        type('line_out', '6');
        type('line_in', '3');
        type('hatch_angle', '60');
        type('hatch_width', '7');
        type('hatch_coverage', '25');
        type('offset_top', '40');
        type('offset_bottom', '120');
        document.querySelector('#sub_list .sub_num').click();       // s0, for the sidebar
        type('click_left', '18');
        type('click_bottom', '-5');
        type('ind_insert_x', '12');
        type('ind_insert_y', '-9');
    })()`);
    await sleep(400);

    await step('what was set here is what comes back out of the file', `(async () => {
        const { restoreDocument } = await import('/js/restore.js');
        const r = restoreDocument(document.getElementById('preview_svg').innerHTML);
        if (!r) return { restored: false };
        const s = r.subjects[0];
        return {
            subjects: r.subjects.length,
            out: r.params.stOutWidth, inner: r.params.stInWidth,
            hatch: [r.params.hatchAngle, r.params.hatchLineWidth, r.params.hatchCoverage],
            padding: [r.params.topPadding, r.params.bottomPadding],
            click: [s.clickArea.left, s.clickArea.bottom, s.clickArea.top, s.clickArea.right],
            insert: [s.indicatorOffsets.insert.x, s.indicatorOffsets.insert.y],
            untouched: JSON.stringify(r.subjects[1].clickArea),
        };
    })()`, {
        subjects: 2, out: 6, inner: 3, hatch: [60, 7, 25], padding: [40, 120],
        click: [18, -5, 0, 0], insert: [12, -9],
        untouched: '{"top":0,"right":0,"bottom":0,"left":0}',
    });

    // A file exported before the offset moved out of the viewBox: the space
    // above the object was the origin of the box then, and is still read.
    await step('an offset written the old way is read where it used to be', `(async () => {
        const { restoreDocument } = await import('/js/restore.js');
        const now = document.getElementById('preview_svg').innerHTML;
        // The same document as it would have been written before: nothing on
        // the group, the box starting above the artwork, and layer_o with it.
        const then = now
            .split('translate(0.00 40.00)').join('translate(0 0)')
            .split('viewBox="0.00 0.00').join('viewBox="0.00 -40.00')
            .split('x="0.00" y="0.00" style="fill:none"').join('x="0.00" y="-40.00" style="fill:none"');
        const r = restoreDocument(then);
        return r ? { top: r.params.topPadding, bottom: r.params.bottomPadding } : { top: null, bottom: null };
    })()`, { top: 40, bottom: 120 });
    // ---- dynamic or static equipment ----------------------------------------

    // Two templates over one drawing. The sidebar is the same either way, and
    // so is everything in it: what the switch changes is the file.
    await session.send('Page.navigate', { url: `http://localhost:${appPort}/index.html` });
    await waitUntil(session, `document.body.dataset.ready === 'true'`);

    await step('the selector is the first thing in the sidebar, dynamic chosen', `(() => {
        const sel = document.getElementById('object_type_selector');
        const sidebar = document.getElementById('sud_sidebloсk');
        const buttons = [...sel.querySelectorAll('.object_type')];
        const cs = getComputedStyle(sel);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const rgb = (hex) => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
        return {
            first: sidebar.firstElementChild === sel,
            labels: buttons.map(b => b.querySelector('span').textContent).join('|'),
            icons: buttons.map(b => b.querySelector('img').getAttribute('src').split('/').pop()).join('|'),
            chosen: buttons.filter(b => b.classList.contains('is_on')).map(b => b.dataset.type).join(','),
            pressed: buttons.map(b => b.getAttribute('aria-pressed')).join(','),
            // The design's pill: one accent ring round both, the chosen one filled.
            height: Math.round(sel.getBoundingClientRect().height),
            ring: cs.borderTopWidth + ' ' + cs.borderTopColor,
            round: parseFloat(cs.borderTopLeftRadius) >= 13,
            fill: buttons.map(b => getComputedStyle(b).backgroundColor === rgb(accent)).join(','),
            // Nothing is loaded yet and it is offered all the same.
            shown: cs.display !== 'none',
        };
    })()`, {
        first: true,
        labels: 'Динамическое обор.|Статическое обор.',
        icons: 'dynamics_icon.svg|static_icon.svg',
        chosen: 'dynamic',
        pressed: 'true,false',
        height: 26,
        ring: '1px rgb(76, 76, 255)',
        round: true,
        fill: 'true,false',
        shown: true,
    });

    // Only the chosen half is filled: the pointer alone changes nothing, and
    // the labels sit a pixel above where their line box would put them.
    {
        const box = JSON.parse(await session.evaluate(`(() => {
            const r = document.getElementById('object_type_static').getBoundingClientRect();
            return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]);
        })()`));
        await session.send('Input.dispatchMouseEvent',
            { type: 'mouseMoved', x: box[0], y: box[1], buttons: 0 });
        await sleep(250);
    }
    await step('the pointer alone does not fill a half, and the labels are lifted 1px', `(() => {
        const buttons = [...document.querySelectorAll('.object_type')];
        const cs = (el, p) => getComputedStyle(el)[p];
        return {
            hovered: buttons[1].matches(':hover'),
            // The one under the pointer is still the plain one.
            background: cs(buttons[1], 'backgroundColor'),
            chosenBackground: cs(buttons[0], 'backgroundColor'),
            lift: buttons.map(b => cs(b.querySelector('span'), 'top')).join(','),
        };
    })()`, {
        hovered: true,
        background: 'rgba(0, 0, 0, 0)',
        chosenBackground: 'rgb(76, 76, 255)',
        lift: '-1px,-1px',
    });

    {
        const doc = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file_input' });
        await session.send('DOM.setFileInputFiles', {
            nodeId, files: [path.join(root, 'src_doc', 'files', 'PG_2m1v2s_S-S_figma_draft.svg')],
        });
        await waitUntil(session, `document.body.dataset.loaded === 'true'`);
        await sleep(400);
    }

    // Something typed into every part of the sidebar, so that a switch has
    // work to lose: a click area, an indicator and one of the code fields.
    await session.evaluate(`document.querySelector('#sub_list .sub_num').click()`);
    await sleep(150);
    for (const [id, value] of [['click_left', '18'], ['ind_insert_x', '12']]) {
        await session.evaluate(`(() => {
            const f = document.getElementById('${id}');
            f.focus(); f.value = '${value}';
            f.dispatchEvent(new Event('input', { bubbles: true }));
            f.blur();
        })()`);
        await sleep(150);
    }

    // The blocks the selection brings with it appear under the selector, never
    // over it: it is the first thing in the sidebar whatever else is showing.
    await step('it stays first once a subject is selected', `(() => {
        const sidebar = document.getElementById('sud_sidebloсk');
        const top = (id) => document.getElementById(id).getBoundingClientRect().top;
        return {
            first: sidebar.firstElementChild.id,
            aboveClickArea: top('object_type_selector') < top('click_area_settings'),
            aboveIndicators: top('object_type_selector') < top('indicator_position_settings'),
            aboveList: top('object_type_selector') < document.querySelector('.sub_list_wrap').getBoundingClientRect().top,
        };
    })()`, {
        first: 'object_type_selector',
        aboveClickArea: true, aboveIndicators: true, aboveList: true,
    });

    const sidebarState = `(() => ({
        rows: [...document.querySelectorAll('#sub_list .sub_num')].map(e => e.textContent).join(','),
        codes: [...document.querySelectorAll('#sub_list textarea')].map(a => a.value.length).join(','),
        firstCode: (document.querySelector('#sub_list textarea') || {}).value || '',
        click: document.getElementById('click_left').value,
        indicator: document.getElementById('ind_insert_x').value,
    }))()`;
    const before = await session.evaluate(sidebarState);
    const dynamicFile = await session.evaluate(`document.getElementById('preview_svg').innerHTML`);

    await session.evaluate(`document.getElementById('object_type_static').click()`);
    await sleep(400);

    await step('the static file is the fixed page the format has', `(() => {
        const svg = document.querySelector('#preview_svg svg');
        const text = document.getElementById('preview_svg').innerHTML;
        const caption = svg.querySelector('#background_elem .text_src');
        const group = [...svg.children].find(g => g.tagName === 'g' && !g.id && g.getAttribute('transform'));
        const layerO = svg.querySelector('#layer_o');
        const numbers = (s) => (String(s).match(/-?[\\d.]+/g) || []).map(Number);
        return {
            size: svg.getAttribute('width') + 'x' + svg.getAttribute('height'),
            viewBox: svg.getAttribute('viewBox'),
            // layer_o comes first here, and it is not the object's box but the
            // frame the third-party application fills in.
            layerOFirst: [...svg.children].filter(e => e.tagName === 'g').indexOf(layerO) === 0,
            view: ['x', 'y', 'width', 'height'].map(a => svg.querySelector('#View').getAttribute(a)).join(','),
            clusters: svg.querySelectorAll('#layer_o rect[id^="Cluster"]').length,
            // The caption is drawn because s0 points at it, and it is given
            // the opposite of the object's move so it stays where it is.
            caption: caption ? caption.querySelector('text').textContent : '',
            referred: svg.querySelectorAll('#layer_s0_background use[*|href="#background_elem"]').length,
            opposite: JSON.stringify(numbers(group.getAttribute('transform')))
                === JSON.stringify(numbers(caption.getAttribute('transform')).map(v => -v)),
            wraps: [...group.children].map(g => g.id).join(','),
            // KOMPAKS does not read the stylesheet for the move.
            inline: !!group.getAttribute('transform') && !group.getAttribute('class'),
        };
    })()`, {
        size: '1845.00x800.00',
        viewBox: '-1.00 -1.00 1845.00 800.00',
        layerOFirst: true,
        view: '971,26,860,698',
        clusters: 8,
        caption: 'Источники АЭ',
        referred: 1,
        opposite: true,
        wraps: 'layer_s0,layer_s1',
        inline: true,
    });

    // The object's own top-left corner lands on the two constants, and the
    // highlight layers follow it: the preview's box and the file's differ by
    // exactly the move, which is what keeps them on the drawing.
    // The object is laid in the middle of the alignment area to begin with, and
    // the highlight layer goes wherever it goes.
    await step('the object is centred in the area, and the highlights go with it', `(async () => {
        const { alignArea } = await import('/js/template.js');
        const svg = document.querySelector('#preview_svg svg');
        const group = [...svg.children].find(g => g.tagName === 'g' && !g.id && g.getAttribute('transform'));
        const move = (String(group.getAttribute('transform')).match(/-?[\\d.]+/g) || []).map(Number);
        const frames = [...svg.querySelectorAll('[id$="_frame"] rect')];
        const at = (a) => frames.map(r => Number(r.getAttribute(a)));
        const span = (a, s) => {
            const lo = Math.min(...at(a));
            return [lo, Math.max(...frames.map((r, i) => at(a)[i] + Number(r.getAttribute(s))))];
        };
        const [x0, x1] = span('x', 'width');
        const [y0, y1] = span('y', 'height');
        const area = alignArea({});
        const box = (s) => s.trim().split(/[\\s,]+/).map(Number);
        const file = box(svg.getAttribute('viewBox'));
        const hl = box(document.getElementById('highlight_front').getAttribute('viewBox'));
        const near = (a, b) => Math.abs(a - b) < 0.51;
        return {
            // The middle of the object on the middle of the area, both ways.
            centredX: near((x0 + x1) / 2 + move[0], area.x + area.w / 2),
            centredY: near((y0 + y1) / 2 + move[1], area.y + area.h / 2),
            area: [area.x, area.y, area.w, area.h],
            // The page is the fixed one, wherever the object was put in it.
            page: [file[2], file[3]],
            // The two boxes are the same size and differ by the move alone,
            // which is what puts a point of the drawing on the same place on
            // screen in the file and on the highlight layer over it.
            sameSize: file[2] === hl[2] && file[3] === hl[3],
            offsetByTheMove: Math.abs(file[0] - hl[0] - move[0]) < 0.01
                && Math.abs(file[1] - hl[1] - move[1]) < 0.01,
        };
    })()`, {
        centredX: true, centredY: true,
        // Left on the caption, top and bottom on the View rectangle, right on
        // its left edge, which is where the margin eats in from.
        area: [20, 26, 951, 698],
        page: [1845, 800], sameSize: true, offsetByTheMove: true,
    });

    // A box that does not fill its element has to be put somewhere inside it,
    // and the two layers have to agree about where or nothing that answers the
    // pointer is where the drawing is. This is the whole page as it is on
    // screen: what is lit, what is clicked and what a border snaps to are all
    // drawn from the same rectangles, so one subject answers for them all.
    await step('what answers the pointer is where the shape is', `(() => {
        const round = (r) => [r.left, r.top, r.right, r.bottom].map(v => Math.round(v));
        const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1.5);
        // s1, whose click area has not been moved: its frame is its own
        // rectangle, so the outline is the shape and nothing else.
        const shape = document.querySelector('#preview_svg [id="layer_s1_otlichno"]').getBoundingClientRect();
        const outline = document.querySelector('#highlight_front .hl_outline[data-index="1"]').getBoundingClientRect();
        const tint = document.querySelector('#highlight_back .hl_tint[data-index="1"]').getBoundingClientRect();
        return {
            // The same value as the file, which is what puts them together.
            keeps: document.getElementById('highlight_front').getAttribute('preserveAspectRatio'),
            fileKeeps: document.querySelector('#preview_svg svg').getAttribute('preserveAspectRatio'),
            onTheShape: near(round(outline), round(shape)),
            andTheTint: near(round(tint), round(shape)),
            // And the drawing is really on screen where it is being measured.
            drawn: shape.width > 1 && shape.height > 1,
        };
    })()`, {
        keeps: 'xMinYMin meet', fileKeeps: 'xMinYMin meet',
        onTheShape: true, andTheTint: true, drawn: true,
    });

    // The caption is drawn by KOMPAKS off the background layer, but it is the
    // picture the object stands on rather than a state of it, so the preview
    // shows it whichever state is on show - here the one it opens on.
    await step('the caption is on show whatever layer is', `(() => {
        const text = document.querySelector('#preview_svg #background_elem text');
        const group = document.querySelector('#preview_svg #layer_s0_background');
        const ref = group.querySelector('use[*|href="#background_elem"]');
        return {
            layer: document.getElementById('layer_name').textContent,
            caption: text.textContent,
            // The <use> is what is drawn; the text itself lives in the defs,
            // where nothing has a place on screen.
            visible: ref.getBoundingClientRect().width > 1,
            // Nothing else of that layer is: the hatch is still a state.
            restHidden: [...group.children].filter(c => c !== ref)
                .every(c => c.style.display === 'none'),
        };
    })()`, { layer: 'ХОР', caption: 'Источники АЭ', visible: true, restHidden: true });

    // The areas KOMPAKS fills in are drawn in the preview so they can be seen,
    // and nowhere else: the file has no line on them.
    await step('the view and the clusters are outlined in the preview only', `(() => {
        const rects = [...document.querySelectorAll('#preview_svg [id="View"], #preview_svg [id^="Cluster"]')];
        const cs = (el, p) => getComputedStyle(el)[p];
        const one = (p) => [...new Set(rects.map(r => cs(r, p)))].join(',');
        return {
            ids: rects.map(r => r.id).sort().join(','),
            stroke: one('stroke'),
            width: one('strokeWidth'),
            fill: one('fill'),
            // Paint, not targets: the pointer goes through to the drawing.
            takesClicks: rects.some(r => cs(r, 'pointerEvents') !== 'none'),
            // And none of it is in the markup that would be exported: the
            // rects carry what the format gives them and no line of their own.
            inTheFile: rects.some(r => r.getAttribute('stroke')
                || /stroke|fill/.test(r.getAttribute('style') || '')),
        };
    })()`, {
        ids: 'Cluster0,Cluster1,Cluster2,Cluster3,Cluster4,Cluster5,Cluster6,Cluster7,View',
        stroke: 'rgb(255, 255, 255)', width: '2px', fill: 'none',
        takesClicks: false,
        inTheFile: false,
    });

    // A fixed page has nothing for the two offsets to move, so they are not
    // offered - and that is not the bar running out of room, so it is kept
    // apart from the order the bar gives its blocks up in. At the width the
    // bar was drawn for, where it gives nothing up of its own accord.
    await wide();
    await step('the offsets are not offered for a fixed page', `(() => {
        const block = document.getElementById('offset_settings');
        return {
            shown: getComputedStyle(block).display !== 'none',
            off: block.classList.contains('is_off'),
            // Not dropped, which is a different thing and would come back.
            hidden: block.classList.contains('is_hidden'),
            // Everything else on the bar is still there.
            others: [...document.querySelectorAll('.settings_toolbar [data-drop]')]
                .filter(b => getComputedStyle(b).display !== 'none').length,
        };
    })()`, { shown: false, off: true, hidden: false, others: 6 });

    // ---- where a static object is laid

    // The block takes the offsets' place on the bar, and is built to
    // design/align_settings.json: a label, three buttons, another label and the
    // margin field.
    await step('the alignment block is on the bar as designed', `(() => {
        const block = document.getElementById('align_settings');
        const bar = document.getElementById('settings_toolbar');
        const ids = [...bar.querySelectorAll('[data-drop]')].map(b => b.id);
        const buttons = [...block.querySelectorAll('.align_button')];
        const cs = (el, p) => getComputedStyle(el)[p];
        const accent = cs(document.documentElement, 'getPropertyValue') || '';
        return {
            shown: cs(block, 'display') !== 'none',
            afterHatching: ids.indexOf('align_settings') === ids.indexOf('hatching_settings') + 1,
            labels: [...block.querySelectorAll('.settings_label')].map(s => s.textContent).join('|'),
            icons: buttons.map(b => b.querySelector('img').getAttribute('src').split('/').pop()).join(','),
            // 23px square, rounded, and the chosen one filled - the rest are
            // the same field colour as the margin box beside them.
            size: buttons.map(b => Math.round(b.getBoundingClientRect().width) + 'x'
                + Math.round(b.getBoundingClientRect().height)).join(','),
            round: buttons.every(b => parseFloat(cs(b, 'borderTopLeftRadius')) === 6),
            chosen: buttons.filter(b => b.classList.contains('is_on')).map(b => b.id).join(','),
            filled: cs(buttons[0], 'backgroundColor'),
            plain: cs(buttons[1], 'backgroundColor'),
            fieldBg: cs(document.getElementById('align_margin'), 'backgroundColor'),
            margin: document.getElementById('align_margin').value,
        };
    })()`, {
        shown: true,
        afterHatching: true,
        labels: 'Выравнивание|с отступом',
        icons: 'aligh_icon_center.svg,aligh_icon_top.svg,aligh_icon_left_top.svg',
        size: '23x23,23x23,23x23',
        round: true,
        chosen: 'align_center',
        filled: 'rgb(76, 76, 255)',
        plain: 'rgb(36, 36, 60)',
        fieldBg: 'rgb(36, 36, 60)',
        margin: '0',
    });

    // Pointing at a button lays the object that way at once and draws the edges
    // it was laid against; taking the pointer off puts both back.
    const laidAt = `(() => {
        const svg = document.querySelector('#preview_svg svg');
        const g = [...svg.children].find(e => e.tagName === 'g' && !e.id && e.getAttribute('transform'));
        const frames = [...svg.querySelectorAll('[id$="_frame"] rect')];
        const move = (String(g.getAttribute('transform')).match(/-?[\\d.]+/g) || []).map(Number);
        const edge = (a, s) => [
            Math.round(Math.min(...frames.map(r => Number(r.getAttribute(a)))) + move[a === 'x' ? 0 : 1]),
            Math.round(Math.max(...frames.map(r => Number(r.getAttribute(a)) + Number(r.getAttribute(s))))
                + move[a === 'x' ? 0 : 1]),
        ];
        const guides = [...document.querySelectorAll('#highlight_front .hl_guide.is_on')];
        return {
            left: edge('x', 'width')[0], right: edge('x', 'width')[1],
            top: edge('y', 'height')[0], bottom: edge('y', 'height')[1],
            guides: guides.length,
        };
    })()`;

    const point = async (id) => {
        const box = JSON.parse(await session.evaluate(`(() => {
            const r = document.getElementById('${id}').getBoundingClientRect();
            return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]);
        })()`));
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0], y: box[1], buttons: 0 });
        await sleep(250);
    };
    const pointAway = async () => {
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500, buttons: 0 });
        await sleep(250);
    };

    const centred = await session.evaluate(laidAt);
    await point('align_corner');
    await step('pointing at a button lays the object and draws the edges it was laid against',
        laidAt, { left: 20, right: 20 + (centred.right - centred.left),
                  top: 26, bottom: 26 + (centred.bottom - centred.top), guides: 2 });

    await point('align_center');
    await step('the middle draws all four', laidAt, { ...centred, guides: 4 });

    await pointAway();
    await step('and taking the pointer away puts it back', laidAt, { ...centred, guides: 0 });

    // Carrying the pointer from one button to the next crosses the gap between
    // them. What is being shown has to stay put across it, or the object flicks
    // back to the kept alignment for those few frames and jumps as it travels.
    const pointTo = async (x, y) => {
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
        await sleep(200);
    };
    const boxOf = async (id) => JSON.parse(await session.evaluate(`(() => {
        const r = document.getElementById('${id}').getBoundingClientRect();
        return JSON.stringify({ left: r.left, right: r.right, mid: r.left + r.width / 2,
                                top: r.top, bottom: r.bottom, midY: r.top + r.height / 2 });
    })()`));
    const corner = await boxOf('align_corner');
    const side = await boxOf('align_side');

    await point('align_corner');
    const onCorner = await session.evaluate(laidAt);
    // The middle of the gap between the two, at the height of the buttons.
    await pointTo((side.right + corner.left) / 2, corner.midY);
    await step('crossing the gap between two buttons holds what is being shown',
        laidAt, onCorner);

    await pointTo(side.mid, side.midY);
    await step('and it changes over only once the next button is reached', `(() => ({
        top: ${laidAt}.top,
        // The side button's own variant, not the corner's.
        left: ${laidAt}.left,
    }))()`, { top: 26, left: centred.left });

    // Each button reaches the full height of the bar for the pointer while
    // staying 23px to the eye, as the layer segments do.
    await pointTo(corner.mid, corner.top - 6);
    await step('a button answers above and below itself as well', laidAt, onCorner);

    await pointTo(corner.mid, corner.bottom + 6);
    await step('and below it', laidAt, onCorner);

    // Above the gap, between the two strips: still inside the three, so still
    // holding what it was showing.
    await pointTo((side.right + corner.left) / 2, corner.top - 6);
    await step('the gap holds it above the buttons too', laidAt, onCorner);

    await pointAway();

    // Pressing keeps it; pressing the one already chosen steps it on.
    await session.evaluate(`document.getElementById('align_side').click()`);
    await pointAway();
    await step('pressing a button keeps that alignment', `(() => ({
        chosen: [...document.querySelectorAll('.align_button.is_on')].map(b => b.id).join(','),
        icon: document.querySelector('#align_side img').getAttribute('src').split('/').pop(),
        top: ${laidAt}.top,
    }))()`, { chosen: 'align_side', icon: 'aligh_icon_top.svg', top: 26 });

    await session.evaluate(`document.getElementById('align_side').click()`);
    await pointAway();
    await step('pressing it again steps it on to the next variant', `(() => ({
        icon: document.querySelector('#align_side img').getAttribute('src').split('/').pop(),
        // Laid against the right edge of the area, which is the View rectangle.
        right: ${laidAt}.right,
        // And the button the pointer is not on keeps the variant it was left on.
        corner: document.querySelector('#align_corner img').getAttribute('src').split('/').pop(),
    }))()`, { icon: 'aligh_icon_right.svg', right: 971, corner: 'aligh_icon_left_top.svg' });

    // The margin takes the right edge of the area in, and nothing else.
    await session.evaluate(`(() => {
        const f = document.getElementById('align_margin');
        f.focus(); f.value = '40';
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.blur();
    })()`);
    await sleep(300);
    await step('the margin takes the right edge in', `${laidAt}.right`, 931);

    // The strip it takes off is shown the way the document offsets are: lit
    // while its field is being edited, and as tall as the View rectangle it is
    // measured from.
    const marginBand = `(() => {
        const svg = document.querySelector('#preview_svg svg');
        const g = [...svg.children].find(e => e.tagName === 'g' && !e.id && e.getAttribute('transform'));
        const move = (String(g.getAttribute('transform')).match(/-?[\\d.]+/g) || []).map(Number);
        const band = document.querySelector('#highlight_front .hl_offset[data-side="margin"]');
        const n = (a) => Number(band.getAttribute(a));
        return {
            lit: band.classList.contains('is_on'),
            // In the file's own coordinates, which is where the View is.
            box: [n('x') + move[0], n('y') + move[1], n('width'), n('height')].map(Math.round).join(','),
        };
    })()`;

    await session.evaluate(`document.getElementById('align_margin').focus()`);
    await sleep(300);
    await step('editing the margin lights the strip it takes off', marginBand, {
        lit: true,
        // From the area's right edge to the View rectangle, and as tall as it.
        box: '931,26,40,698',
    });

    // The page itself is not being changed - the margin moves an area inside
    // it - so the edge of the document stays out of it.
    await step('and leaves the edge of the document alone',
        `[...document.querySelectorAll('#highlight_front .hl_bounds')].some(r => r.classList.contains('is_on'))`,
        false);

    await session.evaluate(`document.getElementById('align_margin').blur()`);
    await sleep(300);
    await step('and letting go of the field puts it away', `${marginBand}.lit`, false);

    // It is also shown whenever the edge it puts there is, so that the line and
    // the reason for it are never on their own.
    await point('align_side');
    await step('an alignment against that edge lights it too', `${marginBand}.lit`, true);
    await point('align_corner');
    await step('and one that is not laid against it does not', `${marginBand}.lit`, false);
    await point('align_center');
    await step('the middle, which draws all four edges, does', `${marginBand}.lit`, true);
    await pointAway();

    // All of it is part of the file, so it comes back out of one.
    await step('an alignment comes back out of the file it was written into', `(async () => {
        const [restore, template] = await Promise.all([
            import('/js/restore.js'), import('/js/template.js'),
        ]);
        const subjects = [{
            fill: '<path d="M10,10h100v80h-100Z"></path>', strokeIn: '',
            fillBBox: { x: 10, y: 10, w: 100, h: 80 },
        }];
        const out = [];
        for (const alignH of ['left', 'center', 'right']) {
            for (const alignV of ['top', 'middle', 'bottom']) {
                for (const alignMargin of [0, 40]) {
                    const params = { objectType: 'static', alignH, alignV, alignMargin };
                    const file = template.buildSvg(subjects, params);
                    const back = restore.restoreDocument(file);
                    const same = back && back.params.alignH === alignH && back.params.alignV === alignV
                        // The margin only moves two of the three, so it is only
                        // readable back out of those.
                        && (alignH === 'left' || back.params.alignMargin === alignMargin);
                    const again = back && template.buildSvg(back.subjects, back.params);
                    if (!same || again !== file) out.push(alignH + '/' + alignV + '/' + alignMargin);
                }
            }
        }
        return { wrong: out.join(' ') || 'none' };
    })()`, { wrong: 'none' });

    // Put it back to the middle for what follows.
    await session.evaluate(`(() => {
        const f = document.getElementById('align_margin');
        f.focus(); f.value = '0';
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.blur();
        document.getElementById('align_center').click();
    })()`);
    await pointAway();

    // The whole point of the switch: the drawing is the user's, the template
    // is not. Nothing typed or moved may be lost by choosing the other one.
    await step('the subjects, their code and their adjustments are kept', sidebarState, before);

    await session.evaluate(`document.getElementById('object_type_dynamic').click()`);
    await sleep(400);

    await step('switching back gives the same file again', `(() => ({
        same: document.getElementById('preview_svg').innerHTML === ${JSON.stringify(dynamicFile)},
        chosen: [...document.querySelectorAll('.object_type.is_on')].map(b => b.dataset.type).join(','),
        // The offsets have something to move again, so they are back.
        offsets: getComputedStyle(document.getElementById('offset_settings')).display !== 'none',
        offsetsValues: [document.getElementById('offset_top').value, document.getElementById('offset_bottom').value].join(','),
    }))()`, { same: true, chosen: 'dynamic', offsets: true, offsetsValues: '0,70' });

    await backToTest();

    await step('and the sidebar is still where it was', sidebarState, before);

    // A static file of ours is read back as one: which of the two it is comes
    // from the file, as it does for the format itself.
    await step('a static file comes back static', `(async () => {
        const [restore, template] = await Promise.all([
            import('/js/restore.js'), import('/js/template.js'),
        ]);
        const text = await (await fetch('/src_doc/examples/static/AE_Separator_8.svg')).text();
        const first = restore.restoreDocument(text);
        if (!first) return { restored: false };
        const built = template.buildSvg(first.subjects, first.params);
        const again = restore.restoreDocument(built);
        return {
            restored: true,
            type: first.params.objectType,
            subjects: first.subjects.length,
            // A fixed page holds no offsets, so none are read out of one.
            padding: [first.params.topPadding, first.params.bottomPadding],
            size: (built.match(/width="([^"]*)" height="([^"]*)"/) || []).slice(1).join('x'),
            stable: built === template.buildSvg(again.subjects, again.params),
        };
    })()`, {
        restored: true, type: 'static', subjects: 8,
        padding: [0, 70], size: '1845.00x800.00', stable: true,
    });

    await step('a dynamic file of ours still comes back dynamic', `(async () => {
        const { restoreDocument } = await import('/js/restore.js');
        const text = await (await fetch('/src_doc/examples/PV_3m4v6s_R-RS-S.svg')).text();
        const r = restoreDocument(text);
        return { type: r.params.objectType, padding: [r.params.topPadding, r.params.bottomPadding] };
    })()`, { type: 'dynamic', padding: [0, 70] });

    // ---- the two switch strips ----------------------------------------------

    // A 26px toggle is a small thing to hit, so the whole strip answers: the
    // switch, its label and the space around them. The slider shares the
    // indicators' strip and keeps its own clicks.
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

    {
        const mouse = async (type, x, y) => session.send('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse',
        });
        const clickAt = async (at) => {
            await mouse('mousePressed', at.x, at.y);
            await mouse('mouseReleased', at.x, at.y);
            await sleep(200);
        };
        // The middle of an element, and the middle of the gap between two.
        const middle = (selector) => `(() => {
            const r = document.querySelector('${selector}').getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`;
        const between = (left, right) => `(() => {
            const a = document.querySelector('${left}').getBoundingClientRect();
            const b = document.querySelector('${right}').getBoundingClientRect();
            return { x: Math.round((a.right + b.left) / 2), y: Math.round(a.top + a.height / 2) };
        })()`;
        const switches = `(() => ({
            indicators: document.getElementById('indicators_switch').classList.contains('is_on'),
            cursor: document.getElementById('cursor_switch').classList.contains('is_on'),
            size: document.getElementById('indicators_label').textContent,
            drawn: [...document.querySelectorAll('.hl_cursor')]
                .filter(m => getComputedStyle(m).visibility === 'visible').length,
        }))()`;

        await step('both strips start switched on', switches,
            { indicators: true, cursor: true, size: 'Индикаторы Ø45', drawn: 0 });

        await clickAt(await session.evaluate(middle('#indicators_label')));
        await step('the indicators label is the switch', switches,
            { indicators: false, cursor: true, size: 'Индикаторы Ø45', drawn: 0 });

        await clickAt(await session.evaluate(between('#indicators_switch', '#indicators_label')));
        await step('and so is the space between the switch and the label', switches,
            { indicators: true, cursor: true, size: 'Индикаторы Ø45', drawn: 0 });

        await clickAt(await session.evaluate(middle('#indicators_switch')));
        await step('the switch itself still answers once, not twice', switches,
            { indicators: false, cursor: true, size: 'Индикаторы Ø45', drawn: 0 });
        await clickAt(await session.evaluate(middle('#indicators_switch')));

        // The slider sits on the same strip. A click on it picks a size - and
        // a size the indicators are not showing at is worth showing, so it
        // turns them on - but it is never the strip being clicked.
        await clickAt(await session.evaluate(`(() => {
            const r = document.getElementById('indicators_slider').getBoundingClientRect();
            return { x: Math.round(r.left + r.width * 0.2), y: Math.round(r.top + r.height / 2) };
        })()`));
        await step('the slider keeps its own clicks', switches,
            { indicators: true, cursor: true, size: 'Индикаторы Ø16', drawn: 0 });

        // Dragged off the slider and let go over the label: the pointer is the
        // slider's until it comes up, so the strip must not hear about it.
        {
            const from = await session.evaluate(`(() => {
                const r = document.getElementById('indicators_slider').getBoundingClientRect();
                return { x: Math.round(r.left + r.width * 0.8), y: Math.round(r.top + r.height / 2) };
            })()`);
            const onto = await session.evaluate(middle('#indicators_label'));
            await mouse('mousePressed', from.x, from.y);
            await mouse('mouseMoved', onto.x, onto.y);
            await mouse('mouseReleased', onto.x, onto.y);
            await sleep(200);
            await step('a drag that ends on the label is still the slider', switches,
                { indicators: true, cursor: true, size: 'Индикаторы Ø6', drawn: 0 });
        }

        // The cursor strip has nothing on it but the switch and its label, so
        // all of it answers. The triangle only shows with a subject picked out.
        await session.evaluate(`document.querySelector('#sub_list .sub_num').click()`);
        await sleep(200);
        await clickAt(await session.evaluate(middle('#cursor_settings .settings_label')));
        await step('the cursor label is the switch', switches,
            { indicators: true, cursor: false, size: 'Индикаторы Ø6', drawn: 0 });

        await clickAt(await session.evaluate(between('#cursor_switch', '#cursor_settings .settings_label')));
        await step('and so is the space beside it', switches,
            { indicators: true, cursor: true, size: 'Индикаторы Ø6', drawn: 1 });
    }

    // ---- the bar keeps still, and the preview block answers as a whole ------

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

    {
        // The size in the label is as wide as the widest of the prepared sizes
        // from the start, so stepping from one end of the slider to the other
        // leaves everything after it on the bar where it was.
        const stepTo = async (steps) => {
            await session.evaluate(`(() => {
                const el = document.getElementById('indicators_slider');
                el.focus();
                for (let i = 0; i < ${Math.abs(steps)}; i++) {
                    el.dispatchEvent(new KeyboardEvent('keydown', {
                        key: '${steps > 0 ? 'ArrowUp' : 'ArrowDown'}', bubbles: true, cancelable: true }));
                }
            })()`);
            await sleep(250);
        };
        // Every block that is on the bar, and where its left edge is.
        const bar = `(() => {
            const blocks = [...document.querySelectorAll('#settings_toolbar [data-drop]')]
                .filter(b => !b.classList.contains('is_hidden'));
            return {
                size: document.getElementById('indicators_label').textContent,
                shown: blocks.map(b => b.id).join(','),
                lefts: blocks.map(b => Math.round(b.getBoundingClientRect().left)).join(','),
            };
        })()`;

        const at45 = await session.evaluate(bar);
        await stepTo(-8);                       // the smallest prepared size
        const at6 = await session.evaluate(bar);
        await stepTo(11);                       // and the largest
        const at100 = await session.evaluate(bar);
        await stepTo(-3);                       // back to 45 for what follows

        // Worked out here, over three states of the page, and handed to the
        // same reporting as everything else.
        await step('the size label holds its width from 6 to 100', `(${JSON.stringify({
            sizes: [at45.size, at6.size, at100.size].join(' '),
            sameBlocks: at6.shown === at45.shown && at100.shown === at45.shown,
            sameLefts: at6.lefts === at45.lefts && at100.lefts === at45.lefts,
            measured: at45.shown.split(',').length,
        })})`, {
            sizes: 'Индикаторы Ø45 Индикаторы Ø6 Индикаторы Ø100',
            sameBlocks: true,
            sameLefts: true,
            measured: at45.shown.split(',').length,
        });
    }

    // The pointer stands at the foot of the click area and hangs below it, so a
    // subject at the bottom of the drawing puts it outside the document. The
    // document is what the zoom is measured on, and nothing is added to it to
    // make room for a mark that is not in the file - so at the largest zoom the
    // pointer is cut off by the block, and zooming out brings it into view.
    await session.evaluate(`(() => {
        const i = document.getElementById('offset_bottom');
        i.focus(); i.value = '0';
        i.dispatchEvent(new InputEvent('input', { bubbles: true }));
        i.blur();
        document.querySelector('#sub_list .sub_num').click();
    })()`);
    await sleep(400);

    const pointerReach = `(() => {
        const layer = document.getElementById('highlight_front');
        const box = layer.getBoundingClientRect();
        const vb = layer.viewBox.baseVal;
        // Where the foot of the document is on screen, the drawing being
        // letterboxed inside the layer.
        const fit = Math.min(box.width / vb.width, box.height / vb.height);
        const documentBottom = box.top + box.height / 2 + (vb.height * fit) / 2;
        const mark = document.querySelector('.hl_cursor.is_selected').getBoundingClientRect();
        const block = document.getElementById('svg_privew_block').getBoundingClientRect();
        return {
            belowTheDocument: mark.bottom > documentBottom + 1,
            insideTheBlock: mark.bottom <= block.bottom + 0.5,
            layerClips: getComputedStyle(layer).overflow,
            blockClips: getComputedStyle(document.getElementById('svg_privew_block')).overflow,
        };
    })()`;

    await step('at the largest zoom the pointer hangs out of the drawing', pointerReach, {
        belowTheDocument: true, insideTheBlock: false,
        layerClips: 'visible', blockClips: 'hidden',
    });

    {
        const at = await session.evaluate(`(() => {
            const r = document.getElementById('svg_privew_block').getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        for (let i = 0; i < 4; i++) {
            await session.send('Input.dispatchMouseEvent', {
                type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 120, pointerType: 'mouse',
            });
        }
        await sleep(300);
    }

    await step('zoomed out it is outside the drawing and still drawn', pointerReach, {
        belowTheDocument: true, insideTheBlock: true,
        layerClips: 'visible', blockClips: 'hidden',
    });

    // A click anywhere in the block puts the selection down, the padding round
    // the drawing included - the drawing itself stops the clicks that belong to
    // something in it before they get here.
    await step('the subject is still the one picked', `(() => ({
        open: document.querySelectorAll('#sub_list .sub_block.is_open').length,
        block: getComputedStyle(document.getElementById('click_area_settings')).display !== 'none',
    }))()`, { open: 1, block: true });

    {
        const at = await session.evaluate(`(() => {
            const r = document.getElementById('svg_privew_block').getBoundingClientRect();
            // In the padding, outside the stage the drawing is scaled into.
            return { x: Math.round(r.left + 5), y: Math.round(r.top + r.height / 2) };
        })()`);
        await session.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse',
        });
        await session.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
        });
        await sleep(300);
    }

    await step('a click beside the drawing puts it down all the same', `(() => ({
        open: document.querySelectorAll('#sub_list .sub_block.is_open').length,
        block: getComputedStyle(document.getElementById('click_area_settings')).display !== 'none',
        pointer: [...document.querySelectorAll('.hl_cursor')]
            .filter(m => getComputedStyle(m).visibility === 'visible').length,
    }))()`, { open: 0, block: false, pointer: 0 });

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
