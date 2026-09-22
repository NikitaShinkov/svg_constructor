# SVG-конструктор

Веб-приложение, которое превращает svg-файл, экспортированный из векторного
редактора (Adobe Illustrator, Figma), в svg-файл по шаблону ПО КОМПАКС.

## Что умеет эта версия

* загрузка svg-файла перетаскиванием в окно или через кнопку «Загрузить svg-файл...»;
* автоматический поиск заливки и внутренних линий для всех субъектов;
* opening a file this application wrote earlier: it is recognised by its own
  structure and read back as it stands, so a file can be saved, reopened and
  carried on with instead of being drawn again. Everything it holds comes back
  with it - the subjects, both line widths, the hatch, the two document
  offsets, the indicator size, and each subject's click area and indicator
  nudges;
* построение нового svg по шаблону и его отображение в блоке предпросмотра;
* вывод кода заливки и внутренних линий каждого субъекта в списке «Субъекты»;
* редактирование кода в полях: после каждого изменения svg пересобирается,
  и предпросмотр справа обновляется;
* добавление субъекта под текущим и удаление текущего с автоматической
  перенумерацией слоёв в итоговом файле;
* скачивание нового svg-файла по кнопке «Скачать» и копирование его кода
  в буфер обмена по кнопке рядом;
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

The space above the object is written as a shift of the group the subject
layers are wrapped in (`transform="translate(0 N)"`, as an attribute - KOMPAKS
does not read the stylesheet for this), not as the origin of the `viewBox`.
The box grows upwards, but its `y` stays the artwork's own top: KOMPAKS
ignores a negative origin, and the space would end up under the object
instead of above it. `layer_o` stays outside that group - its rect describes
the document, not the object being moved inside it.

Индикаторы, состояния и штриховка резерва генерируются по шаблону — искать их
в исходном файле не нужно. Свойства заливки и обводки из исходного файла не
сохраняются: из него берётся только геометрия.

## Запуск

On Windows, double-click `start.cmd`: it starts the server and opens the app
in the browser. A port can be given as an argument — `start.cmd 8099`; without
one the first free port from 8080 is taken.

The same by hand:

```
node server.mjs
```

Приложение откроется по адресу `http://localhost:8080/`.
Файл `index.html` лежит в корне репозитория, поэтому тот же набор файлов
публикуется через GitHub Pages без изменений.

## Сохранение файла

В Chrome и Edge приложение использует File System Access API: при загрузке
запоминается ссылка на исходный файл, и при экспорте системное окно сохранения
открывается в той же папке с тем же именем — достаточно нажать «Сохранить».
Исходный рисунок не перезаписывается без подтверждения.

В Firefox и Safari такого API нет, поэтому файл скачивается в папку загрузок
браузера под исходным именем.

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
   and the group the layers sit in.
   The geometry is not rebuilt: the markup inside `layer_sN_fill` and
   `layer_sN_stroke_in` is lifted out of the text as it stands, so a file that
   is opened and saved again comes back the way it went in.

The subject detection reads other people's files only, and is never asked about
ours: everything drawable in them lives in `<defs>`, where it would find
nothing to look at.

## Как определяются субъекты

Порядок стратегий, первая подходящая выигрывает:

1. **По именам слоёв.** Illustrator экранирует имена, начинающиеся с цифры:
   слой `0` выгружается как `id="_x30_"`, слой `15` — как `_x31_5`, слой `s_10` —
   как `s_x5F_10`. Приложение раскодирует `_xHH_` и достаёт из имени номер.
2. **По группам.** Каждая группа `<g>`, содержащая фигуры, — отдельный субъект.
3. **По порядку фигур.** Figma выгружает плоский список без групп и без id:
   фоновый прямоугольник артборда, затем пары «заливка / линии». Новый субъект
   начинается с каждой фигуры, у которой есть заливка.

Роль внутри субъекта определяется взвешенной оценкой: имя элемента, заливка и
обводка (`fill:none` — это линии), вложенность рамок, доля незамкнутых
подконтуров, плотность заливки и порядок отрисовки. Плотность заливки нужна для
Figma: она выгружает обводки как залитые «ленты», поэтому по одному только
атрибуту `fill` их не отличить.

Редакторы записывают слои сверху вниз, поэтому при стратегиях 2 и 3 порядок
субъектов разворачивается.

## Проверка

```
node test/golden.mjs                     # шаблон против эталонов src_doc/examples
node server.mjs 8099 &                   # нужен для двух проверок ниже
node test/e2e.mjs 8099                   # реальное приложение в headless Chrome
```

`test/e2e.mjs` управляет настоящей страницей через DevTools-протокол: грузит
файлы через реальное поле выбора, проверяет вёрстку по макетам (ширина панели,
цвета, границы, один шрифт 12 px, подписи `fill`/`str` по базовой линии поля),
а затем поведение — редактирование поля пересобирает svg, добавление и удаление
субъекта перенумеровывают слои, правый край панели тянется целиком и не уходит
меньше 360 px.

`test/detect.html` и `test/preview.html` открываются в браузере: первая
проверяет разбор всех 12 файлов из `src_doc/files`, вторая показывает
результат построения.

Состояние эталонов:

| Файл | Уровень совпадения |
| --- | --- |
| `PV_3m4v6s_R-RS-S.svg` | полное, побайтово |
| `PK_3m4v7s_R-R-R.svg` | полное, кроме координат индикаторов s1 |
| `PG_2m1v2s_S-S.svg`, `Object_1m1v1s.svg` | viewBox, рамки, градиент, число слоёв |
| `CC2_4m7v26s_S-R-S-S.svg` | не используется: часть рамок правилась вручную |

Reading one of our own files back is checked there too: every reference in
`src_doc/examples` is restored, built again and held against itself - the
frames, the indicator coordinates and the `viewBox` come back where the file
has them, and a second pass gives the same file byte for byte. Then the same
thing through the real app: `CC2` is opened with the file input (26 subjects,
Ø32 indicators, a 6px hatch), its click areas and indicator nudges are sitting
in the fields, and a sketch from an editor still goes through the detection.

## Известные ограничения

* **A drawing from an editor always starts on the defaults.** Click areas and
  indicator nudges are read back out of a file this application wrote; a sketch
  has nowhere to keep them, so it begins with every one of them at zero.
* **Порядок субъектов не редактируется.** В черновике `AVO_2m4v4s_R-R` имена
  слоёв идут в обратную сторону относительно эталона: группа с именем `3`
  содержит нижнюю фигуру, которую эталон называет `s0`. Чертежи из Illustrator и
  Figma согласуются друг с другом, то есть перенумерован был эталон. Пока имена
  слоёв в исходном файле — единственный источник порядка.
* `<text>` не переводится в контуры — текст нужно преобразовать в кривые в
  редакторе до экспорта.
* Обрезка (`clip-path`, `mask`) игнорируется.
* Кнопки «Загрузить» и «Скачать» строго одинаковой ширины, поэтому у них
  горизонтальные отступы 6 px вместо дизайнерских 10 px — иначе при минимальной
  ширине панели 360 px подпись не помещается в свою половину строки.
