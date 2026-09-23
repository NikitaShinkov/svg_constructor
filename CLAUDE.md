# SVG constructor - project context

This file carries the context into a new session. It holds everything that does
not follow from the code: what the project is for, which decisions were taken
and why, what has been checked and what is left.

---

## 1. The job

There is a third-party application - **KOMPAKS** - that svg files of diagnostic
objects are loaded into. For an object to be drawn correctly the svg must have
a fixed structure: fixed namespaces, a fixed list of classes in `<style>`, each
subject's geometry once in `<defs>`, and layer groups whose names and **order**
the application reads in order to switch visibility (6 states x 5 indicators
per subject).

An object's picture is made of **subjects**. Each subject has a fill (its
silhouette) and inner lines, plus a set of indicators in the corners and in the
middle.

**The workflow:** an artist draws the object in a vector editor (Adobe
Illustrator, Figma), exports an ordinary svg, loads it into this application and
gets back an svg in the KOMPAKS format, saving it under the same name in the
same folder.

The specification is `src_doc/Instruction.pdf` (26 pages, Russian). Its text is
encoded with subset fonts carrying **no ToUnicode**, so ordinary extractors
produce rubbish. It decodes like this: Latin letters, digits and punctuation are
`character = glyphID + 29`; Cyrillic is `А..я (U+0410..U+044F) = glyphID −
0x023A + 0x0410`; the font used for code listings has a table of its own
(`character = glyphID − 34`, plus separate codes for `< > = " / : .`). The
points that matter have already been carried into this file and into the code,
so the PDF rarely needs reading again.

---

## 2. Where everything is

```
index.html            entry point (in the root - GitHub Pages requires it)
css/styles.css
js/geometry.js        path parsing, matrices, analytic bboxes (pure, no DOM)
js/detect.js          finds subjects and fill/stroke roles in an input file
js/restore.js         reads a file this app wrote back into subjects + params
js/template.js        builds the output svg from the KOMPAKS template
js/indicators.js      12 indicator sets (6..100 px), embedded from src_doc/indicators
js/app.js             the wiring: load -> parse -> build -> preview -> export
assets/icons/         icons, copied from design/icons
server.mjs            local static server: node server.mjs [port]
start.cmd             Windows launcher: server + browser in one click
test/golden.mjs       the template against the references (Node, no browser)
test/e2e.mjs          the real app in headless Chrome over the DevTools protocol
test/detect.html      parses all 12 files in src_doc/files (open in a browser)
test/preview.html     a visual check of the build (open in a browser)

design/*.json         Figma exports (Raw plugin) - the ONLY source of the design
src_doc/Instruction.pdf   the format specification
src_doc/examples/     6 reference output files (dynamic equipment)
src_doc/examples/static/  12 references for static equipment
src_doc/files/        12 artists' sources: two per example (ai + figma)
src_doc/svg_constructor/  the OLD constructor - for reference only
```

**Important:** the design comes from `design/*.json`, **not** from the old
version. The old constructor is useful only as a source of template strings and
formulas; its markup and its behaviour are out of date.

**Launching:** `start.cmd` in the repository root replaces `node server.mjs`
typed by hand. It cd-s to its own folder, checks that Node is installed, takes
the first free port in 8080..8099 (or the one passed as an argument), runs the
server in that window and opens `http://localhost:<port>/` from a second,
minimized window that waits for the port to start listening and then closes.
Ctrl+C or closing the window stops the server. That helper window has to be
started through `cmd /c`: `start "" file.cmd` runs the batch under `cmd /K`, so
the window would hang around after the browser opens.

Repository: `https://github.com/NikitaShinkov/svg_constructor`
Live version: `https://nikitashinkov.github.io/svg_constructor/`

---

## 3. Decisions agreed with the user

| Topic | Decision |
|---|---|
| Object type | `object_type_selector`, the **first thing in `sud_sidebloсk`** whatever else is showing: «Динамическое обор.» and «Статическое обор.», one pill with the chosen half filled and the other left plain - the pointer alone changes nothing, the fill being what says which is chosen. Dynamic to begin with. It picks the template the file is built from and **nothing else**: the subjects, their code, their click areas and their indicators belong to the drawing, not to the template, and a switch leaves every one of them where it was. Switching back and forth gives the same file each time. Which type a file that is opened gets is decided by the file (section 5a), as the format itself is |
| Subject order | The order in the file (layer names, where there are any). `sort_button` in `head_line` reverses the whole list, and a row can be carried to a new place with the pointer: it follows the cursor, its neighbours step aside and mark where it will land with a `#9393FF` line, and the numbers stay as they were until it is let go - the renumbering and the rebuild happen on release |
| Lighting a subject | The list row and the shape in the preview light each other: a `#FF00FB` outline as thick as the outer stroke over the shape, and the same rectangle at 10% fill under it. It is drawn on two separate layers above and below the preview - **nothing is added to the exported file**. A click that misses every subject collapses every row: anywhere in `svg_privew_block`, the padding around the drawing included, and in the empty part of the list. Everything in the drawing that can be picked stops its own click |
| Saving the file | `showSaveFilePicker` with `startIn` on the source file: the same name, the same folder, the user confirms. The original is never overwritten silently |
| Build settings | `settings_toolbar` over the preview: indicator size (a slider over the prepared sets), outer and inner line widths, the hatch angle, width and coverage, and the offsets below and above. The fields show a number with no unit: pixels are written nowhere - not here, not in `click_area_settings`, not in `indicator_position_settings`. Only `°` and ` %` are written, and they are hidden while the field is being edited. Digits only; the arrow keys step by 1, and by 10 with Shift |
| State labels | In the interface the layers are called «ХОР», «ДОП», «ТПМ», «НДП», «Ремонт», «Резерв». These are **labels only**: the layer labelled «ДОП» is `norm` (`layer_sN_norm`), and renaming it in the code or in the file is not allowed |
| What the preview shows | The indicator switch and `layer_selection_block` (6 state segments) **change the preview only**: groups are hidden with inline `display` in the injected copy, and `state.output` is left alone. `otlichno` is chosen to begin with. Hovering a segment shows its layer and leaving it returns the last one pressed. Focus in any hatch field switches to `background`, and blur returns the previous segment. The size slider switches hidden indicators back on: there is no point resizing something that cannot be seen |
| A static object in the preview | Two things are drawn there that the file does not draw by itself. The background elements - for now the one caption - belong to the background layer in the file, because that is how KOMPAKS is told to draw them, but they are the picture the object stands on rather than a state of it, so the preview shows them whichever state is on show: the background group stays and its own contents are hidden instead. The areas KOMPAKS fills in (`View` and the eight clusters) are outlined in white with a stylesheet rule of the app's own over the injected copy. Neither reaches the file |
| A tight toolbar | The settings bar is drawn for 1920. When it runs out of room the slider narrows first, then whole blocks go, by ascending `data-drop` in the markup (currently `offset_settings` 1, `hatching_settings` 2, `lines_settings` 3, `layer_selection_block` 4, `indicators_settings` 5, `cursor_settings` 6). **There are no width thresholds anywhere:** running out of room is `scrollWidth` against `clientWidth`, recomputed by a `ResizeObserver`. A new block only has to be written into the html with a `data-drop` of its own |
| Preview zoom | The mouse wheel over `svg_privew_block`. The maximum is what it always was, the size of the block; the minimum is 150px on the longer side. What is kept is not a size but a place in the range (`state.zoom`, 1 is the maximum), so both ends are recomputed when the window changes width and the level stays as it was. What is scaled is a `transform` on the whole `preview_stage`, so the highlight layers cannot drift off the drawing |
| Indicator size | The slider's label is «Индикаторы Ø45». 45px to begin with, outline 3.4 - as in every file in `src_doc/examples`. KOMPAKS does not read a `scale`, so the sizes are not scaled but taken as prepared sets of paths: 6/0.5, 10/0.8, 16/1.2, 20/1.6, 24/2, 28/2.1, 32/2.4, 38/2.9, 45/3.4, 60/4.6, 82/6, 100/8 in `js/indicators.js`. The diameter is the outer one, with the outline counted in. The slider takes its list from the table's keys, and the ends of its range with it: to add a size, add a set. The number in the label holds the width of the widest of the sizes, or the bar would jump at every step of the slider. That width is **measured** (`reserveSizeWidth`, a probe off the edge of the page, because the bar is hidden until a file is loaded and cannot be measured), not written into the css: `ch` is the width of a zero without the tabular figures the label asks for, and "100" does not fit in three of those |
| Picking a subject | A subject is selected by clicking its row, its shape, its click area or any of its indicators, and it is lit while the pointer is on any of those. Hence two hit rectangles per subject in the preview - the click area and the subject's own shape, which part company as soon as a border is moved - and the indicators answer for their subject too. **What answers the pointer must not depend on what is lit:** an area that goes inert under the cursor hands it straight back to what is underneath, and the two then take turns for as long as the pointer is there |
| Click area | `click_area_settings` above the subject list, there only while a subject is selected: four fields (top, right, bottom, left), positive outwards, negative into the subject, and a `reset_button` that puts all four back to 0. This is the real `layer_sN_frame`, so the pink highlight is it; a border stops where the frame would be left thinner than 1px. The indicators do **not** follow it - they belong to the subject and stay on its own rectangle |
| Dragging a border | A 9px grab band on screen whatever the zoom, `ns-resize`/`ew-resize` under the cursor, and the file is rebuilt as the border travels. The bands belong to any lit subject, hovered or selected, and pressing one selects that subject, so a border can be taken hold of straight away. Alt mirrors the border across the middle of the area, so both sides travel together and the centre stays put. Within 3% of the subject's own width or height, a border takes the nearest line worth landing on: its own subject's edge (where the field reads 0), every other subject's shape and click area, and the four edges of the document. The line it is on is drawn right across the document, 1px in `#FF00FB` whatever the zoom, and goes as soon as the border leaves its reach; when the line is another subject's click area, that subject lights up as though the pointer were on it. The lines are worked out once, when the border is picked up - the document grows as a border travels, and a line that moved with it would be something to chase rather than to land on - and where two fall together (a click area and the shape inside it) the click area is the one kept, because it is the one that lights up. A typed number is left as typed. A border in hand owns the pointer until it is let go: no other subject lights up as it is carried over them, and the cursor stays the resize one (`cursor: inherit !important` on everything, because the hit areas under it carry cursors of their own and say so more specifically). What is under the pointer when it is let go is asked for with `elementFromPoint`, since resting on something is not an event |
| Indicator positions | `indicator_position_settings` under the click area block, for the selected subject: an X and a Y field per indicator, in the same three columns (old_repair over old_sost, insert, old_lock over fail). Clicking an indicator in the drawing picks it out - which shows on its pair of fields, outlined in `--accent`, and nowhere in the drawing itself - and the arrow keys then move it, 1px a press and 10 with Shift. Every indicator on show can be clicked, on any subject, selected or not; being switched off on the toolbar is the one thing that takes their hit areas away. Shift and a click gathers a group: the indicator clicked joins the ones already picked, or leaves them if it was one of them, and the arrows then move all of them at once. The subject with the say stays the first one's - that is the one the sidebar is showing - and the subjects of the others are only lit. Alt and a letter lines a group up, read by where the key sits rather than by which letter it types, since the layout may be Cyrillic: `KeyA`/`KeyD`/`KeyW`/`KeyS` put their left, right, top or bottom edges on the outermost of the group, and `KeyH`/`KeyV` put their middles on the first one picked - `KeyH` on one vertical line, `KeyV` on one horizontal. Every indicator is the same square, so lining up an edge and lining up a middle are the same move - only the line drawn afterwards differs. That line is the one the snapping uses (`hl_guide`), and it stays until the next click or arrow. The group is put down by Esc, by a click on anything that is not an indicator, or by a click on one without Shift, which starts a new group (a listener on the way in, since the drawing stops its clicks on the way out). The offsets are part of the file: they are the `x`/`y` of the `<use>`. Its `reset_button` puts the five indicators of the subject on show back in their corners, and reaches no further than that subject |
| Undo, and R | Ctrl+Z puts back the last change to a click area or an indicator, and only that one: there is no history, and nothing to redo. What counts as one change is a gesture, not a keystroke - a whole border drag, a whole number typed into one field, a whole group moved by one arrow press or lined up by one alignment - which `keep(token, before)` does by ignoring a second snapshot from a gesture that already has one. The step is a copy of every subject's `clickArea` and `indicatorOffsets`, dropped when a subject is added, removed or reordered, since it could no longer be put back. R gives the selected subject both its click area and its five indicators back at once; neither key reaches past a field being typed into, where the browser's own undo is the one wanted |
| Offsets | `offset_settings` on the bar, after the hatching: the empty space under the object (70px, which the format has always had) and as much above it as is asked for. Both are part of the document - the viewBox grows - and the file is rebuilt as they are typed. While one of the two fields has the focus, its strip is lit the way a selected subject is and the edge of the whole document is drawn round it in `#FF00FB`, 14px of line and 14px of gap as on the drop frame (`non-scaling-stroke`, stroked at double width so the outer half is clipped away). An offset is about the document, not about a subject, so reaching for one of these fields puts down whatever subject and indicator were picked; letting go of the field takes the lighting away and leaves the offset. The space above the object goes into the file as a shift of the group around the layers, never as the origin of the viewBox (section 4). The margin a static object is laid with is an offset of the same kind and its strip is shown the same way, running from the alignment area's right edge to the `View` rectangle it is measured from and standing as tall as that rectangle - but **without** the edge of the document round it: the two offsets move the page, while the margin moves an area inside it and leaves the page exactly as it was |
| Offsets for a static object | A static object's page is a fixed size, so there is nothing for the two offsets to move. The block is therefore **not on the bar at all** while static is chosen (class `is_off`), and it comes back with its values when dynamic is. That is not the bar running out of room, so it is kept apart from the order the bar gives its blocks up in: `fitToolbar` leaves an `is_off` block out of that order and never marks it `is_hidden` |
| Aligning a static object | `align_settings` on the bar, after the hatching, sharing the offsets' place: the two are never there at once, one belonging to a document that grows and the other to a page that does not, so they carry the same `data-drop` and each is `is_off` when the other is on. «Выравнивание», three 23px buttons and then «с отступом» with the margin field. The buttons are the middle, one side and two sides; the last two carry four variants each (`top`→`right`→`bottom`→`left`, `left_top`→`right_top`→`right_bottom`→`left_bottom`) and step on to the next when the button that is **already the chosen one** is pressed again - pressing any other takes it as it stands. The nine between them are the nine pairs of axes. A button is filled while it is the chosen one or under the pointer, which is CSS; pointing at one lays the object that way at once and rebuilds the file, taking the pointer off the three puts the kept one back, and only a press keeps it. Pointing at one also draws the edges of the area it lays against - four for the middle, one for a side, two for a corner - as the same `hl_guide` line the snapping draws, and lights the margin strip whenever the right-hand edge is one of them, so the line and the reason for it are never shown on their own. `state.align.saved` is the kept variant, `state.params.alignH/alignV` is what is being built, and the two differ only while the pointer is on a button |
| Carrying the pointer across the buttons | The three sit in `align_buttons`, and what is being shown is put down on the way out of **that**, not out of a button: carrying the pointer from one to the next crosses the 4px gap between them, and a gap that put the kept alignment back for those few frames would make the object flick as the pointer travelled. Each button also reaches the full height of the bar for the pointer while staying 23px to the eye, as the layer segments do (a pseudo-element of the button, so hover and clicks land on it), and the strip does the same, so the gaps belong to it at any height. It is why `.settings` is the height of the bar rather than of its contents - a box only as tall as what is in it clips those hit areas away - and why a button cannot clip its own overflow, the glyph being rounded off by its own `border-radius` instead. A press from the keyboard leaves nothing showing (`:hover` is asked), since the pointer would never be there to take it away |
| Switch strips | A 26px toggle is a small thing to aim at, so the whole strip is the switch: `cursor_settings` answers to a click anywhere on it, and so does `indicators_settings` - the switch, the label and the space around them. The slider shares the indicators' strip and keeps its own clicks (`#indicators_slider` is let through), which a drag let go of over the label proves: the pointer is the slider's until it comes up |
| Cursor | A triangle to the proportions of `design/icons/pointer.svg`, drawn on the highlight layer at the foot of the selected subject's click area: a third of the average subject's width, 0.8 of that in height, its tip a third of its own height inside the bottom border. The switch in `cursor_settings` (before `indicators_settings`, `data-drop="6"`) changes the preview only. It stands below the area it belongs to, so a subject at the foot of the drawing puts it outside the document: the layer it is on does not clip (`#highlight_front { overflow: visible }`), and nothing is added to the document to make room for it - the zoom is measured on the file, not on a mark that is not in it. At the largest zoom it is therefore cut off by `svg_privew_block`, which clips instead so that it is never drawn over the sidebar; zooming out brings the whole of it into view |
| Scope | Do not carry the old constructor's features over until asked |
| Interface language | Russian |
| Language of everything else | English, all of it: README, CLAUDE.md, code comments, console output, commit messages and replies. Only the app's own interface and the strings it shows stay Russian |
| Font | Inter 12px - everywhere, one size and one weight |
| Input validation | **There is none.** What the user typed into a field is what goes into the file |
| The first screen | While no field holds anything: one expanded `s0` in the list, a filled `upload_button`, `download_button` and `copy_button` hidden, a drop target in place of the preview, and the settings bar hidden too (there is nothing to set). As soon as a field holds text - or a file is loaded - the screen becomes the ordinary one |
| Deleting a subject | The last subject cannot be deleted: with a single row, `delete_sub_button` is not drawn at all |
| Opening one of our own files | A file already in the KOMPAKS format is read back as it stands rather than detected: the same file comes out again, with every setting it was written with. Which of the two readings a file gets is decided by the file (`js/restore.js`, `isTemplateDocument`), never by the user, and **`detect.js` is not touched for it** - it answers a different question and answers it correctly |

**A browser limitation:** saving into the source folder works in Chrome and Edge
only (the File System Access API). In Firefox and Safari the file is downloaded
to the downloads folder under the same name. No web API allows anything else.

---

## 4. The output format

The file is built from one of two templates - dynamic or static equipment. The
dynamic one is described below (Instruction.pdf); the static one differs only in
what section 4a lists, and everything else is shared: the styles, the subjects'
defs, the `layer_sN` layers, the indicators, the hatch and the geometry.

The order of the tags is fixed (Instruction.pdf 6.2):

1. `<svg>` with exactly `xmlns`, `xmlns:xlink`, `xmlns:inkscape`, `viewBox`, `width`, `height`
2. `<style type="text/css">` - a fixed list of classes
3. `<defs>`:
   - `<linearGradient id="linear_grad">` - the hatch of the «Резерв» state
   - per subject, by ascending index, with a `<!--sN-->` comment:
     `layer_sN_frame` (a `<rect>`), `layer_sN_fill`, `layer_sN_stroke_in` -
     **`id` only**, no `inkscape:label` and no `style`
   - `<!--indicators-->` - the symbol library `#circle #fail #old_repair
     #old_lock_icon #old_lock_norm #old_lock_tpm #old_lock_ndp #insert`
4. `<g id="layer_sN" inkscape:label="layer_sN" style="display:inline">` for N = 0..n−1,
   with exactly these children in exactly this order:
   `_background` -> `_sost` (otlichno, norm, tpm, ndp, repair) -> `_fail` ->
   `_old_sost` -> `_old_repair` -> `_old_lock` -> `_insert`
5. `<g id="layer_o">` with empty `_background_off` / `_background_on` and a `<rect>` over the whole viewBox

When there is space above the object, the `layer_sN` groups of step 4 - and
only those - are wrapped in one unnamed `<g transform="translate(0 N)">`.
`layer_o` stays outside it: its rect is the document, not the object being
moved inside it. With no space above, there is no group and the file is what
it always was.

The rules that must hold:

* every group from `layer_sN` down carries an `id`, the same `inkscape:label` and `style="display:inline"`;
* inner lines are **black** (`st_in st_b`) for `norm` and `tpm` only, and white (`st_in st_w`) in every other state;
* indicators are positioned with the `x`/`y` attributes of the `<use>`, **never** with a `transform`;
* `width` and `height` equal the width and height of the `viewBox`;
* **+70px** is added below the artwork to the height of the `viewBox` (`bottomPadding`), and nothing to the width. Nothing is added above by default (`topPadding` = 0), but both offsets can be changed on the bar, and then the `viewBox` grows;
* **the `viewBox` never starts above the artwork.** KOMPAKS reads the height but ignores the origin: with `y="-70"` it draws the subjects from the top of the box and the offset ends up under the object instead of above it. The origin therefore stays the artwork's own top (`max(0, minY)`), and the space above is made by moving the object down - `transform="translate(0 N)"` on a group around the layers, **an attribute and not a class**, since the stylesheet is not read for this. Neither the `viewBox` nor `layer_o` ever holds a negative coordinate;
* there are no self-closing tags: `<use ...></use>`;
* numbers are `.toFixed(2)`; the ends of the gradient `.toFixed(0)`; stop offsets `.toFixed(2) + "%"`;
* by 6.1, **nothing** may be in the file that is not in the specification.

### 4a. Static equipment

References: `src_doc/examples/static/` (12 files). These are the only
differences from the dynamic template; everything else is the same:

1. **The page is a fixed size**: `width="1845.00" height="800.00"`,
   `viewBox="-1.00 -1.00 1845.00 800.00"`, `preserveAspectRatio="xMinYMin meet"`.
   The page is not measured from the drawing - the drawing is placed into it.
   The two offsets therefore have nothing to move and do not reach the file.
   `preserveAspectRatio` matters outside the file as well: it decides where a
   box that does not fill its element is drawn inside it, so anything drawn over
   the file has to be given the same value (see the preview, below).
2. **`layer_o` comes before the subject layers** rather than after them, and it
   holds not the document's frame but the areas KOMPAKS replaces with objects of
   its own: `View`, eight `ClusterN`, `tbtClusterLeft/Right`, two arrows and
   `Subject`. The block is the same in every such file and is embedded in
   `js/template.js` (`STATIC_LAYER_O`) **verbatim**, self-closing tags and the
   `inkscape:label="#Cluster10"` typo on `Cluster1` included: these are the
   files the third-party application reads today.
3. **The object's background** - lines, shapes and text of any colour and size -
   lives in `<defs>` -> `<g id="background_elem">`, and is drawn because
   `layer_s0_background` -> `<use xlink:href="#background_elem">` points at it.
   Without a reference from a subject layer KOMPAKS draws no background at all.
   A simplified version is written for now: the one caption «Источники АЭ» at
   `x="20" y="765"`.
4. **The drawing is laid in an area of the page.** The area is three edges of
   the `View` rectangle and one of the caption under it:

   | edge | where |
   |---|---|
   | top | the top of `View` |
   | bottom | the bottom of `View` |
   | left | where the «Источники АЭ» caption starts |
   | right | the left edge of `View`, less the margin the toolbar asks for |

   The object is laid against whichever ends of it `alignH` and `alignV` name -
   nine places, the middle of the area to begin with - and `alignOffset` is the
   one formula that works any of them out. `left`+`top` is where the drawing
   used to go and puts its corner on `20 26`.

   The numbers are constants of the application (`STATIC_DOC.view` and
   `STATIC_DOC.captionX` in `js/template.js`), not literals in the markup: they
   are expected to become settings. They are also written into the markup, by
   `STATIC_LAYER_O` and by `backgroundElem`, and the markup is kept verbatim
   rather than built from them - so the golden test holds the two against each
   other instead, and they cannot drift apart.

   The move is written the way the dynamic file writes the space above the
   object: `transform="translate(dx dy)"` on the unnamed group around the
   layers, **as an attribute and not a class**, since the stylesheet is not read
   for this. It also means the whole group can be moved by hand later.
5. **The caption is moved the other way.** It lives inside `background_elem`,
   which is to say inside the moved group, so it carries
   `transform="translate(-dx -dy)"` and stays where it is however far the object
   travels. It is the only negative number in a static file, the start of the
   `viewBox` aside.

### Geometry

A subject's rectangle is measured on the **fill only** (not on the union with
the lines), and is grown by the width of the outer stroke:

```
base.w = bbox.w + st_out        base.x = bbox.x − st_out/2
base.h = bbox.h + st_out        base.y = bbox.y − st_out/2
```

**Click area.** Each subject carries four offsets (`clickArea`: `top`, `right`,
`bottom`, `left`, all 0 unless the sidebar moved them) that push the borders of
that same rectangle outwards:

```
frame.x = base.x − left                 frame.w = base.w + left + right
frame.y = base.y − top                  frame.h = base.h + top + bottom
```

`base` is the rectangle above - the subject's own, which every frame carries
with it. What reads which matters:

* `layer_sN_frame` in the defs and the highlight in the preview are the frame:
  that is what the click area is;
* the five indicator positions are worked out on `base`, so moving a click area
  leaves them on the subject they belong to;
* the viewBox is the union of **both** rectangles of every subject. An area
  pushed outside its subject grows the document; one pulled inside it cannot
  shrink the document, or an outermost subject would crop the drawing it is
  still drawn in.

**Indicator offsets.** Each subject also carries a nudge per indicator
(`indicatorOffsets`, `{x, y}` by key, missing means zero), added to the corner
and centre placement of Instruction.pdf 5.5. The reference files need them:
`CC2` has subjects about 52px tall, where four 45px indicators in the corners
would overlap. An indicator that has been nudged counts towards the document
bounds as well - at its own place it is inside the subject already, so this can
only grow the document, and an indicator pushed off the subject is not cut off.

`computeLayout` works the positions out once, into `frames[i].indicators`, and
both the builder and the preview read them from there.

With all four borders and every offset at 0 the output is byte for byte what it
was, which is what the golden files check.

Checked against an exact bbox over the cubic curves: PG s0 `(1,1,220,250)` →
`(0,0,222,252)`, PG s1 `(227,1,126,250)` → `(226,0,128,252)`, Object s0
`(1,1,170,250)` → `(0,0,172,252)` - the references agree to the digit.

With `D = 45 × scale`:

| group | corner | x | y |
|---|---|---|---|
| `_old_repair` | top left | `x` | `y` |
| `_old_lock` | top right | `x + w − D` | `y` |
| `_old_sost` | bottom left | `x` | `y + h − D` |
| `_fail` | bottom right | `x + w − D` | `y + h − D` |
| `_insert` | centre | `x + w/2 − D/2` | `y + h/2 − D/2` |

The `viewBox` is the union of the frames grown by the offsets: its height is
`objH + topPadding + bottomPadding`. The gradient is measured on the size of the
object **before** the offsets.

The file and the app put the origin in different places, and that is the only
thing they differ in. `computeLayout` hands out both: `viewX/viewY/viewW/viewH`
and `viewBox` are the document's own coordinates, which the highlights, the
offset bands and the border drags all work in; `fileViewX/fileViewY` and
`fileViewBox` are what goes into the file, and `shiftX/shiftY` is how far the
object is moved inside it. The two boxes are the same width and height and
differ by exactly the shift, which is why the highlight layers and the injected
file line up to the pixel: a point of the artwork lands on the same place on
screen in both. `x/y/w/h` stay the artwork's own throughout, whichever template
is being built.

| | dynamic | static |
|---|---|---|
| `viewW/viewH` | `objW`, `objH + topPadding + bottomPadding` | 1845, 800 |
| `viewX/viewY` | `minX`, `minY − topPadding` | the file's box less the shift |
| `fileViewX/fileViewY` | `minX`, `max(0, minY)` | −1, −1 |
| `shiftX/shiftY` | 0, `fileViewY + topPadding − minY` | whatever lays the object in the alignment area (4a) |
| `preserveAspectRatio` | none, so the default | `xMinYMin meet` |

The same size is not enough on its own: a box that does not fill its element has
to be put somewhere inside it, and `preserveAspectRatio` is what says where. The
layout hands the file's value out with the rest, and `renderHighlights` puts it
on both highlight layers, so the two can never disagree - left on the default,
they would centre what the file aligns to the top and every subject would be out
by the same distance.

### The hatch

A port of `get_bg_pos` / `generateStripeStops` from the old `scripts.js`.
With `0 < angle < 90`: `y2 = h + (w − h/tan θ)·sin θ·cos θ`, `x2 = tan θ·(y2 − h)`,
`x1 = w`, `y1 = 0`, `L = y2/sin θ`. The stripe: `run = lineWidth`,
`gap = lineWidth·(100/coverage − 1)`. A negative `x2` is normal.
Checked against the references: Object → `x1=172 x2=−40 y2=212`, `L=299.81`,
**92 stops**; PG → `x1=354 x2=51 y2=303`, `L=428.51`, **130 stops**.

The indicator sets were copied verbatim from
`src_doc/svg_constructor/scripts for different indicators sizes/` (a folder per
size) into `js/indicators.js`; the 45/3.4 set matches the references byte for
byte.

---

## 5. How subjects are detected

This is for a drawing from an editor. A file this application wrote never
reaches any of it: `restore.js` recognises the format first (see section 5a),
and the detection would find nothing anyway - everything drawable lives in
`<defs>`, so the only shape outside them is the full-bleed rect of `layer_o`,
which it throws away as a background. That is the "В файле нет фигур, кроме
фона." the app used to answer one of its own files with.

Three strategies, and the first one that fits wins:

1. **By layer name.** Illustrator escapes names that start with a digit: layer
   `0` becomes `id="_x30_"`, `15` becomes `_x31_5`, `s_10` becomes `s_x5F_10`.
   The application decodes `_xHH_` and takes the number out.
2. **By group.** Every `<g>` holding shapes is a subject.
3. **By drawing order.** Figma exports a flat list with no groups and no ids:
   the artboard rectangle, then pairs of "fill / lines".

Editors write their layers top to bottom, so strategies 2 and 3 reverse the
order.

The role within a subject is a weighted sum: the element's name (6.0), how the
bounding boxes nest (5.0), fill and stroke (4.0), "effective thickness" (4.0),
the ancestors' names (3.0), the share of open subpaths (3.0), fill density
(2.5), and drawing order (1.5).

**Why the `fill` attribute alone is not enough:** Figma exports strokes as
filled "ribbons" with a `fill` and no `stroke`, and names them things like
`Vector 2`. Only the geometry tells them apart: a ribbon of thickness `t` has an
area of about `length·t/2`, which is a relative thickness of 0.01-0.04 against
0.15-0.5 for a silhouette.

In Illustrator the fill arrives from an internal `<style>` (`.st0 { fill: ... }`),
so reading attributes will not do: the file is mounted in a shadow root and read
through `getComputedStyle`. The shadow root is there so that `.st0`/`.st1` from
someone else's file cannot leak into the application's own styles.

---

## 5a. How a file of our own is read back

`js/restore.js`. The file is recognised by `layer_s0_frame` + `layer_s0` +
`layer_o`; anything else is a drawing and goes to `detect.js`. Nothing is
guessed - every number is read back through the one formula that wrote it:

| what | where it is read from |
|---|---|
| `objectType` | `static` when layer_o holds a `View` rectangle and the defs hold a `background_elem`, `dynamic` otherwise |
| `stOutWidth`, `stInWidth` | `.st_out` / `.st_in` `stroke-width` in `<style>` |
| `indicatorDiameter` | `cx` of `#circle`, which is D/2 in every prepared set; `.icons_st_out` width is the fallback. Snapped to a prepared size, since only those can be rebuilt |
| `indicatorScale` | `.scale {transform:scale(...)}` |
| `hatchAngle` | tried against the gradient vector: it is written with no decimals, so the angle is whichever integer 0..180 writes the file's four numbers |
| `hatchLineWidth`, `hatchCoverage` | the first four stops - the first pair ends one line width along the vector, the second starts one full period along it |
| `clickArea` | `layer_sN_frame`'s rect against the subject's own rectangle (the fill bbox grown by the outer stroke) |
| `indicatorOffsets` | the `x`/`y` of each indicator's `<use>` against where Instruction.pdf 5.5 puts it |
| `topPadding` | the `translate` on the group around the layers, plus however far the `viewBox` starts above the artwork - a file written before the transform carried it there instead, and one of the two is always zero |
| `bottomPadding` | what is left of the `viewBox` height once the artwork and the top offset are taken off it |
| `alignH`, `alignV`, `alignMargin` | that same `translate`, in a static file: which of the nine alignments, with which margin, would have written it |

The two offsets are read out of a dynamic file only. A static one is a page of
a fixed size with the object laid in an area of it, so it holds neither - the
`translate` on its group says where the object was laid, not how much room was
left above it - and both come back at their defaults. That transform is where
`alignH`, `alignV` and `alignMargin` are read from instead: `alignOffset` is the
one formula that wrote it, so each of the nine is tried, first as it would be
with no margin and then solving for the margin that would put the object where
the file has it. The margin is a whole number of pixels, the field holding
nothing else, so a solution is rounded before it is checked and kept only if it
writes the transform the file carries. `left` does not move with the margin, so
a file laid against that edge comes back with the margin at 0 whatever was
typed. A static file this application did not write matches none of the nine and
is left on the defaults. The background elements of a static file are not read
back either: the template writes the one caption, so a static reference that
carries more than that loses the rest.

Geometry is **not** rebuilt: the markup inside `layer_sN_fill` and
`layer_sN_stroke_in` is cut out of the source text, not serialised from the
parsed DOM, which would re-quote attributes and self-close empty tags. Only the
newline and indent the builder put around it are stripped - trailing spaces on
the markup's own line are part of what was written and are kept, which is why a
reference file survives the round trip byte for byte.

Everything read is rounded to two decimals, which is what the file holds, and
clamped to the range of the field that shows it. A difference below 0.01 is
therefore noise from `toFixed(2)` and reads as 0: with five of the six
references, every click area comes back at exactly 0, and `CC2` - the one whose
frames were edited by hand - is the only one that comes back with any.

---

## 6. How to check it

```
node test/golden.mjs            # the template against the references, no browser
node server.mjs 8080 &
node test/e2e.mjs 8080          # the real app in headless Chrome
```

`test/e2e.mjs` drives the page over the DevTools protocol: it loads files
through the real file input and checks both the layout (sidebar width, colours,
borders, one font, labels on the baseline, buttons of equal width, a 4px
scrollbar) and the behaviour (editing rebuilds the svg; adding, deleting and
carrying a row renumber the layers; the right edge of the sidebar drags and
never goes below 360px; the first screen and the drag screen are built to the
design and go as soon as a field holds code; the settings bar changes the file
and the preview separately; the wheel zooms the preview within its range).

The click area has a section of its own: the block appears with the selection
and goes with it, a typed border moves the frame and the document but not the
indicators, a negative one eats into the subject without cropping the drawing,
reset puts them back, the four grab bands measure 9px on screen and carry the
right cursor, and then four drags with the real pointer - one that grows the
area and the field with it, one on a subject that is only hovered (which picks
that subject up), one with Alt held (both sides, centre still), and one that
lets go inside the snapping range (the field lands on 0). Three more follow the
border onto the lines it can land on - the next subject along (which lights up),
the end of the document, and the foot of it, which belongs to nobody - and check
that the guide goes when the border is carried out of reach. A last drag checks
what a border in hand owns: carried across a neighbour, nothing but the subject
being adjusted is lit, and the body and the element under the pointer both read
`ew-resize` until the button comes up. The pointer is a third of the average
subject, centred, clear of the border - and none of it reaches the file.

The indicators have their own section after it: the block is drawn as designed
under the click area, pointing at an indicator lights its subject and keeps it
lit while the pointer rests there, clicking one picks out both the subject and
the indicator, the arrow keys move that one indicator (1px, 10 with Shift) and
leave its neighbours alone, Esc puts it down and the arrows go quiet, the shape
outside a shrunken click area still picks its subject out, one indicator pushed
off the subject grows the document, the block follows the selection from subject
to subject, and hidden indicators answer to nothing. Then a group of three,
gathered with Shift across both subjects: the arrows move all of them, Alt+W and
Alt+A line their edges up on the outermost one and Alt+V their middles on the
first one picked, each drawing its line across the document, an arrow puts that
line away, a plain click starts the group again from one indicator, and a click
elsewhere puts it down. The reset button is checked for reaching no further than
the subject on show, R for giving that subject both its indicators and its click
area back, and Ctrl+Z for putting back the last change and nothing before it.

The offsets have a handful of checks of their own, run at 1920 because the block
is the first the bar gives up: the bottom field starts at the 70 the format has,
reaching for a field lights its strip and the edge of the document and puts down
whatever was picked, typing grows the document without moving the artwork, and
letting go leaves the offset but not the lighting. Typing into the top one is
also held to how the space above the object is written: the box still starts at
the artwork, the layers are wrapped in a group carrying an inline
`translate(0.00 40.00)`, `layer_o` is not in that group and still covers the
whole document, no attribute in the file begins with a minus, and the group goes
when the offset does. Reading it back has a check of its own beside the restore
ones: the same file with the offset put where it used to be - in the origin of
the box - still reads as the same 40.

Reading our own files back has a section of its own. The three references with
something to say - `PV`, `PK` and `CC2` - are restored and built again inside the
page (the modules are imported into it, since what is being checked is a file
going in and the same file coming out, which the sidebar can only show a corner
of): the frames, the indicator coordinates and the `viewBox` come back where the
file has them, the parameters read are the ones the file was written with, and a
second pass gives the same file byte for byte. A sketch from an editor is checked
to be left to the detection. Then the app itself: `CC2` goes in through the real
file input - 26 subjects, no error bar, Ø32 indicators and a 6px hatch on the
toolbar - and the click area and indicator fields of s6, whose frame was narrowed
by hand, hold what the file has. Last, the journey the user makes: a sketch is
loaded, seven settings, two borders and one indicator are typed in, and what the
preview holds - the copy of what would be exported - is read back and has to say
what was typed.

The object type has a section after that. The selector is checked where the
design puts it - the first thing in the sidebar, one 26px accent ring round two
halves with the dynamic one filled, and offered before anything is loaded - and
again once a subject is selected, where it still has to be above the click area
and indicator blocks the selection brings with it. The pointer is then put on
the half that is not chosen: it must not fill, and both labels must sit the
pixel above their line box that the design draws them at. Then a sketch is loaded, a
click area and an indicator are typed into, and the static button is pressed:
the file comes back the fixed 1845x800 page, layer_o ahead of the subjects with
its `View` and eight clusters, the caption drawn because s0 points at it and
carrying the opposite move, the object centred in the alignment area, and the
highlight layer's box the same size as the file's and offset by exactly that
move. Four checks then cover what the preview shows: an untouched subject's
outline and
tint land on its shape on screen to within a pixel and a half (which is what
the two layers carrying the same `preserveAspectRatio` buys, and it covers the
hit areas, the snapping lines and the alignment guides in one - all of them are
drawn from those rectangles); the caption is on show on the «ХОР» layer while
the rest of the background layer is not; the view and the eight clusters are
stroked white 2 with no fill and take no clicks, and carry nothing of it in
their own markup; and the offsets block is off the bar - `is_off` rather than
`is_hidden`, at 1920 where the bar gives nothing up of its own accord - with
everything else still there.

The alignment block follows, at that same width. It is checked where the design
puts it, after the hatching, with its two labels, three 23px rounded buttons
carrying the middle, the top and the top left, the chosen one filled and the
others the same colour as the margin field beside them. Then the pointer is put
on a button: the object goes to the corner at once and two guides are drawn, the
middle draws four, and taking the pointer away puts both the object and the
guides back. Five more follow the pointer as it travels: into the gap between
two buttons, where what is being shown has to stay put, and on to the next
button, where it has to change over; then above a button, below it, and above
the gap, all of which have to answer as the button does. A press keeps an
alignment, a second press on the same button steps it on to the next variant -
and the button the pointer is not on keeps the variant it was left showing. The
margin is typed in and has to move the right edge of the area and nothing else;
its strip is then checked for being lit while the field is being edited, for
measuring from the area's right edge to the `View` rectangle and standing as
tall as it, for leaving the edge of the document alone where the two offsets
draw it, for going when the field does, and for coming back whenever an
alignment against that edge is being shown - and not when one against another
edge is. Last, all eighteen of them - nine alignments, two margins - are written
to a file and read back inside the page: each has to come back as it went in and
rebuild byte for byte, the margin excepted where the object was laid against the
left edge, which it does not move.

What the sidebar holds has to be what it held before, and pressing the dynamic
button back has to give the very same file again and the offsets block with it.
Last, the two ways round of reading: a static reference restores as static with
no offsets and rebuilds byte for byte, and a dynamic one still restores as
dynamic.

The two switch strips have a short section of their own at the very end: the
label toggles, the gap between the switch and the label toggles, the switch
still toggles once and not twice now that its click bubbles to the strip, a
click on the slider changes the size and leaves the switch alone, and a drag
started on the slider and let go of over the label does the same.

Last of all, the bar and the preview block: stepping the slider to 6 and to 100
leaves every other block on the bar at the same x, and then, with the bottom
offset taken off so that the selected subject sits at the foot of the document,
the pointer is checked to hang below the drawing and outside it - cut off by the
block at the largest zoom, and whole once the wheel has zoomed out, with the
clipping where it belongs on both (`visible` on the layer, `hidden` on the
block). A click in the padding beside the drawing then puts the subject down,
which is the part of the block that is not the drawing at all.

The browser window in the test is 1600x900: the settings bar is drawn for 1920,
and in a narrower window its controls are clipped and clicks aimed at them land
on the layer segments. Checks that need a different width set it through
`Emulation.setDeviceMetricsOverride` and put it back afterwards. **No width is
written into an expectation:** the bar is checked by dragging from 1800 to 400px
against invariants (nothing is clipped, the visible blocks are always the tail
of the `data-drop` order, and narrowing a block never comes back), and the zoom
against keeping its place in the range rather than a size. `app.js` sets
`document.body.dataset.ready` at the end so the test can wait for the module
instead of guessing a delay, and `document.body.dataset.loaded` once a file is
parsed - by the number of rows in the list a loaded file can no longer be told
from the first screen, which already holds an empty `s0`.

How far each reference is matched:

| File | Level |
| --- | --- |
| `PV_3m4v6s_R-RS-S.svg` | complete, byte for byte (6 subjects) |
| `PK_3m4v7s_R-R-R.svg` | complete but for s1's indicator coordinates |
| `PG_2m1v2s_S-S.svg`, `Object_1m1v1s.svg` | viewBox, frames, gradient, layer count |
| `CC2_4m7v26s_S-R-S-S.svg` | **do not use**: some frames were edited by hand (`x="139"`, `width="57"`) |
| `static/AE_Separator_8.svg` | only what the template decides for itself: the header, `layer_o` verbatim, the order of the blocks, the object's move and the caption's opposite move. The frames and the gradient cannot be compared - they were edited by hand, as `CC2`'s were |

An invariant: the number of `inkscape:label` is `20 × subjects + 4`. A static
file has a different one: its `layer_o` carries 10 more, on its rectangles.

---

## 7. Known limits, and what to do next

1. **A drawing from an editor always starts on the defaults.** Click areas and
   indicator nudges come back out of a file this application wrote (section 5a),
   but a sketch has nowhere to keep them, so it begins with every one of them at
   zero. Rebuilding a reference such as `PG` or `CC2` from its own draft still
   means moving its indicators by hand - though the reference itself can now be
   opened, and it arrives with every nudge it was drawn with.
2. **The indicator sets are the real ones, but their sources will not be in the
   repository.** The twelve sets in `js/indicators.js` (6...100px) were built
   from `src_doc/indicators` - a file per size, `ind_<diameter>_<outline>.svg`,
   the diameter being the outer one with the outline counted in. That folder was
   to be deleted and never reached the repository, so all of the geometry is
   embedded in the module and the application does not refer to it. A new size is
   added as a set of its own (`strokeWidth` + `icons`) and the shape of the table
   does not have to change: both the slider's list and the ends of its range come
   from the keys. Seven of the earlier sets matched the new files byte for byte,
   which is why the references still agree.
3. **Subject order is corrected by hand - and it has to be.** In the
   `AVO_2m4v4s_R-R` draft the layer names run the other way round from the
   reference: the group named `3` holds the bottom shape, which the reference
   calls `s0`. The Illustrator and Figma files agree with each other, so it was
   the reference that was renumbered. Hence `sort_button` (reverse the whole
   list) and carrying a row with the pointer (correct one).
4. `<text>` is not converted to outlines (that needs font metrics) - text has to
   be converted to curves before export.
5. Clipping (`clip-path`, `mask`) is ignored.
6. **A static object's background is simplified for now.** `background_elem` is
   written with the one caption «Источники АЭ»; the lines, arrows, frames and
   other text that the references in `src_doc/examples/static` carry are neither
   built by the template nor kept when such a file is read. The `.text_bg`,
   `.bg_st`, `.arrows` and `.arrows_1` classes from the references are not
   written into `<style>` either - by 6.1 nothing spare may be in the file, and
   there is nothing to use them yet. When the background starts being editable,
   both the classes and the contents of `background_elem` will have to be added.
7. `upload_button` and `download_button` are strictly the same width
   (`flex: 1 1 0`). With the sidebar at 360px half the row is 145.5px, while
   "Загрузить svg-файл..." needs 149.3px at the design's 10px padding, so these
   two carry 6px instead. `copy_button` keeps the design's 10px.

---

## 8. What not to do

* Do not put the space above the object into the origin of the `viewBox`, and
  do not make it a class. KOMPAKS reads the height of the box but ignores
  where it starts, and does not read the stylesheet for this: the top offset
  is a `transform` attribute on a group around the layers, and `layer_o` is
  not in that group.
* Do not tie the object type to anything but the template. The subjects, their
  code, their click areas and their indicators belong to the drawing, not to the
  template: a switch does not reset them, recompute them or lose them, and the
  file built after switching back matches the earlier one byte for byte.
* Do not write a static object's move as numbers in place, and do not make it a
  class. The edges it is laid against live in `STATIC_DOC` (`view`, `captionX`)
  - they are expected to become settings - and the move is a `transform`
  attribute on the group around the layers, since the third-party application
  does not read the stylesheet for it. The caption inside `background_elem`
  always carries exactly the opposite move.
* Do not let `STATIC_DOC.view` and `captionX` drift from the markup that also
  holds those numbers, in `STATIC_LAYER_O` and `backgroundElem`. The markup
  stays verbatim, so the golden test holds the two against each other; change
  one and the other has to change with it, or the object will be laid against
  edges that are not where the file draws them.
* Do not keep the alignment being shown in `state.align.saved`. The parameters
  hold what is being built, which while the pointer is on a button is the
  variant it stands for and not the kept one; `saved` is what a press put there
  and what taking the pointer away goes back to. Confusing the two makes hover
  permanent.
* Do not change what is in `STATIC_LAYER_O`. It was copied from the references
  verbatim, self-closing tags and `#Cluster10` on `Cluster1` included - those are
  the files the third-party application reads today, and nothing has tested
  "fixing" the typo.
* Do not let the highlight layers and the injected file disagree about
  `preserveAspectRatio`. The same `viewBox` and the same size are not enough: the
  attribute decides where a box that does not fill its element is put inside it,
  and a difference moves every subject by the same distance, so the drawing ends
  up in one place and everything that answers the pointer in another. The layout
  hands the value out and `renderHighlights` puts it on both layers.
* Do not touch `detect.js` for a file of our own. It answers a different
  question - which shape in a sketch is a silhouette and which is line art -
  and it answers it correctly. A file already in the format is a different job,
  and it lives in `restore.js`.
* Do not rebuild the geometry when reading one of our files: the markup in the
  two defs groups is cut out of the text as it stands. Serialising the parsed
  DOM instead would re-quote attributes and self-close empty tags, and the
  format allows neither; the code fields would also stop showing exactly what
  the user pasted in.
* Do not take markup or behaviour from `src_doc/svg_constructor` - only formulas
  and template strings.
* Do not build the output svg by serialising a live DOM: the old version did
  that and cleaned the result up with a chain of 13 regexes. That is why the
  references hold `x="0.000"` (a `@b_oldsost_x0` typo in its template) and the
  string `undefined`. The file is built as a string now, and both defects were
  fixed deliberately.
* Do not carry list rows with HTML5 drag-and-drop: `draggable` on a row takes
  the pointer away from the code fields, and the window already listens for a
  file being dragged in. Carrying is built on pointer events, and the listeners
  sit on `window` rather than on the row: the moment a row is moved in the DOM it
  loses the pointer capture. The row being carried is taken out of the list
  (`position: fixed`, a child of `body`) and a copy holds its place - which is
  what where it will land is measured against. When comparing with the
  neighbours' midpoints, the ones below the copy have its height subtracted:
  they have already moved a row down, and without that correction the row has to
  be dragged a whole row further than it looks.
* Do not write width thresholds for the settings bar and do not put the list of
  blocks in the code: the order comes from `data-drop` in the markup and the
  decision from measuring. Blocks may be added and reordered, and it has to
  adapt by itself.
* Do not cut anything out of the exported file because the preview hides it: the
  indicator switch and the layer choice set an inline `display` on the groups of
  the **injected copy** (`applyPreviewLayers` in `app.js`), and `state.output`
  stays whole. Groups are matched exactly: `layer_s0_norm` is a state,
  `layer_s0_old_lock_norm` is not. Where a group holds something that is not a
  state of the object - the background elements of a static file - the group
  stays and its own contents are hidden instead, which is the same hiding one
  level further in, not markup being moved or added.
* Do not mix the highlight into the previewed svg: by 6.1 nothing spare may be
  in the file, and what is shown is exactly what is exported. `preview_stage` is
  three layers in one coordinate system - `highlight_back` (the tint),
  `preview_svg` (the file itself) and `highlight_front` (the outline and the hit
  areas). All three carry the same `viewBox`, which `computeLayout` in
  `template.js` hands out. What the preview adds to the file itself is a
  stylesheet rule over the injected copy (the view and the clusters of a static
  object) - a rule changes nothing in the markup and so cannot reach the export.
* The pointer and the four grab bands are preview furniture, like the
  highlight: they live on `highlight_front`, and nothing about them may be
  written into the file. What does belong in the file is the click area itself -
  it is `layer_sN_frame`, which the format has always had.
* Do not make `pointer-events` depend on what is hovered: an element that
  answers the pointer only while something is hovered goes inert the moment the
  pointer reaches it, the element underneath takes the pointer back, and the two
  swap places frame after frame. Anything in the drawing that can be pointed at
  either answers always (the subjects, their shapes, their indicators) or is
  gated on something the pointer cannot change by arriving - the indicators
  switch, or the subject being lit *and* the area carrying its own
  `mouseenter`/`mouseleave`, which is what keeps the border bands still.
* Do not rely on `mouseleave` from elements of the preview: rebuilding the file
  replaces the hit areas under the cursor, and an element taken out of the
  document never reports that the pointer left it. The subject under the cursor
  is therefore also cleared on `mouseleave` of the preview block itself, which
  is never replaced.
* Do not measure geometry with `getBoundingClientRect` on the live DOM: in the
  old version that made the coordinates depend on the size of the window. It is
  computed analytically in `js/geometry.js`, which works in Node too.
* Do not add validation of what is typed, or error highlighting - the user asked
  for neither.
