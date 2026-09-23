# SVG constructor

A web application that turns an svg file exported from a vector editor (Adobe
Illustrator, Figma) into an svg file in the format of the KOMPAKS application.

## What this version does

* picking the object type - «Динамическое обор.» or «Статическое обор.» - at the
  top of the sidebar. It changes only the template the file is built from: the
  drawing itself, the subjects' code, their click areas and their indicator
  positions all stay where they are, so switching back and forth costs nothing.
  Dynamic equipment is chosen to begin with;
* loading an svg file by dragging it into the window or through the «Загрузить
  svg-файл...» button;
* finding the fill and the inner lines of every subject automatically;
* opening a file this application wrote earlier: it is recognised by its own
  structure and read back as it stands, so a file can be saved, reopened and
  carried on with instead of being drawn again. Everything it holds comes back
  with it - the subjects, both line widths, the hatch, the two document
  offsets, the indicator size, and each subject's click area and indicator
  nudges;
* building the new svg from the template and showing it in the preview block;
* showing the fill and inner-line code of every subject in the «Субъекты» list;
* editing that code in the fields: every change rebuilds the svg and refreshes
  the preview beside it;
* adding a subject below the current one and deleting the current one, with the
  layers in the output file renumbered automatically;
* reordering the subjects: `sort_button` reverses the whole list, and a row can
  be carried to a new place with the pointer;
* downloading the new svg with the «Скачать» button and copying its code to the
  clipboard with the button next to it;
* the click area (`layer_sN_frame`, the rectangle KOMPAKS lets the operator
  click on) of every subject: its four borders can be dragged in the preview -
  with Alt for both sides at once, and snapping onto the subject's own edge -
  or typed into the fields above the subject list, and the reset button puts
  them back to the subject's own size. The indicators stay where they are, and
  a click area pulled inside its subject never crops the drawing;
* a triangular cursor at the foot of the selected click area, switched on and
  off on the settings bar, which shows how big the area is against the drawing
  and never reaches the file. It is allowed outside the drawing - a subject at
  the foot of the document would otherwise cut it in half - but nothing is
  added to the document to make room for it, so at the largest zoom it is cut
  off by the edge of the preview instead. Both switches on the bar are the
  whole strip they sit on: the toggle, its label and the space around them
  all answer to a click, and only the size slider keeps its own;
* the five indicators of every subject: click one in the preview and the arrow
  keys move it (10px a press with Shift), or type its X and Y into the fields
  below the click area. The reset button there puts every indicator of every
  subject back into its corner;
* twelve prepared indicator sizes on the slider, 6 to 100px across - the
  diameter is the outer one, with the outline counted in. KOMPAKS does not
  read a `scale`, so each size is its own set of paths rather than one set
  scaled, and all twelve are embedded in `js/indicators.js`.

### Static equipment

The static template (references in `src_doc/examples/static`) differs from the
dynamic one in these ways only:

* the page is a fixed size - `1845 x 800` - and the top and bottom offsets have
  nothing to move, so their block leaves the settings bar while static is
  chosen: the page is not measured from the drawing, the drawing is placed into
  the page;
* `<g id="layer_o">` comes before the subject layers and describes not the
  document's frame but the areas the third-party application replaces with
  objects of its own (`View`, eight clusters, the arrows). The block is the
  same in every such file;
* the object's background - lines, shapes and text - lives in `<defs>` ->
  `<g id="background_elem">`, and is drawn because `layer_s0_background` points
  at it. Without a reference from a subject layer the third-party application
  draws no background at all. A simplified version is written for now: the one
  caption «Источники АЭ»;
* the drawing is moved into the corner of the page - its left edge onto the
  caption and its top edge onto the top of the `View` rectangle, which is the
  point `20 26`. The move is written as a `transform="translate(dx dy)"`
  attribute on the group around the layers, so the whole group can also be moved
  by hand later. The caption sits inside that group and carries exactly the
  opposite move, so it stays where it is however far the object travels.

In the preview, two things are drawn that the file does not draw by itself: the
caption is shown whichever state layer is on show (in the file it belongs to the
background layer, because that is how KOMPAKS is told to draw it), and the areas
KOMPAKS fills in - the view and the eight clusters - are outlined in white.
Neither reaches the exported file.

The space above the object is written as a shift of the group the subject
layers are wrapped in (`transform="translate(0 N)"`, as an attribute - KOMPAKS
does not read the stylesheet for this), not as the origin of the `viewBox`.
The box grows upwards, but its `y` stays the artwork's own top: KOMPAKS
ignores a negative origin, and the space would end up under the object
instead of above it. `layer_o` stays outside that group - its rect describes
the document, not the object being moved inside it.

The indicators, the states and the reserve hatch are all built from the
template - there is no need to look for them in the source file. Fill and stroke
properties of the source are not kept: only its geometry is taken.

## Running it

On Windows, double-click `start.cmd`: it starts the server and opens the app
in the browser. A port can be given as an argument - `start.cmd 8099`; without
one the first free port from 8080 is taken.

The same by hand:

```
node server.mjs
```

The application opens at `http://localhost:8080/`. `index.html` sits in the root
of the repository, so the same set of files is published through GitHub Pages
unchanged.

## Saving the file

In Chrome and Edge the application uses the File System Access API: a reference
to the source file is kept when it is loaded, and on export the system save
dialog opens in the same folder under the same name - «Сохранить» is all that is
needed. The original drawing is never overwritten without confirmation.

Firefox and Safari have no such API, so the file is downloaded to the browser's
downloads folder under the original name.

## Two ways a file is read

Which one is taken is decided by the file, not by the user:

1. **A drawing from an editor** (Illustrator, Figma) goes through the subject
   detection described below. Only the geometry is taken from it: everything
   else - indicators, states, the reserve hatch - is built from the template.
2. **A file this application wrote** is recognised by its own structure
   (`layer_s0_frame`, `layer_s0`, `layer_o`) and read back through the same
   formulas that wrote it: the two line widths from `<style>`, the indicator
   set from `#circle`, the hatch angle and stripe from the gradient, each
   subject's click area from `layer_sN_frame`, each indicator's nudge from the
   `x`/`y` of its `<use>`, and the two document offsets from the `viewBox`
   and the group the layers sit in. Which of the two templates it was built
   from is read from it as well, so a static file comes back static; a static
   page holds no offsets, so those come back at their defaults.
   The geometry is not rebuilt: the markup inside `layer_sN_fill` and
   `layer_sN_stroke_in` is lifted out of the text as it stands, so a file that
   is opened and saved again comes back the way it went in.

The subject detection reads other people's files only, and is never asked about
ours: everything drawable in them lives in `<defs>`, where it would find
nothing to look at.

## How subjects are detected

The strategies in order; the first one that fits wins:

1. **By layer name.** Illustrator escapes names that start with a digit: layer
   `0` is exported as `id="_x30_"`, layer `15` as `_x31_5`, layer `s_10` as
   `s_x5F_10`. The application decodes `_xHH_` and takes the number out of the
   name.
2. **By group.** Every `<g>` that holds shapes is a subject of its own.
3. **By drawing order.** Figma exports a flat list with no groups and no ids:
   the artboard's background rectangle, then pairs of "fill / lines". A new
   subject starts at every shape that has a fill.

The role within a subject is decided by a weighted score: the element's name,
fill and stroke (`fill:none` means lines), how the bounding boxes nest, the
share of open subpaths, fill density and drawing order. Fill density is there
for Figma, which exports strokes as filled "ribbons" - the `fill` attribute
alone cannot tell them apart.

Editors write their layers top to bottom, so strategies 2 and 3 reverse the
order of the subjects.

## Checking it

```
node test/golden.mjs                     # the template against src_doc/examples
node server.mjs 8099 &                   # needed for the check below
node test/e2e.mjs 8099                   # the real app in headless Chrome
```

`test/e2e.mjs` drives the real page over the DevTools protocol: it loads files
through the real file input, checks the layout against the designs (sidebar
width, colours, borders, one 12px font, the `fill`/`str` labels on the field's
baseline), and then the behaviour - editing a field rebuilds the svg, adding and
deleting a subject renumber the layers, and the right edge of the sidebar drags
as a whole and never goes below 360px.

`test/detect.html` and `test/preview.html` are opened in a browser: the first
checks the parsing of all 12 files in `src_doc/files`, the second shows the
result of the build.

How far each reference is matched:

| File | Level |
| --- | --- |
| `PV_3m4v6s_R-RS-S.svg` | complete, byte for byte |
| `PK_3m4v7s_R-R-R.svg` | complete but for s1's indicator coordinates |
| `PG_2m1v2s_S-S.svg`, `Object_1m1v1s.svg` | viewBox, frames, gradient, layer count |
| `CC2_4m7v26s_S-R-S-S.svg` | not used: some frames were edited by hand |
| `static/AE_Separator_8.svg` | what the static template decides for itself: the header, `layer_o`, the order of the blocks and the object's move |

Reading one of our own files back is checked there too: every reference in
`src_doc/examples` is restored, built again and held against itself - the
frames, the indicator coordinates and the `viewBox` come back where the file
has them, and a second pass gives the same file byte for byte. Then the same
thing through the real app: `CC2` is opened with the file input (26 subjects,
Ø32 indicators, a 6px hatch), its click areas and indicator nudges are sitting
in the fields, and a sketch from an editor still goes through the detection.

## Known limits

* **A drawing from an editor always starts on the defaults.** Click areas and
  indicator nudges are read back out of a file this application wrote; a sketch
  has nowhere to keep them, so it begins with every one of them at zero.
* **Subject order often has to be corrected by hand.** In the `AVO_2m4v4s_R-R`
  draft the layer names run the other way round from the reference: the group
  named `3` holds the bottom shape, which the reference calls `s0`. The
  Illustrator and Figma drawings agree with each other, so it was the reference
  that was renumbered. The layer names in the source file are the only thing the
  order is read from, which is why the list can be reversed and its rows carried
  to new places.
* **A static object's background is simplified.** Only the «Источники АЭ»
  caption is written; the lines, arrows and other text that the static
  references carry are neither built nor kept when such a file is read.
* `<text>` is not converted to outlines - text has to be converted to curves in
  the editor before export.
* Clipping (`clip-path`, `mask`) is ignored.
* The «Загрузить» and «Скачать» buttons are strictly the same width, so their
  horizontal padding is 6px rather than the design's 10px - otherwise the label
  does not fit into its half of the row at the sidebar's 360px minimum.
