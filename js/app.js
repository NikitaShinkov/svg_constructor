// Wiring: upload -> detect -> build -> preview / subject list / download.

import { detectSubjects, parseGeometryFragment } from './detect.js';
import { buildSvg } from './template.js';

const el = (id) => document.getElementById(id);

const ui = {
    sidebar: el('sud_sidebloсk'),
    resizeHandle: el('resize_handle'),
    subList: el('sub_list'),
    stage: el('preview_stage'),
    upload: el('upload_button'),
    download: el('download_button'),
    copy: el('copy_button'),
    fileInput: el('file_input'),
    overlay: el('drop_overlay'),
    errorBar: el('error_bar'),
};

const state = {
    fileName: null,
    fileHandle: null,   // FileSystemFileHandle, when the browser provides one
    subjects: [],
    output: '',
};

let errorTimer = null;
function showError(message) {
    ui.errorBar.textContent = message;
    ui.errorBar.classList.add('is_visible');
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => ui.errorBar.classList.remove('is_visible'), 6000);
}
function clearError() {
    ui.errorBar.classList.remove('is_visible');
}

// ---------------------------------------------------------------- upload

ui.upload.addEventListener('click', async () => {
    if (typeof window.showOpenFilePicker === 'function') {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }],
                multiple: false,
            });
            await load(await handle.getFile(), handle);
        } catch (err) {
            if (err && err.name !== 'AbortError') showError(err.message);
        }
        return;
    }
    ui.fileInput.click();
});

ui.fileInput.addEventListener('change', async () => {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    if (file) await load(file, null);
    ui.fileInput.value = '';
});

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    ui.overlay.classList.add('is_active');
});
window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (--dragDepth <= 0) { dragDepth = 0; ui.overlay.classList.remove('is_active'); }
});
window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    ui.overlay.classList.remove('is_active');

    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    let handle = null;
    // Chromium hands over a writable handle, which lets Export reopen the save
    // dialog in the folder the file came from.
    if (item && typeof item.getAsFileSystemHandle === 'function') {
        try {
            const h = await item.getAsFileSystemHandle();
            if (h && h.kind === 'file') handle = h;
        } catch { /* fall back to the plain File below */ }
    }
    const file = handle ? await handle.getFile() : (e.dataTransfer.files && e.dataTransfer.files[0]);
    if (file) await load(file, handle);
});

async function load(file, handle) {
    if (!/\.svg$/i.test(file.name)) {
        showError('Нужен файл с расширением .svg');
        return;
    }
    try {
        const text = await file.text();
        const { subjects } = detectSubjects(text);
        if (!subjects.length) throw new Error('Не удалось найти субъекты в файле.');

        state.fileName = file.name;
        state.fileHandle = handle;
        state.subjects = subjects;
        // A single subject is shown expanded; with several, start collapsed.
        subjects.forEach((s) => { s.isOpen = subjects.length === 1; });

        clearError();
        rebuild();
        renderSubList();
    } catch (err) {
        console.error(err);
        showError(err.message || 'Не удалось обработать файл.');
    }
}

// ---------------------------------------------------------------- build

/** Regenerates the SVG from the current subjects and refreshes the preview. */
function rebuild() {
    state.output = buildSvg(state.subjects);
    ui.stage.innerHTML = state.output;
    const ready = state.subjects.length > 0;
    ui.download.disabled = !ready;
    ui.copy.disabled = !ready;
}

// ---------------------------------------------------------------- subject list

function renderSubList() {
    ui.subList.textContent = '';

    state.subjects.forEach((subject, index) => {
        const block = document.createElement('div');
        block.className = 'sub_block';
        if (subject.isOpen) block.classList.add('is_open');

        const add = iconButton('add_sub_button', 'assets/icons/add_icon.svg', 12, 12, 'Добавить субъект');
        add.addEventListener('click', (e) => { e.stopPropagation(); addSubject(index); });

        const num = document.createElement('div');
        num.className = 'sub_num';
        num.textContent = `s${index}`;

        const fields = document.createElement('div');
        fields.className = 'text_fields_block';
        fields.appendChild(codeField('fill', subject, 'fill'));
        fields.appendChild(codeField('str', subject, 'strokeIn'));

        const del = iconButton('delete_sub_button', 'assets/icons/delete_icon.svg', 11, 12, 'Удалить субъект');
        del.addEventListener('click', (e) => { e.stopPropagation(); removeSubject(index); });

        // The whole row toggles, including its expanded area - but not the
        // code fields or the buttons, which have their own jobs.
        block.addEventListener('click', (e) => {
            if (e.target.closest('textarea, button')) return;
            const opening = !subject.isOpen;
            state.subjects.forEach((s) => { s.isOpen = false; });
            subject.isOpen = opening;
            renderSubList();
        });

        block.append(add, num, fields, del);
        ui.subList.appendChild(block);
    });

    // Textareas can only be sized once they are in the document.
    sizeAllFields();
}

function iconButton(className, src, w, h, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icon_button ${className}`;
    button.title = title;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.width = w;
    img.height = h;
    button.appendChild(img);
    return button;
}

function codeField(label, subject, key) {
    const wrap = document.createElement('div');
    wrap.className = 'text_field';

    const caption = document.createElement('span');
    caption.className = 'field_label';
    caption.textContent = label;

    const area = document.createElement('textarea');
    area.rows = 1;
    area.spellcheck = false;
    area.value = subject[key] || '';

    area.addEventListener('input', () => {
        autoSize(area);
        // Whatever is typed goes into the file as-is. The geometry is only
        // re-measured to keep the frame and viewBox right; if it cannot be
        // read, the previous measurement stands.
        subject[key] = area.value;
        const parsed = parseGeometryFragment(area.value);
        if (parsed) {
            if (key === 'fill') subject.fillBBox = parsed.bbox;
            else subject.strokeBBox = parsed.bbox;
        }
        rebuild();
    });

    wrap.append(caption, area);
    return wrap;
}

/** Grows the field to fit its content, so it never shows a scrollbar. */
function autoSize(area) {
    area.style.height = 'auto';
    // box-sizing is border-box, so the borders have to be added on top of the
    // content height or the field stays two pixels short and still overflows.
    const borders = area.offsetHeight - area.clientHeight;
    area.style.height = `${area.scrollHeight + borders}px`;
}

function sizeAllFields() {
    ui.subList.querySelectorAll('textarea').forEach(autoSize);
}

// The web font arrives after first paint and reflows the text, and changing the
// sidebar width rewraps it, so the fields have to be measured again both times.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeAllFields);
new ResizeObserver(sizeAllFields).observe(ui.subList);

function addSubject(index) {
    state.subjects.forEach((s) => { s.isOpen = false; });
    state.subjects.splice(index + 1, 0, {
        fill: '', strokeIn: '', fillBBox: null, strokeBBox: null, confidence: 1, isOpen: true,
    });
    rebuild();
    renderSubList();
}

function removeSubject(index) {
    state.subjects.splice(index, 1);
    rebuild();
    renderSubList();
}

// ---------------------------------------------------------------- sidebar resize

ui.resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ui.resizeHandle.setPointerCapture(e.pointerId);
    document.body.classList.add('is_resizing');

    const startX = e.clientX;
    const startWidth = ui.sidebar.getBoundingClientRect().width;
    const min = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-min')) || 360;

    const onMove = (ev) => {
        const width = Math.max(min, Math.min(window.innerWidth - 200, startWidth + ev.clientX - startX));
        ui.sidebar.style.width = `${width}px`;
        sizeAllFields();
    };
    const onUp = () => {
        document.body.classList.remove('is_resizing');
        ui.resizeHandle.removeEventListener('pointermove', onMove);
        ui.resizeHandle.removeEventListener('pointerup', onUp);
    };
    ui.resizeHandle.addEventListener('pointermove', onMove);
    ui.resizeHandle.addEventListener('pointerup', onUp);
});

// ---------------------------------------------------------------- export

ui.download.addEventListener('click', async () => {
    if (!state.output) return;

    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const opts = {
                suggestedName: state.fileName || 'object.svg',
                types: [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }],
            };
            // Opens the dialog in the folder the original file came from.
            if (state.fileHandle) opts.startIn = state.fileHandle;
            const handle = await window.showSaveFilePicker(opts);
            const writable = await handle.createWritable();
            await writable.write(state.output);
            await writable.close();
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            console.error(err);
            // Fall through to a plain download.
        }
    }

    const blob = new Blob([state.output], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = state.fileName || 'object.svg';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
});

ui.copy.addEventListener('click', async () => {
    if (!state.output) return;
    try {
        await navigator.clipboard.writeText(state.output);
    } catch (err) {
        console.error(err);
        showError('Не удалось скопировать код в буфер обмена.');
    }
});

// Signals that the module finished wiring up, for automated checks.
document.body.dataset.ready = "true";
