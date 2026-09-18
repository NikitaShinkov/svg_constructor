// Indicator symbol libraries, one per prepared size.
//
// KOMPAKS does not read a `scale` transform, so indicators cannot be resized by
// scaling: each size is its own set of paths. These were lifted verbatim from
// src_doc/svg_constructor/scripts for different indicators sizes, whose 45px
// set is byte-identical to the reference files.

export const INDICATOR_SIZES = [20, 24, 28, 32, 38, 45, 60];

export const INDICATORS = {
    20: {
        strokeWidth: 1.6,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="10" cy="10" r="9.2" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M8.11,15.48c0-1.14.76-1.93,1.94-1.93,1.1,0,1.86.78,1.86,1.93,0,1.07-.76,1.93-1.86,1.93-1.18,0-1.94-.85-1.94-1.93ZM8.8,12.48h0l-.48-9.64h3.38l-.48,9.64h-2.41Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M12.69,10.59l-2.53-.54-.52-2.48,2.6-2.55c-.39-.07-.71-.13-1.1-.2-2.4,0-4.67,2.28-4.67,4.7,0,.54.13,1.01.26,1.48l-4.33,4.17c.77,1.14,1.79,2.08,2.98,2.78l4.27-4.2.07-.07c.33.07.65.13,1.04.13,2.4,0,4.67-2.28,4.67-4.7.07-.34,0-.68-.13-1.08l-2.59,2.55Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M5.37,4.64v10.45h10.01v.8H4.57V4.63h.8ZM12.2,8.45c-.24,3.03-3.13,5.07-6.17,4.58v1.57c3.94.48,7.34-2.26,7.67-5.97.71.1,1.04.15,1.84.26l-.99-2.42-.99-2.42-1.6,2.07-1.6,2.07c.82.12,1.01.14,1.84.25h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M10.3,9.97l-4.73,3.77v-7.53l4.73,3.77ZM15.72,9.97l-4.73,3.77v-7.53l4.73,3.77Z"></path>
        </g>`,
    },
    24: {
        strokeWidth: 2,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="12" cy="12" r="11" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M9.78,18.25c0-1.3.86-2.19,2.2-2.19,1.25,0,2.12.89,2.12,2.19,0,1.22-.86,2.19-2.12,2.19-1.34,0-2.2-.97-2.2-2.19ZM10.57,14.84h0l-.55-10.95h3.84l-.55,10.95h-2.74Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M14.99,12.7l-2.88-.61-.59-2.82,2.95-2.9c-.44-.08-.81-.15-1.25-.23-2.73,0-5.31,2.59-5.31,5.34,0,.61.15,1.15.3,1.68l-5.27,5.07c.88,1.28,2.04,2.36,3.37,3.17l5.21-5.12.07-.07c.37.07.74.15,1.18.15,2.73,0,5.31-2.59,5.31-5.34.08-.39,0-.77-.15-1.23l-2.95,2.9Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M6.68,5.95v11.87h11.37v.9H5.77V5.93h.91ZM14.44,10.27c-.27,3.44-3.56,5.76-7.02,5.21v1.79c4.48.55,8.34-2.57,8.71-6.78.8.11,1.18.17,2.09.3l-1.12-2.75-1.12-2.75-1.82,2.35-1.82,2.35c.94.13,1.15.16,2.09.29h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M12.27,12l-5.37,4.28V7.72l5.37,4.28ZM18.44,12l-5.38,4.28V7.72l5.38,4.28Z"></path>
        </g>`,
    },
    28: {
        strokeWidth: 2.1,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="14" cy="14" r="12.95" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M11.33,21.54c0-1.61,1.07-2.71,2.72-2.71,1.55,0,2.62,1.1,2.62,2.71,0,1.51-1.07,2.71-2.62,2.71-1.66,0-2.72-1.2-2.72-2.71ZM12.3,17.31h0l-.68-13.56h4.76l-.68,13.56h-3.39Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M17.78,14.82l-3.56-.76-.73-3.49,3.65-3.59c-.54-.1-1-.19-1.55-.29-3.38,0-6.58,3.21-6.58,6.61,0,.76.18,1.42.37,2.08l-6.1,5.87c1.08,1.6,2.52,2.93,4.19,3.91l6.02-5.91.09-.09c.46.09.92.19,1.46.19,3.38,0,6.58-3.21,6.58-6.61.1-.48,0-.95-.18-1.52l-3.65,3.59Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M7.41,6.5v14.7h14.09v1.12H6.28V6.48l1.13.02ZM17.02,11.85c-.34,4.27-4.41,7.14-8.69,6.45v2.21c5.54.68,10.33-3.18,10.79-8.4.99.14,1.46.21,2.59.37l-1.39-3.4-1.39-3.41-2.25,2.91-2.25,2.91c1.16.16,1.43.2,2.59.35h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M14.42,14l-6.66,5.3v-10.6l6.66,5.3ZM22.05,14l-6.66,5.3v-10.6l6.66,5.3Z"></path>
        </g>`,
    },
    32: {
        strokeWidth: 2.4,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="16" cy="16" r="14.8" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M12.95,24.61c0-1.84,1.22-3.1,3.11-3.1,1.78,0,2.99,1.26,2.99,3.1,0,1.73-1.22,3.1-2.99,3.1-1.89,0-3.11-1.37-3.11-3.1ZM14.06,19.79h0l-.78-15.5h5.44l-.78,15.5h-3.88Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M20.32,16.94l-4.07-.86-.84-3.99,4.18-4.1c-.62-.11-1.15-.22-1.77-.33-3.86,0-7.51,3.67-7.51,7.55,0,.86.21,1.62.42,2.38l-6.97,6.71c1.24,1.83,2.88,3.35,4.79,4.47l6.88-6.75.1-.1c.52.1,1.05.22,1.67.22,3.86,0,7.51-3.67,7.51-7.55.11-.55,0-1.09-.21-1.73l-4.17,4.1Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M8.47,7.43v16.81h16.1v1.28H7.18V7.41l1.29.02ZM19.45,13.55c-.38,4.88-5.04,8.16-9.93,7.37v2.53c6.34.78,11.8-3.64,12.33-9.6,1.13.16,1.67.25,2.97.42l-1.59-3.89-1.59-3.89-2.57,3.33-2.57,3.32c1.33.19,1.63.23,2.97.4h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M16.48,16l-7.61,6.06v-12.12l7.61,6.06ZM25.2,16l-7.62,6.06v-12.12l7.62,6.06Z"></path>
        </g>`,
    },
    38: {
        strokeWidth: 2.9,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="19" cy="19" r="17.55" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M15.46,28.98c0-2.07,1.37-3.49,3.51-3.49,2,0,3.37,1.42,3.37,3.49,0,1.95-1.37,3.49-3.37,3.49-2.13,0-3.51-1.55-3.51-3.49ZM16.72,23.54h0l-.88-17.47h6.13l-.88,17.47h-4.37Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M24.81,19.75l-5.15-1.09-1.06-5.05,5.29-5.2c-.79-.14-1.45-.27-2.25-.41-4.89,0-9.51,4.65-9.51,9.56,0,1.09.27,2.05.53,3.01l-8.34,8.03c1.53,2.34,3.6,4.29,6.04,5.67l8.24-8.09.13-.13c.66.13,1.33.27,2.11.27,4.89,0,9.51-4.65,9.51-9.56.14-.7,0-1.38-.27-2.2l-5.28,5.2Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M10.49,9.32v18.97h18.18v1.45H9.04V9.3l1.45.02ZM22.9,16.23c-.43,5.51-5.69,9.21-11.21,8.32v2.85c7.15.88,13.33-4.11,13.93-10.84,1.28.18,1.89.28,3.35.48l-1.8-4.39-1.8-4.4-2.91,3.76-2.91,3.75c1.5.21,1.84.25,3.35.46h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M19.36,19l-9.63,7.67v-15.34l9.63,7.67ZM30.4,19l-9.64,7.67v-15.34l9.64,7.67Z"></path>
        </g>`,
    },
    45: {
        strokeWidth: 3.4,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="22.5" cy="22.5" r="20.8" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M18.31,34.32c0-2.46,1.63-4.14,4.16-4.14,2.37,0,4,1.68,4,4.14,0,2.31-1.63,4.14-4,4.14-2.53,0-4.16-1.83-4.16-4.14ZM19.79,27.88h0l-1.04-20.7h7.26l-1.04,20.7h-5.18Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M29.38,23.38l-6.11-1.3-1.26-5.99,6.27-6.16c-.93-.17-1.72-.32-2.66-.49-5.79,0-11.27,5.51-11.27,11.33,0,1.3.31,2.44.63,3.57l-9.88,9.52c1.81,2.77,4.27,5.08,7.16,6.72l9.77-9.59.16-.16c.79.16,1.57.32,2.5.32,5.79,0,11.27-5.51,11.27-11.33.17-.82,0-1.63-.31-2.6l-6.26,6.16Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M12.42,11.03v22.49h21.55l-.02,1.71H10.7V11l1.72.03ZM27.12,19.22c-.51,6.53-6.75,10.92-13.29,9.86v3.38c8.48,1.04,15.79-4.87,16.5-12.85,1.52.21,2.24.33,3.97.57l-2.13-5.2-2.13-5.21-3.44,4.46-3.44,4.45c1.78.25,2.18.3,3.97.54h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M22.93,22.5l-11.42,9.09V13.41l11.42,9.09ZM36.02,22.5l-11.43,9.09V13.41l11.43,9.09Z"></path>
        </g>`,
    },
    60: {
        strokeWidth: 4.6,
        icons: `        <!--indicators-->
        <g id="circle" class="scale">
            <circle cx="30" cy="30" r="27.7" class="icons_st_out"></circle>
        </g>
        <g id="fail">
            <use xlink:href="#circle" class="fail"></use>
            <path class="icon_w scale" d="M24.42,45.75c0-3.27,2.17-5.51,5.54-5.51,3.16,0,5.33,2.24,5.33,5.51,0,3.07-2.17,5.51-5.33,5.51-3.37,0-5.54-2.44-5.54-5.51ZM26.4,37.16h0l-1.39-27.57h9.67l-1.39,27.57h-6.9Z"></path>
        </g>
        <g id="old_repair">
            <use xlink:href="#circle" class="repair"></use>
            <path class="icon_w scale" d="M39.16,31.18l-8.14-1.73-1.67-7.98,8.34-8.2c-1.24-.22-2.29-.43-3.54-.65-7.72,0-15.01,7.34-15.01,15.09,0,1.73.42,3.24.84,4.75l-13.17,12.68c2.41,3.69,5.68,6.77,9.53,8.95l13.02-12.78.21-.21c1.05.21,2.09.43,3.34.43,7.72,0,15.01-7.34,15.01-15.09.22-1.1,0-2.17-.42-3.47l-8.33,8.2Z"></path>
        </g>
        <g id="old_lock_icon" class="scale">
            <path d="M16.24,14.34v30.7h29.42l-.02,2.34H13.88V14.3l2.35.04ZM36.31,25.51c-.7,8.91-9.21,14.91-18.15,13.47v4.62c11.58,1.42,21.56-6.64,22.53-17.54,2.07.29,3.05.45,5.42.78l-2.91-7.1-2.91-7.12-4.7,6.09-4.7,6.07c2.42.34,2.98.41,5.42.74h0Z"></path>
        </g>
        <g id="old_lock_norm">
            <use xlink:href="#circle" class="norm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_tpm">
            <use xlink:href="#circle" class="tpm"></use>
            <use xlink:href="#old_lock_icon" class="icon_b"></use>
        </g>
        <g id="old_lock_ndp">
            <use xlink:href="#circle" class="ndp"></use>
            <use xlink:href="#old_lock_icon" class="icon_w"></use>
        </g>
        <g id="insert">
            <use xlink:href="#circle" class="insert"></use>
            <path class="icon_w scale" d="M30.57,30l-15.21,12.1v-24.21l15.21,12.1ZM48,30l-15.22,12.1v-24.21l15.22,12.1Z"></path>
        </g>`,
    },
};
