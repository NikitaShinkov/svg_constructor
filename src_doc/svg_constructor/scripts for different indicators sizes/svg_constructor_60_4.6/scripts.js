document.addEventListener("DOMContentLoaded", function() {
    let block = document.getElementById('block');
    let svg_parameters_block = document.getElementById('svg_parameters');
    let createButton = document.getElementById('create-btn');
    let copyButton = document.getElementById('copy-btn');
    let container = document.getElementById('container');
    let textArea = document.getElementsByTagName('textarea');
    let sub_list = document.getElementById('sub_list');
    let sub_list_svg = [];

    let indicator_diameter = 60;
    let indicator_st_out_width = 4.6;

    let bg_line_angle = Number(document.getElementsByClassName('bg_hatch_line_angle')[0].value);
    let bg_line_width = Number(document.getElementsByClassName('bg_hatch_line_width')[0].value);
    let bg_line_percent = Number(document.getElementsByClassName('bg_hatch_line_percent')[0].value);
    let bg_line_lenght;


    let st_in_width = Number(document.getElementsByClassName('st_in_width')[0].value);
    let st_out_width = Number(document.getElementsByClassName('st_out_width')[0].value);
    let indicator_scale = document.getElementsByClassName('indicator_scale')[0].value/100;

    indicator_scale_input = document.getElementsByClassName('indicator_scale')[0];
    switch_off = svg_parameters_block.getElementsByClassName('ind_off')[0];
    switch_on = svg_parameters_block.getElementsByClassName('ind_on')[0];

    let sub_item_row = document.getElementsByClassName('sub_item_row');
    let sub_item = document.getElementsByClassName('sub_item');
    let del_btn = document.getElementsByClassName('delete_row');

    let selected_layer_option = document.getElementsByClassName('layer_block_active')[0];

    let org_block_height = block.getBoundingClientRect().height;
    let org_block_margin = Number(getComputedStyle(block).margin.replace(/px/gi,''));

    //элементы и параметры границы между блоками параметров и изображения svg (parameters_block_border_width должен быть равен ширине границе – псевдоэлемента #parameters_block::after)
    let parameters_block_border_width = 8;
    let parameters_block = document.getElementById("parameters_block");
    let m_pos;

    //дополнительный отступ в нижней части изображения
    let add_down_space = 70;

    

    let svg_1_styles =
`<svg
xmlns="http://www.w3.org/2000/svg"
xmlns:xlink="http://www.w3.org/1999/xlink"
xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
viewBox="@x @y @w @h"
width="@w" height="@h"
style="width: 100%; height: 100%">  
    <style type="text/css">
        <!-- subject click area -->
        .frame {fill:none}
        <!-- subject background hatch fill -->
        .bg_1 {stop-color:#808080}
        .bg_2 {stop-color:#FFFFFF; stop-opacity:0;}
        .bg_grad {fill:url(#linear_grad)}
        <!-- subject inner line -->
        .st_in {fill:none;stroke-width:@sinw;stroke-miterlimit:10}
        <!-- subject inner line white -->
        .st_w {stroke:#FFFFFF}
        <!-- subject inner line black -->
        .st_b {stroke:#000000}
        <!-- subject outer line -->
        .st_out {fill:none;stroke:white;stroke-width:@sow;stroke-miterlimit:10}
        <!-- subject sost fill-->
        .otlichno {fill:#049B4E}
        .norm {fill:#00FF00}
        .tpm {fill:#FFF200}
        .ndp {fill:#FF0000}
        .repair {fill:#7F4124}
        <!-- indicator outer line -->
        .icons_st_out {stroke:white;stroke-width:@isow;stroke-miterlimit:10}
        <!-- indicator icon fill white -->
        .icon_w {fill:#FFFFFF}
        <!-- indicator icon fill black -->
        .icon_b {fill:#000000}
        <!-- indicator fail fill -->
        .fail {fill:#4B4392}
        <!-- indicator insert fill -->
        .insert {fill:#143D8F}
        <!-- indicator scale -->
        .scale {transform:scale(@scale)}<!-- selection outer line -->.st_selected {fill:#FF00EE;fill-opacity:0.2;stroke:#FF00EE;stroke-width:@sow;stroke-miterlimit:10}
    </style>

    <defs>
        <!--gradient-->
        <linearGradient id="linear_grad" x1="@bg_pos_x_1" x2="@bg_pos_x_2" y1="@bg_pos_y_1" y2="@bg_pos_y_2" gradientUnits="userSpaceOnUse">
@linear_grad_stops
        </linearGradient>

        `;
    let svg_2_1_frame =
        `<!--snum-->
        <g id="layer_snum_frame">
            <rect
                width="@fw"
                height="@fh"
                x="@fx"
                y="@fy"/>
        </g>
        
        `
    let svg_2_2_fill =
        `<g id="layer_snum_fill">
            `

    let svg_2_3_stroke_in =
        `<g id="layer_snum_stroke_in">
            `
    
    let svg_2_endgroup =
        `   
        </g>
        
        `
        
    let svg_3_icons =
        `<!--indicators-->
        <g id="circle" class="scale">
            <circle cx="30" cy="30" r="27.7" class="icons_st_out"/>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"/>
            <path class="icon_w scale" d="M24.42,45.75c0-3.27,2.17-5.51,5.54-5.51,3.16,0,5.33,2.24,5.33,5.51,0,3.07-2.17,5.51-5.33,5.51-3.37,0-5.54-2.44-5.54-5.51ZM26.4,37.16h0l-1.39-27.57h9.67l-1.39,27.57h-6.9Z"/>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"/>
            <path class="icon_w scale" d="M39.16,31.18l-8.14-1.73-1.67-7.98,8.34-8.2c-1.24-.22-2.29-.43-3.54-.65-7.72,0-15.01,7.34-15.01,15.09,0,1.73.42,3.24.84,4.75l-13.17,12.68c2.41,3.69,5.68,6.77,9.53,8.95l13.02-12.78.21-.21c1.05.21,2.09.43,3.34.43,7.72,0,15.01-7.34,15.01-15.09.22-1.1,0-2.17-.42-3.47l-8.33,8.2Z"/>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M16.24,14.34v30.7h29.42l-.02,2.34H13.88V14.3l2.35.04ZM36.31,25.51c-.7,8.91-9.21,14.91-18.15,13.47v4.62c11.58,1.42,21.56-6.64,22.53-17.54,2.07.29,3.05.45,5.42.78l-2.91-7.1-2.91-7.12-4.7,6.09-4.7,6.07c2.42.34,2.98.41,5.42.74h0Z"/>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"/>
            <use xlink:href="#old_lock_icon" class="icon_b"/>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"/>
            <use xlink:href="#old_lock_icon" class="icon_b"/>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"/>
            <use xlink:href="#old_lock_icon" class="icon_w"/>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"/>
            <path class="icon_w scale" d="M30.57,30l-15.21,12.1v-24.21l15.21,12.1ZM48,30l-15.22,12.1v-24.21l15.22,12.1Z"/>
        </g>
    </defs>

    `;

    let svg_4_snum_block =
    `<g id="layer_snum"
        inkscape:label="layer_snum" style="display:inline">
        <g id="layer_snum_background"
        inkscape:label="layer_snum_background" style="display:inline">
            <use id="Subjectnum" xlink:href="#layer_snum_frame" class="frame"/>
            <use xlink:href="#layer_snum_fill" class="bg_grad"/>
            <use xlink:href="#layer_snum_stroke_in" class="st_in st_w"/>
            <use xlink:href="#layer_snum_fill" class="st_out"/>
        </g>

        <g id="layer_snum_sost"
        inkscape:label="layer_snum_sost" style="display:inline">
            <g id="layer_snum_otlichno"
                inkscape:label="layer_snum_otlichno" style="display:inline">
                <use xlink:href="#layer_snum_fill" class="otlichno"/>
                <use xlink:href="#layer_snum_stroke_in" class="st_in st_w"/>
                <use xlink:href="#layer_snum_fill" class="st_out"/>
            </g>
            <g id="layer_snum_norm"
                inkscape:label="layer_snum_norm" style="display:inline">
                <use xlink:href="#layer_snum_fill" class="norm"/>
                <use xlink:href="#layer_snum_stroke_in" class="st_in st_b"/>
                <use xlink:href="#layer_snum_fill" class="st_out"/>
            </g>
            <g id="layer_snum_tpm"
                inkscape:label="layer_snum_tpm" style="display:inline">
                <use xlink:href="#layer_snum_fill" class="tpm"/>
                <use xlink:href="#layer_snum_stroke_in" class="st_in st_b"/>
                <use xlink:href="#layer_snum_fill" class="st_out"/>
            </g>
            <g id="layer_snum_ndp"
                inkscape:label="layer_snum_ndp" style="display:inline">
                <use xlink:href="#layer_snum_fill" class="ndp"/>
                <use xlink:href="#layer_snum_stroke_in" class="st_in st_w"/>
                <use xlink:href="#layer_snum_fill" class="st_out"/>
            </g>
            <g id="layer_snum_repair"
                inkscape:label="layer_snum_repair" style="display:inline">
                <use xlink:href="#layer_snum_fill" class="repair"/>
                <use xlink:href="#layer_snum_stroke_in" class="st_in st_w"/>
                <use xlink:href="#layer_snum_fill" class="st_out"/>
            </g><g><use xlink:href="#layer_snum_fill" class="st_selected elem_hidden"/></g>
        </g>
    </g>

    `;

    let svg_4_1_snum_icons_fail =
    `
        <g id="layer_snum_fail"
            inkscape:label="layer_snum_fail" style="display:inline">
            <use xlink:href="#fail" x="@b_fail_x" y="@b_fail_y"/>
        </g>
        
        `;

    let svg_4_2_snum_icons_old_sost =
        `<g id="layer_snum_old_sost"
            inkscape:label="layer_snum_old_sost" style="display:inline">
            <g id="layer_snum_old_otlichno"
                inkscape:label="layer_snum_old_otlichno" style="display:inline">
                <use xlink:href="#circle" class="otlichno" x="@b_oldsost_x" y="@b_oldsost_y"/>
            </g>
            <g id="layer_snum_old_norm"
                inkscape:label="layer_snum_old_norm" style="display:inline">
                <use xlink:href="#circle" class="norm" x="@b_oldsost_x0" y="@b_oldsost_y"/>
            </g>
            <g id="layer_snum_old_tpm"
                inkscape:label="layer_snum_old_tpm" style="display:inline">
                <use xlink:href="#circle" class="tpm" x="@b_oldsost_x" y="@b_oldsost_y"/>
            </g>
            <g id="layer_snum_old_ndp"
                inkscape:label="layer_snum_old_ndp" style="display:inline">
                <use xlink:href="#circle" class="ndp" x="@b_oldsost_x" y="@b_oldsost_y"/>
            </g>
        </g>
        
        `;
    
    let svg_4_3_snum_icons_old_repair =
        `<g id="layer_snum_old_repair"
            inkscape:label="layer_snum_old_repair" style="display:inline">
            <use xlink:href="#old_repair" x="@b_repair_x" y="@b_repair_y"/>
        </g>
        
        `;

    let svg_4_4_snum_icons_old_lock =
        `<g id="layer_snum_old_lock"
           inkscape:label="layer_snum_old_lock" style="display:inline">
           <g id="layer_snum_old_lock_norm"
               inkscape:label="layer_snum_old_lock_norm" style="display:inline">
               <use xlink:href="#old_lock_norm" x="@b_oldlock_x" y="@b_oldlock_y"/>
           </g>
           <g id="layer_snum_old_lock_tpm"
               inkscape:label="layer_snum_old_lock_tpm" style="display:inline">
               <use xlink:href="#old_lock_tpm" x="@b_oldlock_x" y="@b_oldlock_y"/>
           </g>
           <g id="layer_snum_old_lock_ndp"
               inkscape:label="layer_snum_old_lock_ndp" style="display:inline">
               <use xlink:href="#old_lock_ndp" x="@b_oldlock_x" y="@b_oldlock_y"/>
           </g>
        </g>
        
        `;

    let svg_4_5_snum_icons_insert =
        `<g id="layer_snum_insert"
           inkscape:label="layer_snum_insert" style="display:inline">
           <use xlink:href="#insert" x="@b_insert_x" y="@b_insert_y"/>
        </g>
    `;

    let svg_5_endsvg =
    `<g id="layer_o"
	inkscape:label="layer_o"
	style="display:inline">
        <g id="layer_o_background"
        inkscape:label="layer_o_background"
        style="display:inline">
            <g id="layer_o_background_off"
            inkscape:label="layer_o_background_off"
            style="display:inline"></g>
            <g id="layer_o_background_on"
            inkscape:label="layer_o_background_on"
            style="display:inline"></g>
            <rect width="@w" height="@h" x="@x" y="@y"
            style="fill:none"/>
        </g>  
    </g>

</svg>`;



    // функция и слушатели для перетягивания границы между блоками параметров и изображения svg
    function resize(e){
        const dx = m_pos - e.x;
        m_pos = e.x;
        parameters_block.style.width = (parseInt(getComputedStyle(parameters_block, '').width) - dx) + "px"; 
    }

    parameters_block.addEventListener("mousedown", function(e){
        if (e.offsetX > parseInt(getComputedStyle(parameters_block, '').width) - parameters_block_border_width) {
            m_pos = e.x;
            document.addEventListener("mousemove", resize, false);
        }
    }, false);

    document.addEventListener("mouseup", function(){
        document.removeEventListener("mousemove", resize, false);
    }, false);


    // слушатель выделения текста при фокусе и увеличение/уменьшение значения при Shift+UP/DOWN на +-10 и просто UP/DOWN на +-1 в полях ввода в нижней строке параметров
    function add_listener_svg_parameters_block_inputs() {
        let arr = svg_parameters_block.getElementsByTagName('textarea');
        for (let i=0; i < arr.length; i++) {
            arr[i].addEventListener('focus', function() {
                this.select();
            });
            arr[i].addEventListener('keydown', function(event) {
                if(event.key == 'ArrowUp' && event.shiftKey){
                    this.value = Number(this.value) + 10;
                };
                if(event.key == 'ArrowUp' && !event.shiftKey){
                    this.value = Number(this.value) + 1;
                };
                if(event.key == 'ArrowDown' && event.shiftKey){
                    this.value = Number(this.value) - 10;
                };
                if(event.key == 'ArrowDown' && !event.shiftKey){
                    this.value = Number(this.value) - 1;
                };

                
                record_parameters ();
                change_rendered_svg_parameters ();
                generate_svg ();
                select_layer(selected_layer_option);
                add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
                record_svg_rendered_layers_list ();
                if(!is_indicators_displayed()){hide_indicators()};
            });
        };    
    };

    add_listener_svg_parameters_block_inputs();

    // слушатель выделения текста при фокусе и увеличение/уменьшение значения при Shift+UP/DOWN на +-10 и просто UP/DOWN на +-1 в полях ввода индикаторов
    function add_listener_ind_offset_block_inputs() {
        let arr = document.getElementsByClassName('ind_offset_block');
        for (let i=0; i < arr.length; i++) {
            let arr_textareas = arr[i].getElementsByTagName('textarea');
            for (let j=0; j < arr_textareas.length; j++) {
                // удаление всех старых слушателей через копирование/вставку
                arr_textareas[j].replaceWith(arr_textareas[j].cloneNode(true));

                arr_textareas[j].addEventListener('focus', function() {
                    this.select();
                });

                arr_textareas[j].addEventListener('keydown', function(event) {
                    // включение отображения индикаторов при вводе значения
                    display_indicators();

                    if (this.classList.contains('old_sost_offset_x') || this.classList.contains('old_repair_offset_x') || this.classList.contains('insert_offset_x') || this.classList.contains('old_lock_offset_x') || this.classList.contains('fail_offset_x')){
                        if(event.key == 'ArrowRight' && event.shiftKey){
                            this.value = Number(this.value) + 10;
                        };
                        if(event.key == 'ArrowRight' && !event.shiftKey){
                            this.value = Number(this.value) + 1;
                        };
                        if(event.key == 'ArrowLeft' && event.shiftKey){
                            this.value = Number(this.value) - 10;
                        };
                        if(event.key == 'ArrowLeft' && !event.shiftKey){
                            this.value = Number(this.value) - 1;
                        };

                        if(event.key == 'ArrowDown' && !event.shiftKey){
                            this.nextElementSibling.focus();
                            this.nextElementSibling.value = Number(this.nextElementSibling.value) + 1;
                        };
                        if(event.key == 'ArrowDown' && event.shiftKey){
                            this.nextElementSibling.focus();
                            this.nextElementSibling.value = Number(this.nextElementSibling.value) + 10;
                        };
                        if(event.key == 'ArrowUp' && !event.shiftKey){
                            this.nextElementSibling.focus();
                            this.nextElementSibling.value = Number(this.nextElementSibling.value) - 1;
                        };
                        if(event.key == 'ArrowUp' && event.shiftKey){
                            this.nextElementSibling.focus();
                            this.nextElementSibling.value = Number(this.nextElementSibling.value) - 10;
                        };
                    };

                    if (this.classList.contains('old_sost_offset_y') || this.classList.contains('old_repair_offset_y') || this.classList.contains('insert_offset_y') || this.classList.contains('old_lock_offset_y') || this.classList.contains('fail_offset_y')){
                        if(event.key == 'ArrowUp' && event.shiftKey){
                            this.value = Number(this.value) - 10;
                        };
                        if(event.key == 'ArrowUp' && !event.shiftKey){
                            this.value = Number(this.value) - 1;
                        };
                        if(event.key == 'ArrowDown' && event.shiftKey){
                            this.value = Number(this.value) + 10;
                        };
                        if(event.key == 'ArrowDown' && !event.shiftKey){
                            this.value = Number(this.value) + 1;
                        };

                        if(event.key == 'ArrowRight' && event.shiftKey){
                            this.previousElementSibling.focus();
                            this.previousElementSibling.value = Number(this.previousElementSibling.value) + 10;
                        };
                        if(event.key == 'ArrowRight' && !event.shiftKey){
                            this.previousElementSibling.focus();
                            this.previousElementSibling.value = Number(this.previousElementSibling.value) + 1;
                        };
                        if(event.key == 'ArrowLeft' && event.shiftKey){
                            this.previousElementSibling.focus();
                            this.previousElementSibling.value = Number(this.previousElementSibling.value) - 10;
                        };
                        if(event.key == 'ArrowLeft' && !event.shiftKey){
                            this.previousElementSibling.focus();
                            this.previousElementSibling.value = Number(this.previousElementSibling.value) - 1;
                        };
                    };

                    if(event.ctrlKey && event.altKey && event.code == 'KeyV'){
                        console.log('копировать строку:');
                        console.log(this.closest('.sub_item'));
                        add_row (this.closest('.sub_item'));
                        reload_list_num();
                        resize_textarea();
                        record_parameters();
                        add_remove_border_to_sub_list ();
                        check_delete_icon_displayed();
                    }; 
    

                    record_parameters ();
                    change_rendered_svg_parameters ();
                    generate_svg ();
                    select_layer(selected_layer_option);
                    add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
                    record_svg_rendered_layers_list ();
                    if(!is_indicators_displayed()){hide_indicators()};
                });

            };
            
        };    
    };

    add_listener_ind_offset_block_inputs();

    // слушатель на создание новой строки под текущей при нажатии сочетания клавиш Ctrl+Alt+V
    function add_listener_sub_list_inputs() {
        // let arr = sub_list.getElementsByTagName('textarea');
        let arr_1 = sub_list.getElementsByClassName('fill');
        let arr_2 = sub_list.getElementsByClassName('stroke_in');
        for (let i=0; i < arr_1.length; i++) {
            // удаление всех старых слушателей через копирование/вставку
            arr_1[i].replaceWith(arr_1[i].cloneNode(true));

            arr_1[i].addEventListener('keydown', function(event) {
                if(event.ctrlKey && event.altKey && event.code == 'KeyV'){
                    add_row (arr_1[i].closest('.sub_item'));
                    reload_list_num();
                    resize_textarea();
                    record_parameters();
                    add_remove_border_to_sub_list ();
                    check_delete_icon_displayed();
                    change_rendered_svg_parameters ();
                    generate_svg ();
                    select_layer(selected_layer_option);
                    add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
                    record_svg_rendered_layers_list ();
                    if(!is_indicators_displayed()){hide_indicators()};
                };  
            });
        };
        
        for (let i=0; i < arr_2.length; i++) {
            // удаление всех старых слушателей через копирование/вставку
            arr_2[i].replaceWith(arr_2[i].cloneNode(true));

            arr_2[i].addEventListener('keydown', function(event) {
                if(event.ctrlKey && event.altKey && event.code == 'KeyV'){
                    add_row (arr_2[i].closest('.sub_item'));
                    reload_list_num();
                    resize_textarea();
                    record_parameters();
                    add_remove_border_to_sub_list ();
                    check_delete_icon_displayed();
                    change_rendered_svg_parameters ();
                    generate_svg ();
                    select_layer(selected_layer_option);
                    add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
                    record_svg_rendered_layers_list ();
                    if(!is_indicators_displayed()){hide_indicators()};
                };  
            });
        }; 
    };

    add_listener_sub_list_inputs();


    // Расчёт параметров для штриховки фона в резерве
    function get_bg_pos(svg_width, svg_height) {
        bg_line_angle = Number(document.getElementsByClassName('bg_hatch_line_angle')[0].value);
        bg_line_width = Number(document.getElementsByClassName('bg_hatch_line_width')[0].value);
        bg_line_percent = Number(document.getElementsByClassName('bg_hatch_line_percent')[0].value);

        if (bg_line_width < 1){
            bg_line_width = 1;
            document.getElementsByClassName('bg_hatch_line_width')[0].value = '1';
        };

        if (bg_line_percent <= 0){bg_line_percent = 0.5};
        if (bg_line_percent > 100){
            bg_line_percent = 100;
            document.getElementsByClassName('bg_hatch_line_percent')[0].value = '100';
        };
        if (bg_line_percent < 1){
            bg_line_percent = 1;
            document.getElementsByClassName('bg_hatch_line_percent')[0].value = '1';
        };

        if (bg_line_angle < 0){
            bg_line_angle = 0;
            document.getElementsByClassName('bg_hatch_line_angle')[0].value = '0';
        };
        if (bg_line_angle > 180){
            bg_line_angle = 180;
            document.getElementsByClassName('bg_hatch_line_angle')[0].value = '180';
        };

        bg_pos_y_1 = 0;
        bg_pos_x_1 = svg_width;
        bg_line_lenght = svg_width;

        if (bg_line_angle == 0){
            bg_pos_x_2 = 0;
            bg_pos_y_2 = 0;
        } else {
            if (bg_line_angle == 180){
                bg_pos_x_1 = 0;
                bg_pos_x_2 = svg_width;
                bg_pos_y_2 = 0;
            } else {
                if (bg_line_angle == 90){
                    bg_pos_x_2 = svg_width;
                    bg_pos_y_2 = svg_height;
                    bg_line_lenght = svg_height;
                } else {
                    if (bg_line_angle < 90){
                        rad = (bg_line_angle*Math.PI) / 180;
                        bg_pos_y_2 = svg_height+(svg_width-svg_height/Math.tan(rad))*Math.sin(rad)*Math.cos(rad);
                        bg_pos_x_2=Math.tan(rad)*(bg_pos_y_2-svg_height);
                        bg_line_lenght = bg_pos_y_2/Math.sin(rad);
                    } else {
                        rad = ((180-bg_line_angle)*Math.PI) / 180;
                        bg_pos_y_2 = svg_height+(svg_width-svg_height/Math.tan(rad))*Math.sin(rad)*Math.cos(rad);
                        bg_pos_x_2=Math.tan(rad)*(bg_pos_y_2-svg_height);
                        bg_line_lenght = bg_pos_y_2/Math.sin(rad);
                        bg_pos_x_1 = 0;
                        bg_pos_x_2 = svg_width-bg_pos_x_2;
                    }
                }
            }
        };

        // bg_pos_x_1 = bg_line_width*Math.cos(rad)*100/bg_line_percent;
        // bg_pos_y_2 = bg_line_width*Math.sin(rad)*100/bg_line_percent;
    }

    // Расчёт точек смены цветы на градиенте штриховки по заданной длине градиента, ширине штриха и пропуска
    function generateStripeStops(L, a, b) {
        const stopIndent = "            "; // 3 уровня отступа
        let lines = [];
    
        let position = 0;
        while (position < L) {
            const lineStart = ((position / L) * 100).toFixed(2) + "%";
            const lineEnd = ((Math.min(position + a, L) / L) * 100).toFixed(2) + "%";
    
            // Добавляем оба <stop> с нужным отступом
            lines.push(`${stopIndent}<stop offset="${lineStart}" class="bg_1"></stop>`);
            lines.push(`${stopIndent}<stop offset="${lineEnd}" class="bg_1"></stop>`);
    
            position += a;
            if (position >= L) break;
    
            const gapStart = ((position / L) * 100).toFixed(2) + "%";
            const gapEnd = ((Math.min(position + b, L) / L) * 100).toFixed(2) + "%";
    
            // Добавляем оба <stop> для пропуска с нужным отступом
            lines.push(`${stopIndent}<stop offset="${gapStart}" class="bg_2"></stop>`);
            lines.push(`${stopIndent}<stop offset="${gapEnd}" class="bg_2"></stop>`);
    
            position += b;
        }
    
        return lines.join("\n");
    }

    // Изменение масштаба сгенерированного svg, масштаба иконок-индикаторов, толщин линий
    function change_rendered_svg_parameters () {
        st_in_width = Number(document.getElementsByClassName('st_in_width')[0].value);
        st_out_width = Number(document.getElementsByClassName('st_out_width')[0].value);
        indicator_scale = document.getElementsByClassName('indicator_scale')[0].value/100;
        let margin_scale = document.getElementsByClassName('margin_scale')[0].value/100;
        let margin_scale_delta = 0.2;

        if(st_in_width <= 1){
            st_in_width = 1;
            document.getElementsByClassName('st_in_width')[0].value = '1';
        };
        if(st_out_width <= 1){
            st_out_width = 1;
            document.getElementsByClassName('st_out_width')[0].value = '1';
        };

        if(indicator_scale <= 0.01){
            indicator_scale = 0.01;
            document.getElementsByClassName('indicator_scale')[0].value = '1';
        };

        if(margin_scale < 0){
            margin_scale = 0;
            document.getElementsByClassName('margin_scale')[0].value = '0';
        }else if(margin_scale > 1){
            margin_scale = 1;
            document.getElementsByClassName('margin_scale')[0].value = '100';
        };

        margin_scale = margin_scale_delta + margin_scale*(1-margin_scale_delta);

        let block_height = org_block_height;
        let block_margin = org_block_margin;

        block_margin = block_margin + block_height*(1-margin_scale)/2;
        block_height = block_height*margin_scale;

        block.style.margin = block_margin + "px";
        block.style.height = block_height + "px";
    };

    change_rendered_svg_parameters ();


    // Считывание всех индикаторов в сгенерированном svg-изображении и вкл/выкл всех индикаторов, в зависимости от action (hide или display)
    function record_and_hide_or_display_indicators(action){
        // проверка наличия svg внутри block;
        if (block.getElementsByTagName('svg')[0]) {
            svg_rendered_sub_arr = Array.from(block.children[0].children);
            svg_rendered_sub_arr.splice(0, 2);
            svg_rendered_sub_arr.splice(-1, 1);

            if(svg_rendered_sub_arr.length > 0){
                for (let i=0; i < svg_rendered_sub_arr.length; i++) {
                    let ind_fail = document.getElementById('layer_s' + i.toString() + '_fail');
                    let ind_old_sost = document.getElementById('layer_s' + i.toString() + '_old_sost');
                    let ind_old_repair = document.getElementById('layer_s' + i.toString() + '_old_repair');
                    let ind_old_lock = document.getElementById('layer_s' + i.toString() + '_old_lock');
                    let ind_insert = document.getElementById('layer_s' + i.toString() + '_insert');
    
                    if(action == 'hide'){
                        ind_fail.classList.add('elem_hidden');
                        ind_old_sost.classList.add('elem_hidden');
                        ind_old_repair.classList.add('elem_hidden');
                        ind_old_lock.classList.add('elem_hidden');
                        ind_insert.classList.add('elem_hidden');
                    } else if(action == 'display'){
                        ind_fail.classList.remove('elem_hidden');
                        ind_old_sost.classList.remove('elem_hidden');
                        ind_old_repair.classList.remove('elem_hidden');
                        ind_old_lock.classList.remove('elem_hidden');
                        ind_insert.classList.remove('elem_hidden');
                    };
                }
            }
        };
    };

    // Выкл индикаторов (выключение переключателя, поле ввода масштаба переключателей неактивно и полупрозрачно)
    function hide_indicators(){
        switch_off.classList.remove('elem_hidden');
        switch_on.classList.add('elem_hidden');
        indicator_scale_input.disabled = true;
        indicator_scale_input.style.opacity = "0.2";
        indicator_scale_input.nextElementSibling.style.opacity = "0.2";

        record_and_hide_or_display_indicators('hide');
    }

    // Вкл индикаторов (включение переключателя, поле ввода масштаба переключателей активно и непрозрачно)    
    function display_indicators(){
        switch_off.classList.add('elem_hidden');
        switch_on.classList.remove('elem_hidden');
        indicator_scale_input.disabled = false;
        indicator_scale_input.style.opacity = "1";
        indicator_scale_input.nextElementSibling.style.opacity = "1";

        record_and_hide_or_display_indicators('display');
    }


    // слушатели на кнопку вкл/выкл отображения индикаторов и кнопку отображения слоёв;
    svg_parameters_block.addEventListener('click', function(event) {
        elem = event.target;

        // слушатель на нажатие на кнопку вкл/выкл отображения индикаторов
        if (elem.classList.contains('ind_switch') || elem.parentNode.classList.contains('ind_switch')){
            if (is_indicators_displayed ()){
                hide_indicators();
            } else {
                display_indicators();
            }
        };


        // слушатель на нажатие на кнопку отображения слоёв
        if (elem.classList.contains('layers_block')){
            for (let i=0; i < elem.parentNode.children.length; i++) {
                elem.parentNode.children[i].classList.remove('layer_block_active');
            };
            elem.classList.add('layer_block_active');
            select_layer(elem);
            selected_layer_option = elem;
        }
    });


    // слушатель на наведение на кнопку отображения слоёв
    svg_parameters_block.addEventListener('mouseover', function(event) {
        elem = event.target;
        if (elem.classList.contains('layers_block')){
            select_layer(elem);
        }

    });

    // слушатель на переключение на выбранный элемент при уведении мыши с блока кнопок отображения слоёв
    svg_parameters_block.getElementsByClassName('layers_blocks')[0].addEventListener('mouseout', function() {
        select_layer(selected_layer_option);
    });


    // Выбор слоя и переименование подписей при наведении или нажатии на кнопки отображения слоёв;
    function select_layer(element){
        let class_names = ['otlichno', 'norm', 'tpm', 'ndp', 'repair', 'reserve'];
        let sost_names = ['Отлично', 'ДОП', 'ТПМ', 'НДП', 'Ремонт', 'Резерв'];

        for (let i=0; i < class_names.length; i++) {
            if (element.classList.contains(class_names[i])){
                element.parentNode.parentNode.children[0].innerText = "Состояние – " + sost_names[i];
            };
        };

        if (block.getElementsByTagName('svg')[0]) {
            svg_rendered_sub_arr = Array.from(block.children[0].children);
            svg_rendered_sub_arr.splice(0, 2);
            svg_rendered_sub_arr.splice(-1, 1);

            if(svg_rendered_sub_arr.length > 0){
                for (let i=0; i < svg_rendered_sub_arr.length; i++) {
                    for (let j=0; j < class_names.length; j++) {
                        if(class_names[j] != 'reserve'){
                            document.getElementById('layer_s' + i.toString()+ '_' + class_names[j]).classList.add('elem_hidden');
                            if (element.classList.contains(class_names[j])){
                                document.getElementById('layer_s' + i.toString()+ '_' + class_names[j]).classList.remove('elem_hidden');
                            };
                        };  
                    };  
                };
            };
        };

    };


    // Проверка вкл/выкл кнопки отображения индикаторов;
    function is_indicators_displayed (){
        if (switch_off.classList.contains('elem_hidden')){
            return true;
        } else {
            return false;
        }
    };


    // запись элементов svg в массив и простановка на них слушателей на наведение, нажатие и снятие наведения
    function record_svg_rendered_layers_list () {
        svg_rendered_sub_arr = Array.from(block.children[0].children);
        svg_rendered_sub_arr.splice(0, 2);
        svg_rendered_sub_arr.splice(-1, 1);
        frame_selected_arr = document.getElementsByClassName('st_selected');

        // Смена курсора на всех субъектах;
        for (let i=0; i < svg_rendered_sub_arr.length; i++) {
            svg_rendered_sub_arr[i].style.cursor = "pointer";
        };

        block.getElementsByTagName('svg')[0].addEventListener('mouseover', function(event) {
            let elem = event.target;
            for (let i=0; i < svg_rendered_sub_arr.length; i++) {
                if(elem == svg_rendered_sub_arr[i] || elem.parentNode == svg_rendered_sub_arr[i] || elem.parentNode.parentNode == svg_rendered_sub_arr[i] || elem.parentNode.parentNode.parentNode == svg_rendered_sub_arr[i]){
                    sub_item_row[i].classList.add('sub_item_row_hover');
                    frame_selected_arr[i].classList.remove('elem_hidden');
                };
            }
        });

        block.getElementsByTagName('svg')[0].addEventListener('mouseout', function(event) {
            let elem = event.target;
            for (let i=0; i < svg_rendered_sub_arr.length; i++) {
                if(elem == svg_rendered_sub_arr[i] || elem.parentNode == svg_rendered_sub_arr[i] || elem.parentNode.parentNode == svg_rendered_sub_arr[i] || elem.parentNode.parentNode.parentNode == svg_rendered_sub_arr[i]){
                    sub_item_row[i].classList.remove('sub_item_row_hover');
                    frame_selected_arr[i].classList.add('elem_hidden');
                }
            }
        });

        block.getElementsByTagName('svg')[0].addEventListener('click', function(event) {
            let elem = event.target;
            let ind_arr = ['fail', 'old_sost', 'old_repair', 'old_lock', 'insert'];
            for (let i=0; i < svg_rendered_sub_arr.length; i++) {
                if(elem == svg_rendered_sub_arr[i] || elem.parentNode == svg_rendered_sub_arr[i] || elem.parentNode.parentNode == svg_rendered_sub_arr[i] || elem.parentNode.parentNode.parentNode == svg_rendered_sub_arr[i]){
                    open_collapse_rows(sub_item_row[i]);
                };
                for (let j=0; j < ind_arr.length; j++) {
                    if(elem.id == ('layer_s'+ i.toString() + '_' + ind_arr[j]) || elem.parentNode.id == ('layer_s'+ i.toString() + '_' + ind_arr[j]) || elem.parentNode.parentNode.id == ('layer_s'+ i.toString() + '_' + ind_arr[j])){
                        select_ind_offset_textarea(sub_item_row[i], ind_arr[j]);
                    };
                };
            };
        });
    };

    // поставить фокус на первое поле ввода кода заливки слоя S0 при запуске
    textArea[10].focus();

    // Добавление или скрытие бордера в нижней части списка в зависимости от суммарной высоты строк
    function add_remove_border_to_sub_list () {
        let height = 0;
        for (let i=0; i < sub_item.length; i++) {
            height = sub_item[i].getBoundingClientRect().height + height;
        };
        if (height < sub_list.getBoundingClientRect().height){
            sub_list.style.borderBottomWidth = "0px";
        }else{
            sub_list.style.borderBottomWidth = "1px";
        };
    };

    add_remove_border_to_sub_list ();


    // Растягивание на весь экран
    function container_size(element) {
        element.style.height = document.documentElement.clientHeight+"px";
        element.style.width = document.documentElement.clientWidth+"px";
    }

    container_size(container)

    window.addEventListener('resize', function() {
        container_size(container);
    });


    // добавление строки
    function add_row (this_sub_item){
        let new_sub_item = this_sub_item.cloneNode(true);
        let text_arr = new_sub_item.getElementsByTagName('textarea');
        for (let i=0; i < text_arr.length; i++) {text_arr[i].value=''};
        new_sub_item.getElementsByClassName('sub_num')[0].innerHTML ='';

        new_sub_item.getElementsByClassName('ind_offset_block')[0].classList.add('elem_hidden');
        new_sub_item.getElementsByClassName('move_ind_on')[0].classList.add('elem_hidden');
        new_sub_item.getElementsByClassName('move_ind_off')[0].classList.remove('elem_hidden');

        this_sub_item.after(new_sub_item);
        collapse_rows(sub_item);
        open_collapse_rows(new_sub_item);
        add_listener_ind_offset_block_inputs();
        add_listener_sub_list_inputs();
        new_sub_item.getElementsByTagName('textarea')[10].focus();
    }

    // скрытие и раскрытие строки по нажатии на неё
    function open_collapse_rows(elem) {
        let item = elem.closest('.sub_item');
        let arr = item.children;
        start_pos = 1;

        if(item.getElementsByClassName('move_ind_on')[0].classList.contains('elem_hidden')){
            start_pos = 2;
        };

        if(arr[start_pos].classList.contains('elem_hidden')){
            collapse_rows(sub_item);
            for (let i=start_pos; i < arr.length; i++) {
                arr[i].classList.remove('elem_hidden');
            };
            item.getElementsByTagName('textarea')[10].focus();
            item.scrollIntoView({ behavior: 'instant' }); 
            
        } else{
            collapse_rows(sub_item);
        };
        
    };


    // скрытие и раскрытие блока индикаторов внутри строки по нажатии на неё
    function open_collapse_ind_offset_block(elem) {
        let arr = elem.closest('.sub_item').children;
        let move_ind_on = elem.closest('.sub_item').getElementsByClassName('move_ind_on')[0];
        let move_ind_off = elem.closest('.sub_item').getElementsByClassName('move_ind_off')[0];

        if(move_ind_on.classList.contains('elem_hidden')){
            move_ind_on.classList.remove('elem_hidden');
            move_ind_off.classList.add('elem_hidden');
            open_collapse_rows(elem);
            elem.closest('.sub_item').getElementsByTagName('textarea')[0].focus();
            display_indicators();
        } else{
            move_ind_on.classList.add('elem_hidden');
            move_ind_off.classList.remove('elem_hidden');
            for (let i=0; i <= 9; i++) {
                elem.closest('.sub_item').getElementsByTagName('textarea')[i].value = "";
            }
            arr[1].classList.add('elem_hidden');
            elem.closest('.sub_item').getElementsByTagName('textarea')[10].focus();
        };

        
        record_parameters();
        generate_svg ();
        select_layer(selected_layer_option);
        add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
        record_svg_rendered_layers_list ();
        if(!is_indicators_displayed()){hide_indicators()};
    };

    // выбор поля ввода значения X для данного индикатора блока индикаторов внутри строки по нажатии на индикатор на сгенерированном svg
    function select_ind_offset_textarea(elem, ind_type) {
        let arr = elem.closest('.sub_item').children;
        let arr_textarea = elem.closest('.sub_item').getElementsByTagName('textarea');
        let move_ind_on = elem.closest('.sub_item').getElementsByClassName('move_ind_on')[0];
        let move_ind_off = elem.closest('.sub_item').getElementsByClassName('move_ind_off')[0];

        let ind_arr = ['fail', 'old_sost', 'old_repair', 'old_lock', 'insert'];
        let ind_textarea_x = [8, 0, 2, 6, 4];
        let ind_textarea_y = [9, 1, 3, 7, 5];


        if(move_ind_on.classList.contains('elem_hidden')){
            move_ind_on.classList.remove('elem_hidden');
            move_ind_off.classList.add('elem_hidden');
            open_collapse_rows(elem);  
        } else{
            if (arr[1].classList.contains('elem_hidden')){open_collapse_rows(elem);};
        };

        for (let i=0; i < ind_arr.length; i++) {
            if(ind_arr[i] == ind_type){
                if(arr_textarea[ind_textarea_y[i]].value != '' && arr_textarea[ind_textarea_x[i]].value == ''){
                    arr_textarea[ind_textarea_y[i]].focus();
                }else{
                    arr_textarea[ind_textarea_x[i]].focus();
                };
            };
        };

        
        record_parameters();
        generate_svg ();
        select_layer(selected_layer_option);
        add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
        record_svg_rendered_layers_list ();
        if(!is_indicators_displayed()){hide_indicators()};
    };
    

    // скрытие всех дочерних элементов, кроме первого [0] (для скрытия строк списка)
    function collapse_rows(element) {
        for (let i=0; i < element.length; i++) {
            arr = element[i].children;
            for (let i=1; i < arr.length; i++) {
                arr[i].classList.add('elem_hidden');
            }
        }
    }


    // вкл и выключение отображение иконки delete
    function check_delete_icon_displayed() {
        if (sub_item.length == 1){
            del_btn[0].style.display = "none";
        } else {
            for (let i=0; i < del_btn.length; i++) {
                del_btn[i].style.display = "block";
            }
        };
    }
    
    check_delete_icon_displayed();


    // слушатели на кнопки добавить, удалить и на раскрытие/скрытие строки
    sub_list.addEventListener('click', function(event) {
        elem = event.target;
        if (elem.classList.contains('add_row') || elem.parentNode.classList.contains('add_row')){
            if (elem.parentNode.classList.contains('add_row')){elem = elem.parentNode};
            add_row (elem.parentNode.parentNode);
            reload_list_num();
            resize_textarea();
            record_parameters();
            add_remove_border_to_sub_list ();
            check_delete_icon_displayed();
            change_rendered_svg_parameters ();
            generate_svg ();
            select_layer(selected_layer_option);
            add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
            record_svg_rendered_layers_list ();
            if(!is_indicators_displayed()){hide_indicators()};
        };

        if (elem.classList.contains('delete_row') || elem.parentNode.classList.contains('delete_row')){
            if (sub_item.length > 1){
                elem.closest('.sub_item').remove();
                reload_list_num();
                resize_textarea();
                record_parameters();
                add_remove_border_to_sub_list ();
                check_delete_icon_displayed();
                change_rendered_svg_parameters ();
                generate_svg ();
                select_layer(selected_layer_option);
                add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
                record_svg_rendered_layers_list ();
                if(!is_indicators_displayed()){hide_indicators()};
            };
        };

        if (elem.classList.contains('sub_num') || elem.classList.contains('sub_item_row')){
            open_collapse_rows(elem);
            add_remove_border_to_sub_list ();
        };

        if (elem.classList.contains('move_ind_on') || elem.parentNode.classList.contains('move_ind_on') || elem.classList.contains('move_ind_off') || elem.parentNode.classList.contains('move_ind_off')){
            open_collapse_ind_offset_block(elem);
        };
    });

    // слушатель на подсвечивание элементов сгенерированного svg при наведении на соответствующую строку списка
    sub_list.addEventListener('mouseover', function(event) {
        elem = event.target;
        if (elem.classList.contains('sub_item_row') || elem.parentNode.classList.contains('sub_item_row')){
            for (let i=0; i < sub_item.length; i++) {
                if (elem.closest('.sub_item') == sub_item[i]){
                    frame_selected_arr = document.getElementsByClassName('st_selected');
                    if(typeof frame_selected_arr[i] !== 'undefined'){frame_selected_arr[i].classList.remove('elem_hidden')};
                }
            };  
        };
    });

    // слушатель на удаление подсвечивания элементов сгенерированного svg при отведении мыши с соответствующей строку списка
    sub_list.addEventListener('mouseout', function(event) {
        elem = event.target;
        if (elem.classList.contains('sub_item_row') || elem.parentNode.classList.contains('sub_item_row')){
            for (let i=0; i < sub_item.length; i++) {
                if (elem.closest('.sub_item') == sub_item[i]){
                    frame_selected_arr = document.getElementsByClassName('st_selected');
                    if(typeof frame_selected_arr[i] !== 'undefined'){frame_selected_arr[i].classList.add('elem_hidden')};
                }
            };  
        };
    });


    // обновление номеров строк в отображаемом списке
    function reload_list_num() {
        for (let i=0; i < sub_item.length; i++) {
            sub_item_row[i].getElementsByClassName('sub_num')[0].innerHTML = 's'+[i];
            let text = sub_item[i].getElementsByClassName('text_title');
            text[0].innerHTML = 'Заливка&ensp;<span>layer_s'+[i]+'_fill</span>';
            text[1].innerHTML = 'Внутренние линии&ensp;<span>layer_s'+[i]+'_stroke_in</span>';
        }
    }


    // конструктор субъекта
    function Subject(num, fill, stroke_in, fail_offset_x, fail_offset_y, old_sost_offset_x, old_sost_offset_y, old_repair_offset_x, old_repair_offset_y, old_lock_offset_x, old_lock_offset_y, insert_offset_x, insert_offset_y) {
        this.num = num;
        this.fill = fill;
        this.stroke_in = stroke_in;
        this.fail_offset_x = fail_offset_x;
        this.fail_offset_y = fail_offset_y;
        this.old_sost_offset_x = old_sost_offset_x;
        this.old_sost_offset_y = old_sost_offset_y;
        this.old_repair_offset_x = old_repair_offset_x;
        this.old_repair_offset_y = old_repair_offset_y;
        this.old_lock_offset_x = old_lock_offset_x;
        this.old_lock_offset_y = old_lock_offset_y;
        this.insert_offset_x = insert_offset_x;
        this.insert_offset_y = insert_offset_y;
    }


    // запись данных со всех полей и номеров субъектов в массив sub_list_svg с объектами по каждому субъекту
    function record_parameters() {
        let arr = sub_list_svg;
        arr.splice(0,arr.length);//  очистка массива перед новым заполнением
        for (let i=0; i < sub_list.children.length; i++) {
            arr[i] = new Subject ();
            arr[i].num = i;
            arr[i].fill = sub_list.children[i].getElementsByClassName('fill')[0].value;
            arr[i].stroke_in = sub_list.children[i].getElementsByClassName('stroke_in')[0].value;
            arr[i].fail_offset_x = sub_list.children[i].getElementsByClassName('fail_offset_x')[0].value;
            arr[i].fail_offset_y = sub_list.children[i].getElementsByClassName('fail_offset_y')[0].value;
            arr[i].old_sost_offset_x = sub_list.children[i].getElementsByClassName('old_sost_offset_x')[0].value;
            arr[i].old_sost_offset_y = sub_list.children[i].getElementsByClassName('old_sost_offset_y')[0].value;
            arr[i].old_repair_offset_x = sub_list.children[i].getElementsByClassName('old_repair_offset_x')[0].value;
            arr[i].old_repair_offset_y = sub_list.children[i].getElementsByClassName('old_repair_offset_y')[0].value;
            arr[i].old_lock_offset_x = sub_list.children[i].getElementsByClassName('old_lock_offset_x')[0].value;
            arr[i].old_lock_offset_y = sub_list.children[i].getElementsByClassName('old_lock_offset_y')[0].value;
            arr[i].insert_offset_x = sub_list.children[i].getElementsByClassName('insert_offset_x')[0].value;
            arr[i].insert_offset_y = sub_list.children[i].getElementsByClassName('insert_offset_y')[0].value;
        }
    }


    // конструктор отрисованного изображения субъекта
    function Subject_render(num, x, y, width, height) {
        this.num = num;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    // изменение высоты полей ввода textArea в зависимости от контента + при вводе текста перезапись в массив sub_list_svg данных со всех полей и номеров субъектов и перерисовка svg-файла
    function auto_grow(element) {
        element.style.height = "5px";
        element.style.height = (element.scrollHeight) + "px";
    }

    function resize_textarea() {
        for (let i=0; i < textArea.length; i++) {
            auto_grow(textArea[i]);
            textArea[i].addEventListener('input', function() {
                textArea[i].value = textArea[i].value.replace(/\n/g,'').replace(/ +/g, ' ').replace(/> </g, '><').trim();
                
                auto_grow(this);
                record_parameters();
                change_rendered_svg_parameters ();
                generate_svg ();
                select_layer(selected_layer_option);
                add_frame_icons (indicator_diameter, indicator_st_out_width, st_out_width, st_in_width, indicator_scale);
                record_svg_rendered_layers_list ();
                if(!is_indicators_displayed()){hide_indicators()};
            });
            new ResizeObserver(function () {
                auto_grow(textArea[i]);
                add_remove_border_to_sub_list ();
            }).observe(textArea[i])
        }
    }

    resize_textarea();


    function snum_paths (num) {
        num = num.toString();
        text = [
            svg_2_1_frame,
            svg_2_2_fill,
            svg_2_3_stroke_in,];

        for (let i=0; i < text.length; i++) {
            text[i] = text[i].replace(/num/gi,num);
        };

        return (text[0] + text[1] + sub_list_svg[num].fill + svg_2_endgroup + text[2] + sub_list_svg[num].stroke_in + svg_2_endgroup); 
    };

    function generate_svg () {
        let svg_2_paths;
        let svg_4_blocks;

        for (let i=0; i < sub_list_svg.length; i++) {
            svg_2_paths = svg_2_paths + snum_paths(i);
            svg_4_blocks = svg_4_blocks + svg_4_snum_block.replace(/num/gi,i);
        } 

        block.innerHTML = svg_1_styles + svg_2_paths + svg_3_icons + svg_4_blocks + svg_5_endsvg;

        // предотвращение вывода ошибок при генерации svg с символами без заменённых значений;
        console.clear();
    }

    function add_frame_icons (ind_diameter, ind_str_out, str_out, str_in, ind_scale) {
        let svg_width;
        let svg_height;
        let svg_x;
        let svg_y;
        let sub_render_list = [];

        for (let i=0; i < sub_list_svg.length; i++) {

            let layer = document.getElementById('layer_s'+i.toString());
            let layer_frame = document.getElementById('layer_s'+i.toString()+'_frame').innerHTML;
            let fail = svg_4_1_snum_icons_fail;
            let old_sost = svg_4_2_snum_icons_old_sost;
            let old_repair = svg_4_3_snum_icons_old_repair;
            let old_lock = svg_4_4_snum_icons_old_lock;
            let insert  = svg_4_5_snum_icons_insert;

            let fail_offset_x = Number(sub_list_svg[i].fail_offset_x);
            let old_sost_offset_x = Number(sub_list_svg[i].old_sost_offset_x);
            let old_repair_offset_x = Number(sub_list_svg[i].old_repair_offset_x);
            let old_lock_offset_x = Number(sub_list_svg[i].old_lock_offset_x);
            let insert_offset_x = Number(sub_list_svg[i].insert_offset_x);

            let fail_offset_y = Number(sub_list_svg[i].fail_offset_y);
            let old_sost_offset_y = Number(sub_list_svg[i].old_sost_offset_y);
            let old_repair_offset_y = Number(sub_list_svg[i].old_repair_offset_y);
            let old_lock_offset_y = Number(sub_list_svg[i].old_lock_offset_y);
            let insert_offset_y = Number(sub_list_svg[i].insert_offset_y);

            let x_offset_max = Math.max(fail_offset_x, old_lock_offset_x);
            let x_offset_min = Math.min(old_sost_offset_x, old_repair_offset_x);
            let y_offset_max = Math.max(old_sost_offset_y, fail_offset_y);
            let y_offset_min = Math.min(old_repair_offset_y, old_lock_offset_y);
            
            let width = layer.getBoundingClientRect().width;
            let height = layer.getBoundingClientRect().height;
            let parentPos = block.getBoundingClientRect();
            let childPos = layer.getBoundingClientRect();
            let x = (childPos.left - parentPos.left);
            let y = (childPos.top - parentPos.top);

            if(width != 0)
                {
                    width = width + str_out;
                    x = x - str_out/2;
                };

            if(height != 0)
                {
                    height = height + str_out;
                    y = y - str_out/2;
                };
            

            if (width > 0 && height > 0) {

                layer_frame = layer_frame.replace(/@fw/gi,width.toFixed(2));
                layer_frame = layer_frame.replace(/@fh/gi,height.toFixed(2));
                layer_frame = layer_frame.replace(/@fx/gi,x.toFixed(2));
                layer_frame = layer_frame.replace(/@fy/gi,y.toFixed(2));
                document.getElementById('layer_s'+i.toString()+'_frame').innerHTML = layer_frame;

                fail = fail.replace(/num/gi,i.toString());
                fail = fail.replace(/@b_fail_x/gi,(x + fail_offset_x + width - ind_diameter*ind_scale).toFixed(2));
                fail = fail.replace(/@b_fail_y/gi,(y + fail_offset_y + height - ind_diameter*ind_scale).toFixed(2));
                layer.insertAdjacentHTML('beforeend',fail);

                old_sost = old_sost.replace(/num/gi,i.toString());
                old_sost = old_sost.replace(/@b_oldsost_x/gi,(x + old_sost_offset_x).toFixed(2));
                old_sost = old_sost.replace(/@b_oldsost_y/gi,(y + old_sost_offset_y + height - ind_diameter*ind_scale).toFixed(2));
                layer.insertAdjacentHTML('beforeend',old_sost);

                old_repair = old_repair.replace(/num/gi,i.toString());
                old_repair = old_repair.replace(/@b_repair_x/gi,(x + old_repair_offset_x).toFixed(2));
                old_repair = old_repair.replace(/@b_repair_y/gi,(y + old_repair_offset_y).toFixed(2));
                layer.insertAdjacentHTML('beforeend',old_repair);

                old_lock = old_lock.replace(/num/gi,i.toString());
                old_lock = old_lock.replace(/@b_oldlock_x/gi,(x + old_lock_offset_x + width - ind_diameter*ind_scale).toFixed(2));
                old_lock = old_lock.replace(/@b_oldlock_y/gi,(y + old_lock_offset_y).toFixed(2));
                layer.insertAdjacentHTML('beforeend',old_lock);

                insert = insert.replace(/num/gi,i.toString());
                insert = insert.replace(/@b_insert_x/gi,(x + insert_offset_x + width/2 - ind_diameter*ind_scale/2).toFixed(2));
                insert = insert.replace(/@b_insert_y/gi,(y + insert_offset_y + height/2 - ind_diameter*ind_scale/2).toFixed(2));
                layer.insertAdjacentHTML('beforeend',insert);
            }

            if (x_offset_max > 0){width = x_offset_max + width};
            if (x_offset_min < 0){
                width = Math.abs(x_offset_min) + width;
                x = x_offset_min + x};
            if (y_offset_max > 0){height = y_offset_max + height};
            if (y_offset_min < 0){
                height = Math.abs(y_offset_min) + height;
                y = y_offset_min + y};

            sub_render_list[i] = new Subject_render ();
            sub_render_list[i].num = i;
            sub_render_list[i].x = x;
            sub_render_list[i].y = y;
            sub_render_list[i].width = width;
            sub_render_list[i].height = height;
        }

        let arr_x_max = [];
        let arr_x_min = [];
        let arr_y_max = [];
        let arr_y_min = [];

        for (let i=0; i < sub_render_list.length; i++) {
            let arr = sub_render_list;
            arr_x_max[i] = arr[i].x + arr[i].width;
            arr_x_min[i] = arr[i].x;
            arr_y_max[i]= arr[i].y + arr[i].height;
            arr_y_min[i] = arr[i].y;
        }

        svg_x = Math.min(...arr_x_min);
        svg_width = Math.max(...arr_x_max) - Math.min(...arr_x_min);
        svg_y = Math.min(...arr_y_min);
        svg_height = Math.max(...arr_y_max) - Math.min(...arr_y_min);

        block.innerHTML = block.innerHTML.replace(/@x/gi,(svg_x).toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@y/gi,(svg_y).toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@w/gi,svg_width.toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@h/gi,(svg_height+add_down_space).toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@sow/gi,str_out.toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@sinw/gi,str_in.toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@isow/gi,ind_str_out.toFixed(2));
        block.innerHTML = block.innerHTML.replace(/@scale/gi,ind_scale.toFixed(2));

        get_bg_pos(svg_width, svg_height);

        block.innerHTML = block.innerHTML.replace(/@bg_pos_x_1/gi,bg_pos_x_1.toFixed(0));
        block.innerHTML = block.innerHTML.replace(/@bg_pos_x_2/gi,bg_pos_x_2.toFixed(0));
        block.innerHTML = block.innerHTML.replace(/@bg_pos_y_1/gi,bg_pos_y_1.toFixed(0));
        block.innerHTML = block.innerHTML.replace(/@bg_pos_y_2/gi,bg_pos_y_2.toFixed(0));

        block.innerHTML = block.innerHTML.replace(/@linear_grad_stops/gi,generateStripeStops(bg_line_lenght, bg_line_width, bg_line_width*((100/bg_line_percent)-1)));
    }


    // подсчёт кол-ва субъектов;
    function svg_rendered_sub_qnty () {
        if (block.getElementsByTagName('svg')[0]) {
            svg_rendered_sub_arr = Array.from(block.children[0].children);
            svg_rendered_sub_arr.splice(0, 2);
            svg_rendered_sub_arr.splice(-1, 1);
            return svg_rendered_sub_arr.length;
        } else {
            return 0;
        };
    };

    // удаление лишнего текста из svg кода;
    function prepare_svg_code_from_text (text){
        svg_rendered_sub_arr = Array.from(block.children[0].children);
        svg_rendered_sub_arr.splice(0, 2);
        svg_rendered_sub_arr.splice(-1, 1);

        new_text = text.replace(/ style="width: 100%; height: 100%"/gi,'').replace(/undefined/gi,'').replace(/ class="elem_hidden"/gi,'').replace(/class="elem_hidden"/gi,'').replace(/display: inline/gi,'display:inline').replace(/; cursor: pointer;/gi,'').replace(/ cursor: pointer;/gi,'').replace(/cursor: pointer;/gi,'').replace(/ class=""/gi,'').replace(/class=""/gi,'').replace(/ class>/gi,'>').replace(/class>/gi,'>').replace(/<!-- selection outer line.*?}/,'');

        for (let i=0; i < svg_rendered_sub_arr.length; i++) {
            new_text = new_text.replace(/<g><use xlink:href.*?<\/g>/,'');
        };

        return new_text;
    };

    // копирование кода svg;
    function copy_svg() {
        navigator.clipboard.writeText(prepare_svg_code_from_text(block.innerHTML))
            // .then(() => {
            // console.log('Скопировано')
            // })
    };


    // возврат кнопки в исходное состояние;
    function btn_back_org_state() {
        copyButton.classList.remove('btn_feedback');
        copyButton.innerText = 'Скопировать';
        copyButton.disabled = false;
    };

    // слушатель на кнопку «Скопировать»;
    copyButton.addEventListener('click', function() {
        copy_svg();
        copyButton.innerText = 'Скопировано';
        copyButton.classList.add('btn_feedback');
        copyButton.disabled = true;
        setTimeout(btn_back_org_state, 1500);
    });


    function download_file() {
        var blob = new Blob([prepare_svg_code_from_text (block.innerHTML)], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'Object_' + svg_rendered_sub_qnty().toString() + 's.svg';
        document.body.appendChild(a); // Добавляем на страницу нашу свежесозданную ссылку.
        a.click(); // Инициируем клик по ссылке, чтобы начать загрузку файла.
        document.body.removeChild(a); // После инициирования загрузки убираем ссылку.
    }
    

    // слушатель на кнопку «Создать svg»;
    createButton.addEventListener('click', function() {
        download_file();
    });

    



  
    


    



})