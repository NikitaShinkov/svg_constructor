# SVG-конструктор — контекст проекта

Файл для передачи контекста в новую сессию. Здесь всё, что не выводится из кода:
зачем проект, какие решения приняты и почему, что проверено и что осталось.

---

## 1. Задача

Есть стороннее ПО — **КОМПАКС** — в которое загружают svg-файлы с изображениями
объектов диагностики. Чтобы объект отображался правильно, svg обязан иметь
жёстко заданную структуру: фиксированные namespace, фиксированный список классов
в `<style>`, геометрия каждого субъекта один раз в `<defs>`, и группы слоёв,
имена и **порядок** которых программа читает, чтобы переключать видимость
(6 состояний × 5 индикаторов на субъект).

Изображение объекта состоит из **субъектов**. У каждого субъекта есть заливка
(силуэт) и внутренние линии, а также набор индикаторов по углам и в центре.

**Рабочий процесс:** художник рисует объект в векторном редакторе (Adobe
Illustrator, Figma), экспортирует обычный svg, загружает его в это приложение и
получает svg по шаблону КОМПАКС, сохраняя его под тем же именем в ту же папку.

Спецификация: `src_doc/Instruction.pdf` (26 страниц, русский).
Текст в PDF закодирован субсет-шрифтами **без ToUnicode**, поэтому обычные
экстракторы выдают мусор. Расшифровывается так: латиница/цифры/пунктуация —
`символ = glyphID + 29`; кириллица — `А..я (U+0410..U+044F) = glyphID − 0x023A + 0x0410`;
у шрифта листингов кода своя таблица (`символ = glyphID − 34`, плюс отдельные
коды для `< > = " / : .`). Ключевые пункты уже перенесены в этот файл и в код,
перечитывать PDF обычно не нужно.

---

## 2. Где что лежит

```
index.html            точка входа (в корне — этого требует GitHub Pages)
css/styles.css
js/geometry.js        разбор путей, матрицы, аналитические bbox (чистый модуль, без DOM)
js/detect.js          поиск субъектов и ролей fill/stroke во входном файле
js/template.js        сборка выходного svg по шаблону КОМПАКС
js/indicators.js      7 наборов индикаторов (20..60 px), вынуты из старых шаблонов
js/app.js             связывание: загрузка → разбор → сборка → предпросмотр → экспорт
assets/icons/         иконки, скопированы из design/icons
server.mjs            локальный статический сервер: node server.mjs [порт]
start.cmd             Windows launcher: server + browser in one click
test/golden.mjs       шаблон против эталонов (Node, без браузера)
test/e2e.mjs          настоящее приложение в headless Chrome через DevTools-протокол
test/detect.html      разбор всех 12 файлов из src_doc/files (открыть в браузере)
test/preview.html     визуальная проверка сборки (открыть в браузере)

design/*.json         макеты Figma (Raw plugin) — ЕДИНСТВЕННЫЙ источник дизайна
src_doc/Instruction.pdf   спецификация формата
src_doc/examples/     6 эталонных выходных файлов
src_doc/files/        12 исходников от художника: по 2 на каждый пример (ai + figma)
src_doc/svg_constructor/  СТАРАЯ версия конструктора — только для справки
```

**Важно:** дизайн берётся из `design/*.json`, **не** из старой версии. Старый
конструктор полезен только как источник шаблонных строк и формул; его вёрстка и
поведение устарели.

**Launching:** `start.cmd` in the repository root replaces `node server.mjs`
typed by hand. It cd-s to its own folder, checks that Node is installed, takes
the first free port in 8080..8099 (or the one passed as an argument), runs the
server in that window and opens `http://localhost:<port>/` from a second,
minimized window that waits for the port to start listening and then closes.
Ctrl+C or closing the window stops the server. That helper window has to be
started through `cmd /c`: `start "" file.cmd` runs the batch under `cmd /K`, so
the window would hang around after the browser opens.

Репозиторий: `https://github.com/NikitaShinkov/svg_constructor`
Живая версия: `https://nikitashinkov.github.io/svg_constructor/`

---

## 3. Решения, согласованные с пользователем

| Тема | Решение |
|---|---|
| Порядок субъектов | По порядку в файле (имена слоёв, если есть). `sort_button` в `head_line` разворачивает список целиком, строку можно перенести мышью на новое место: она едет за курсором, соседи расступаются и отмечают линией `#9393FF` место, куда строка встанет, а номера остаются прежними до отпускания — перенумерация и пересборка файла происходят при отпускании |
| Подсветка субъекта | Строка списка и фигура в предпросмотре подсвечивают друг друга: рамка `#FF00FB` толщиной во внешнюю обводку поверх фигуры и та же рамка заливкой 10 % под ней. Рисуется двумя отдельными слоями над и под предпросмотром — **в выгружаемый файл ничего не добавляется**. Щелчок мимо субъектов — и в предпросмотре, и в пустой части списка — сворачивает все строки |
| Сохранение файла | `showSaveFilePicker` с `startIn` на исходный файл: то же имя, та же папка, пользователь подтверждает. Исходник не перезаписывается молча |
| Параметры генерации | `settings_toolbar` над предпросмотром: размер индикаторов (ползунок по готовым шаблонам), толщина внешней и внутренней линий, угол, толщина и заполнение штриховки, отступы снизу и сверху. Поля показывают число без единиц: пиксели не подписываются нигде — ни здесь, ни в `click_area_settings`, ни в `indicator_position_settings`. Подписаны только `°` и ` %`, и на время правки они прячутся. Принимают только цифры; стрелки меняют на 1, с Shift — на 10 |
| Подписи состояний | В интерфейсе слои называются «Отлично», «ДОП», «ТПМ», «НДП», «Ремонт», «Резерв». Это **только подписи**: слой с подписью «ДОП» — это `norm` (`layer_sN_norm`), и переименовывать его в коде или в файле нельзя |
| Что показывает предпросмотр | Выключатель индикаторов и `layer_selection_block` (6 сегментов состояний) **меняют только предпросмотр**: группы прячутся инлайновым `display` уже во вставленной копии, `state.output` не трогается. По умолчанию выбран `otlichno`. Наведение на сегмент показывает его слой, уход возвращает последний нажатый. Фокус в любом поле штриховки переключает на `background`, потеря фокуса возвращает прежний сегмент. Ползунок размера сам включает выключенные индикаторы: менять размер того, чего не видно, незачем |
| Тесная панель | Панель настроек нарисована под 1920. Когда места не хватает, сначала ужимается ползунок, потом блоки убираются целиком — по возрастанию `data-drop` в разметке (сейчас `offset_settings` 1, `hatching_settings` 2, `lines_settings` 3, `layer_selection_block` 4, `indicators_settings` 5, `cursor_settings` 6). **Пороговых ширин нигде нет:** признак нехватки — `scrollWidth` против `clientWidth`, пересчёт по `ResizeObserver`. Новый блок достаточно дописать в html со своим `data-drop` |
| Масштаб предпросмотра | Колесо мыши над `svg_privew_block`. Максимум — как сейчас, по размеру блока; минимум — 150 px по большей стороне. Хранится не размер, а место в диапазоне (`state.zoom`, 1 — максимум), поэтому при изменении ширины окна оба конца пересчитываются, а уровень остаётся прежним. Масштабируется `transform` всего `preview_stage`, чтобы слои подсветки не разъехались с рисунком |
| Размер индикаторов | Подпись ползунка — «Индикаторы Ø45». По умолчанию 45 px, обводка 3.4 — как во всех файлах `src_doc/examples`. КОМПАКС не читает `scale`, поэтому размеры не масштабируются, а берутся готовыми наборами путей: 20/1.6, 24/2, 28/2.1, 32/2.4, 38/2.9, 45/3.4, 60/4.6 в `js/indicators.js` |
| Picking a subject | A subject is selected by clicking its row, its shape, its click area or any of its indicators, and it is lit while the pointer is on any of those. Hence two hit rectangles per subject in the preview - the click area and the subject's own shape, which part company as soon as a border is moved - and the indicators answer for their subject too. **What answers the pointer must not depend on what is lit:** an area that goes inert under the cursor hands it straight back to what is underneath, and the two then take turns for as long as the pointer is there |
| Click area | `click_area_settings` above the subject list, there only while a subject is selected: four fields (top, right, bottom, left), positive outwards, negative into the subject, and a `reset_button` that puts all four back to 0. This is the real `layer_sN_frame`, so the pink highlight is it; a border stops where the frame would be left thinner than 1px. The indicators do **not** follow it - they belong to the subject and stay on its own rectangle |
| Dragging a border | A 9px grab band on screen whatever the zoom, `ns-resize`/`ew-resize` under the cursor, and the file is rebuilt as the border travels. The bands belong to any lit subject, hovered or selected, and pressing one selects that subject, so a border can be taken hold of straight away. Alt mirrors the border across the middle of the area, so both sides travel together and the centre stays put. Within 3% of the subject's own width or height, a border takes the nearest line worth landing on: its own subject's edge (where the field reads 0), every other subject's shape and click area, and the four edges of the document. The line it is on is drawn right across the document, 1px in `#FF00FB` whatever the zoom, and goes as soon as the border leaves its reach; when the line is another subject's click area, that subject lights up as though the pointer were on it. The lines are worked out once, when the border is picked up - the document grows as a border travels, and a line that moved with it would be something to chase rather than to land on - and where two fall together (a click area and the shape inside it) the click area is the one kept, because it is the one that lights up. A typed number is left as typed. A border in hand owns the pointer until it is let go: no other subject lights up as it is carried over them, and the cursor stays the resize one (`cursor: inherit !important` on everything, because the hit areas under it carry cursors of their own and say so more specifically). What is under the pointer when it is let go is asked for with `elementFromPoint`, since resting on something is not an event |
| Indicator positions | `indicator_position_settings` under the click area block, for the selected subject: an X and a Y field per indicator, in the same three columns (old_repair over old_sost, insert, old_lock over fail). Clicking an indicator in the drawing picks it out - which shows on its pair of fields, outlined in `--accent`, and nowhere in the drawing itself - and the arrow keys then move it, 1px a press and 10 with Shift. Every indicator on show can be clicked, on any subject, selected or not; being switched off on the toolbar is the one thing that takes their hit areas away. It is put down by Esc or by a click anywhere but itself (a listener on the way in, since the drawing stops its clicks on the way out). The offsets are part of the file: they are the `x`/`y` of the `<use>`. Its `reset_button` is the one control that reaches past the selected subject: indicators are nudged a fileful at a time, so it puts every indicator of every subject back |
| Offsets | `offset_settings` on the bar, after the hatching: the empty space under the object (70px, which the format has always had) and as much above it as is asked for. Both are part of the document - the viewBox grows and its y moves up - and the file is rebuilt as they are typed. While one of the two fields has the focus, its strip is lit the way a selected subject is and the edge of the whole document is drawn round it in a `#FF00FB` dash-dot (`non-scaling-stroke`, stroked at double width so the outer half is clipped away). An offset is about the document, not about a subject, so reaching for one of these fields puts down whatever subject and indicator were picked; letting go of the field takes the lighting away and leaves the offset |
| Cursor | A triangle to the proportions of `design/icons/pointer.svg`, drawn on the highlight layer at the foot of the selected subject's click area: a third of the average subject's width, 0.8 of that in height, its tip a third of its own height inside the bottom border. The switch in `cursor_settings` (before `indicators_settings`, `data-drop="6"`) changes the preview only |
| Объём | Не переносить функциональность старого конструктора, пока не попросят |
| Язык интерфейса | Русский |
| Language of everything else | English: README, CLAUDE.md, code comments, console output. Only the app interface and its strings stay Russian |
| Шрифт | Inter 12 px — везде, единственный размер и начертание |
| Проверка ввода | **Нет никакой.** Что пользователь ввёл в поле, то и попадает в файл |
| Первый экран | Пока ни в одном поле ничего нет: в списке один раскрытый `s0`, залитый `upload_button`, `download_button` и `copy_button` скрыты, вместо предпросмотра — зона перетаскивания, панель настроек тоже спрятана (настраивать нечего). Как только в поле появляется текст (или загружается файл), экран становится обычным |
| Удаление субъекта | Последний субъект удалить нельзя: при единственной строке `delete_sub_button` не рисуется вовсе |

**Ограничение браузера:** сохранение в исходную папку работает только в Chrome и
Edge (File System Access API). В Firefox и Safari файл скачивается в папку
загрузок под тем же именем. Никакой веб-API не позволяет иначе.

---

## 4. Формат выходного файла

Порядок тегов обязателен (Instruction.pdf 6.2):

1. `<svg>` ровно с `xmlns`, `xmlns:xlink`, `xmlns:inkscape`, `viewBox`, `width`, `height`
2. `<style type="text/css">` — фиксированный список классов
3. `<defs>`:
   - `<linearGradient id="linear_grad">` — штриховка состояния «Резерв»
   - на каждый субъект, по возрастанию индекса, с комментарием `<!--sN-->`:
     `layer_sN_frame` (`<rect>`), `layer_sN_fill`, `layer_sN_stroke_in` — **только `id`**,
     без `inkscape:label` и без `style`
   - `<!--indicators-->` — библиотека символов `#circle #fail #old_repair
     #old_lock_icon #old_lock_norm #old_lock_tpm #old_lock_ndp #insert`
4. `<g id="layer_sN" inkscape:label="layer_sN" style="display:inline">` для N = 0..n−1,
   ровно с такими детьми и в таком порядке:
   `_background` → `_sost` (otlichno, norm, tpm, ndp, repair) → `_fail` →
   `_old_sost` → `_old_repair` → `_old_lock` → `_insert`
5. `<g id="layer_o">` с пустыми `_background_off` / `_background_on` и `<rect>` на весь viewBox

Обязательные правила:

* каждая группа от `layer_sN` и ниже несёт `id` + такой же `inkscape:label` + `style="display:inline"`;
* внутренние линии **чёрные** (`st_in st_b`) только для `norm` и `tpm`, во всех остальных белые (`st_in st_w`);
* индикаторы позиционируются атрибутами `x`/`y` у `<use>`, **никогда** не `transform`;
* `width` и `height` равны ширине и высоте `viewBox`;
* к высоте `viewBox` прибавляется **+70 px** снизу (`bottomPadding`), к ширине — ничего. Сверху по умолчанию не прибавляется ничего (`topPadding` = 0), но оба отступа правятся на панели, и тогда `viewBox` растёт, а его `y` уходит вверх;
* самозакрывающихся тегов нет: `<use ...></use>`;
* числа `.toFixed(2)`; концы градиента `.toFixed(0)`; смещения стопов `.toFixed(2) + "%"`;
* по п. 6.1 в файле **не допускается ничего**, чего нет в спецификации.

### Геометрия

Рамка субъекта считается **только по заливке** (не по объединению с линиями),
и расширяется на толщину внешней обводки:

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

Проверено точным расчётом bbox по кубическим кривым: PG s0 `(1,1,220,250)` → `(0,0,222,252)`,
PG s1 `(227,1,126,250)` → `(226,0,128,252)`, Object s0 `(1,1,170,250)` → `(0,0,172,252)` —
совпадает с эталонами до цифры.

При `D = 45 × scale`:

| группа | угол | x | y |
|---|---|---|---|
| `_old_repair` | верх-лево | `x` | `y` |
| `_old_lock` | верх-право | `x + w − D` | `y` |
| `_old_sost` | низ-лево | `x` | `y + h − D` |
| `_fail` | низ-право | `x + w − D` | `y + h − D` |
| `_insert` | центр | `x + w/2 − D/2` | `y + h/2 − D/2` |

`viewBox` = объединение рамок, расширенное отступами: `y = minY − topPadding`,
высота `= objH + topPadding + bottomPadding`. Градиент считается по размеру
объекта **до** отступов.

### Штриховка

Порт `get_bg_pos` / `generateStripeStops` из старого `scripts.js`.
При `0 < угол < 90`: `y2 = h + (w − h/tan θ)·sin θ·cos θ`, `x2 = tan θ·(y2 − h)`,
`x1 = w`, `y1 = 0`, `L = y2/sin θ`. Полоса: `run = lineWidth`,
`gap = lineWidth·(100/coverage − 1)`. Отрицательный `x2` — это нормально.
Сверено с эталонами: Object → `x1=172 x2=−40 y2=212`, `L=299.81`, **92 стопа**;
PG → `x1=354 x2=51 y2=303`, `L=428.51`, **130 стопов**.

Наборы индикаторов скопированы дословно из
`src_doc/svg_constructor/scripts for different indicators sizes/` (по папке на размер)
в `js/indicators.js`; набор 45/3.4 побайтово совпадает с эталонами.

---

## 5. Как распознаются субъекты

Три стратегии, побеждает первая подходящая:

1. **По именам слоёв.** Illustrator экранирует имена, начинающиеся с цифры:
   слой `0` → `id="_x30_"`, `15` → `_x31_5`, `s_10` → `s_x5F_10`.
   Приложение раскодирует `_xHH_` и достаёт номер.
2. **По группам.** Каждая `<g>` с фигурами — субъект.
3. **По порядку фигур.** Figma выгружает плоский список без групп и без id:
   прямоугольник артборда, затем пары «заливка / линии».

Редакторы пишут слои сверху вниз, поэтому при стратегиях 2 и 3 порядок
разворачивается.

Роль внутри субъекта — взвешенная сумма: имя элемента (6.0), вложенность
рамок (5.0), заливка и обводка (4.0), «эффективная толщина» (4.0), имена
предков (3.0), доля незамкнутых подконтуров (3.0), плотность заливки (2.5),
порядок отрисовки (1.5).

**Почему не хватает одного атрибута `fill`:** Figma выгружает обводки как
залитые «ленты» с `fill` и без `stroke`, да ещё и с именами вида `Vector 2`.
Различает их только геометрия: у ленты толщиной `t` площадь ≈ `длина·t/2`,
то есть относительная толщина 0.01–0.04 против 0.15–0.5 у силуэта.

Заливка в Illustrator приходит из внутреннего `<style>` (`.st0 { fill: ... }`),
поэтому чтение атрибутов не годится: файл монтируется в shadow root и читается
через `getComputedStyle`. Shadow root нужен, чтобы классы `.st0`/`.st1` из
чужого файла не протекли в стили приложения.

---

## 6. Как проверять

```
node test/golden.mjs            # шаблон против эталонов, браузер не нужен
node server.mjs 8080 &
node test/e2e.mjs 8080          # настоящее приложение в headless Chrome
```

`test/e2e.mjs` управляет страницей через DevTools-протокол: грузит файлы через
реальное поле выбора, проверяет вёрстку (ширина панели, цвета, границы, один
шрифт, подписи по базовой линии, равная ширина кнопок, скроллбар 4 px) и
поведение (редактирование пересобирает svg, добавление, удаление и перенос
строки мышью перенумеровывают слои, правый край панели тянется и не уходит ниже
360 px, первый экран и экран перетаскивания собраны по макету и уходят, как
только в поле появляется код, панель настроек меняет файл и предпросмотр по
отдельности, колесо мыши масштабирует предпросмотр в своих пределах).

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
to subject, hidden indicators answer to nothing, and the reset button puts every
indicator of every subject back.

The offsets have a handful of checks of their own, run at 1920 because the block
is the first the bar gives up: the bottom field starts at the 70 the format has,
reaching for a field lights its strip and the edge of the document and puts down
whatever was picked, typing grows the document without moving the artwork, and
letting go leaves the offset but not the lighting.

Окно браузера в тесте — 1600×900: панель настроек нарисована под 1920, и в узком
окне её элементы обрезаются, а клики по ним попадают в сегменты слоёв. Проверки,
которым нужна другая ширина, ставят её через `Emulation.setDeviceMetricsOverride`
и снимают за собой. **Ширины в ожиданиях не зашиты:** панель проверяется
протяжкой от 1800 к 400 px на инвариантах (ничего не обрезано, видимые блоки —
всегда хвост порядка `data-drop`, сужение блоков не возвращает), а масштаб — на
сохранении места в диапазоне, а не размера.
`app.js` в конце ставит `document.body.dataset.ready`, чтобы тест дожидался
загрузки модуля, а не угадывал задержку, и `document.body.dataset.loaded` после
разбора файла — по числу строк в списке файл теперь не отличить от первого
экрана, там уже есть пустой `s0`.

Состояние эталонов:

| Файл | Уровень совпадения |
| --- | --- |
| `PV_3m4v6s_R-RS-S.svg` | полное, побайтово (6 субъектов) |
| `PK_3m4v7s_R-R-R.svg` | полное, кроме координат индикаторов s1 |
| `PG_2m1v2s_S-S.svg`, `Object_1m1v1s.svg` | viewBox, рамки, градиент, число слоёв |
| `CC2_4m7v26s_S-R-S-S.svg` | **не использовать**: часть рамок правилась вручную (`x="139"`, `width="57"`) |

Инвариант: число `inkscape:label` = `20 × число субъектов + 4`.

---

## 7. Известные ограничения и что делать дальше

1. **Offsets are set by hand, never read.** Indicators can now be nudged one by
   one, which is what the `PG`, `CC2` and `Object` references did, but a file
   arriving from the editor always starts with every offset at 0: nothing reads
   the positions back out of an existing KOMPAKS file. Rebuilding one of those
   references means moving its indicators again by hand.
2. **Наборы индикаторов временные.** В `js/indicators.js` лежат семь наборов из
   старого конструктора (20…60 px) — пользователь сказал, что настоящие шаблоны
   подготовит позже. Заменяются целиком: формат таблицы (`strokeWidth` + `icons`)
   менять не нужно, список размеров подхватится из ключей.
3. **Порядок субъектов правится вручную — и это нужно.** В черновике
   `AVO_2m4v4s_R-R` имена слоёв идут в обратную сторону относительно эталона:
   группа с именем `3` содержит нижнюю фигуру, которую эталон называет `s0`.
   Файлы из Illustrator и Figma согласуются друг с другом — значит, перенумерован
   был эталон. Отсюда `sort_button` (развернуть весь список) и перенос строки
   мышью (поправить одну).
4. `<text>` не переводится в контуры (нужны метрики шрифта) — текст надо
   переводить в кривые до экспорта.
5. Обрезка (`clip-path`, `mask`) игнорируется.
6. Кнопки `upload_button` и `download_button` строго одинаковой ширины
   (`flex: 1 1 0`). При панели 360 px половина строки — 145.5 px, а подписи
   «Загрузить svg-файл...» при дизайнерских отступах 10 px нужно 149.3 px,
   поэтому у этих двух кнопок отступы 6 px вместо 10. У `copy_button`
   остались дизайнерские 10 px.

---

## 8. Чего не делать

* Не брать вёрстку и поведение из `src_doc/svg_constructor` — только формулы и
  шаблонные строки.
* Не собирать выходной svg через сериализацию живого DOM: старая версия так
  делала и вычищала результат цепочкой из 13 регулярок. Из-за этого в эталонах
  живут `x="0.000"` (опечатка `@b_oldsost_x0` в шаблоне) и строка `undefined`.
  Сейчас файл собирается строкой, и оба дефекта исправлены намеренно.
* Не переносить строки списка через HTML5 drag-and-drop: `draggable` на строке
  отбирает указатель у полей с кодом, а окно уже слушает перетаскивание файла.
  Перенос сделан на pointer-событиях, и слушатели висят на `window`, а не на
  строке: как только строку двигают в DOM, она теряет захват указателя.
  Взятая строка вынимается из списка (`position: fixed`, ребёнок `body`), а её
  место держит копия — по ней и считается, куда строка встанет. При сравнении с
  серединами соседей у тех, кто ниже копии, вычитается её высота: они уже
  сдвинуты на строку вниз, и без этой поправки строку приходится протаскивать
  на целую строку дальше, чем кажется.
* Не прописывать ширины-пороги для панели настроек и не задавать список блоков
  в коде: порядок берётся из `data-drop` в разметке, а решение — из измерения.
  Блоки могут добавляться и меняться местами, и подстраиваться должно само.
* Не вырезать из выгружаемого файла ничего, что спрятано в предпросмотре:
  выключатель индикаторов и выбор слоя ставят инлайновый `display` на группы
  **вставленной копии** (`applyPreviewLayers` в `app.js`), а `state.output`
  остаётся полным. Группы ищутся точным совпадением: `layer_s0_norm` — это
  состояние, а `layer_s0_old_lock_norm` — уже нет.
* Не подмешивать подсветку в предпросматриваемый svg: по п. 6.1 в файле не
  допускается ничего лишнего, а показывается ровно то, что выгружается.
  `preview_stage` состоит из трёх слоёв в одной системе координат —
  `highlight_back` (заливка), `preview_svg` (сам файл), `highlight_front`
  (рамка и области наведения). `viewBox` у всех трёх один и тот же, его отдаёт
  `computeLayout` из `template.js`.
* The pointer and the four grab bands are preview furniture, like the
  highlight: they live on `highlight_front`, and nothing about them may be
  written into the file. What does belong in the file is the click area itself -
  it is `layer_sN_frame`, which the format has always had.
* Не ставить `pointer-events` в зависимость от наведения: an element that
  answers the pointer only while something is hovered goes inert the moment the
  pointer reaches it, the element underneath takes the pointer back, and the two
  swap places frame after frame. Anything in the drawing that can be pointed at
  either answers always (the subjects, their shapes, their indicators) or is
  gated on something the pointer cannot change by arriving - the indicators
  switch, or the subject being lit *and* the area carrying its own
  `mouseenter`/`mouseleave`, which is what keeps the border bands still.
* Не полагаться на `mouseleave` от элементов предпросмотра: rebuilding the file
  replaces the hit areas under the cursor, and an element taken out of the
  document never reports that the pointer left it. The subject under the cursor
  is therefore also cleared on `mouseleave` of the preview block itself, which
  is never replaced.
* Не измерять геометрию через `getBoundingClientRect` живого DOM: в старой
  версии из-за этого координаты зависели от размера окна. Считается аналитически
  в `js/geometry.js`, работает и в Node.
* Не добавлять проверок вводимого текста и подсветки ошибок — пользователь
  просил этого не делать.
