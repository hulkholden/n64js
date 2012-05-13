if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var graphics_task_count = 0;

  var $dlistOutput = $('#dlist-content');

  var viWidth      = 320;
  var viHeight     = 240;

  var kOffset_type                = 0x00;    // u32
  var kOffset_flags               = 0x04;    // u32
  var kOffset_ucode_boot          = 0x08;    // u64*
  var kOffset_ucode_boot_size     = 0x0c;    // u32
  var kOffset_ucode               = 0x10;    // u64*
  var kOffset_ucode_size          = 0x14;    // u32
  var kOffset_ucode_data          = 0x18;    // u64*
  var kOffset_ucode_data_size     = 0x1c;    // u32
  var kOffset_dram_stack          = 0x20;    // u64*
  var kOffset_dram_stack_size     = 0x24;    // u32
  var kOffset_output_buff         = 0x28;    // u64*
  var kOffset_output_buff_size    = 0x2c;    // u64*
  var kOffset_data_ptr            = 0x30;    // u64*
  var kOffset_data_size           = 0x34;    // u32
  var kOffset_yield_data_ptr      = 0x38;    // u64*
  var kOffset_yield_data_size     = 0x3c;    // u32

  var G_MW_MATRIX                 = 0x00;
  var G_MW_NUMLIGHT               = 0x02;
  var G_MW_CLIP                   = 0x04;
  var G_MW_SEGMENT                = 0x06;
  var G_MW_FOG                    = 0x08;
  var G_MW_LIGHTCOL               = 0x0a;
  var G_MW_POINTS                 = 0x0c;
  var G_MW_PERSPNORM              = 0x0e;

  var kUcodeStrides = [
    10,   // Super Mario 64, Tetrisphere, Demos
    2,    // Mario Kart, Star Fox
    2,    // Zelda, and newer games
    2,    // Yoshi's Story, Pokemon Puzzle League
    2,    // Neon Evangelion, Kirby
    5,    // Wave Racer USA
    10,   // Diddy Kong Racing, Gemini, and Mickey
    2,    // Last Legion, Toukon, Toukon 2
    5,    // Shadows of the Empire (SOTE)
    10,   // Golden Eye
    2,    // Conker BFD
    10,   // Perfect Dark
  ];

  // Configured:
  var config = {
    vertexStride:  10,
  };

  var state = {
    pc:             0,
    dlistStack:     [],
    segments:       [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    geometryMode:   0,
    rdpOtherModeL:  0,
    rdpOtherModeH:  0,

    scissor: {
      mode:         0,
      x0:           0,
      y0:           0,
      x1:           viWidth,
      y1:           viHeight
    },

    texture: {
      tile:         0,
      level:        0,
      enable:       0,
      scaleS:       1.0,
      scaleT:       1.0,
    },

    combine: {
      lo: 0,
      hi: 0
    },

    fillColor:      0,

    colorImage: {
      format:   0,
      size:     0,
      width:    0,
      address:  0
    },

    depthImage: {
      address:  0
    },

    screenContext2d: null   // canvas context
  };

  function rdpSegmentAddress(addr) {
    var segment = (addr>>>24)&0xf;
    return (state.segments[segment]&0x00ffffff) + (addr & 0x00ffffff);
  }

  function makeRGBFromRGBA16(col) {
    var r = ((col>>>11)&0x1f)<<3;
    var g = ((col>>> 6)&0x1f)<<3;
    var b = ((col>>> 1)&0x1f)<<3;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function makeRGBFromRGBA32(col) {
    var r = ((col>>>24)&0xff);
    var g = ((col>>>16)&0xff);
    var b = ((col>>> 8)&0xff);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // task, ram are both DataView objects
  n64js.RSPHLEProcessTask = function(task, ram) {
    var M_GFXTASK = 1;
    var M_AUDTASK = 2;
    var M_VIDTASK = 3;
    var M_JPGTASK = 4;

    var type = task.getUint32(kOffset_type);
    switch (type) {
      case M_GFXTASK:
        n64js.log('graphics task ' + graphics_task_count);
        hleGraphics(task, ram);
        ++graphics_task_count;
        n64js.interruptDP();
        break;
      case M_AUDTASK:
        //n64js.log('audio task');
        break;
      case M_VIDTASK:
        n64js.log('video task');
        break;
      case M_JPGTASK:
        n64js.log('jpg task');
        break;

      default:
        n64js.log('unknown task');
        break;
    }

    n64js.haltSP();
  }

  function detectVersionString(ram, data_base, data_size) {
    var r = 'R'.charCodeAt(0);
    var s = 'S'.charCodeAt(0);
    var p = 'P'.charCodeAt(0);

    for (var i = 0; i+2 < data_size; ++i) {
      if (ram.getInt8(data_base+i+0) == r &&
          ram.getInt8(data_base+i+1) == s &&
          ram.getInt8(data_base+i+2) == p) {
        var str = '';
        for (var p = i; p < data_size; ++p) {
          var c = ram.getInt8(data_base+p);
          if (c == 0)
            return str;

          str += String.fromCharCode(c);
        }
      }
    }
    return '';
  }


  function unimplemented(cmd0,cmd1) {
    n64js.halt('Unimplemented display list op ' + disassembleCommand(cmd0,cmd1));
  }

  function executeUnknown(cmd0,cmd1) {
    n64js.halt('Unknown display list op ' + disassembleCommand(cmd0,cmd1));
  }

  function executeSpNoop(cmd0,cmd1)             {}
  function executeNoop(cmd0,cmd1)               {}
  function executeRDPLoadSync(cmd0,cmd1)        {}
  function executeRDPPipeSync(cmd0,cmd1)        {}
  function executeRDPTileSync(cmd0,cmd1)        {}
  function executeRDPFullSync(cmd0,cmd1)        {}

  function executeDL(cmd0,cmd1)                   { unimplemented(cmd0,cmd1); }
  function executeEndDL(cmd0,cmd1) {
    if (state.dlistStack.length > 0) {
      state.pc = state.dlistStack.pop();
    } else {
      state.pc = 0;
    }
  }

  function executeMtx(cmd0,cmd1)                  { unimplemented(cmd0,cmd1); }
  function executeMoveMem(cmd0,cmd1)              { unimplemented(cmd0,cmd1); }


  function executeMoveWord(cmd0,cmd1) {
    var type   = (cmd0    )&0xff;
    var offset = (cmd0>>>8)&0xffff;
    var value  = cmd1;

    switch(type) {
      case G_MW_MATRIX:     unimplemented(cmd0,cmd1); break;
      case G_MW_NUMLIGHT:   state.numLights = ((value - 0x80000000)>>>5) - 1; break;
      case G_MW_CLIP:       unimplemented(cmd0,cmd1); break;
      case G_MW_SEGMENT:    state.segments[((offset >>> 2)&0xf)] = value; break;
      case G_MW_FOG:        unimplemented(cmd0,cmd1); break;
      case G_MW_LIGHTCOL:   unimplemented(cmd0,cmd1); break;
      case G_MW_POINTS:     unimplemented(cmd0,cmd1); break;
      default:              unimplemented(cmd0,cmd1); break;
    }
   }

  function executeVtx(cmd0,cmd1)                  { unimplemented(cmd0,cmd1); }
  function executeSprite2DBase(cmd0,cmd1)         { unimplemented(cmd0,cmd1); }
  function executeTri4(cmd0,cmd1)                 { unimplemented(cmd0,cmd1); }
  function executeRDPHalf_Cont(cmd0,cmd1)         { unimplemented(cmd0,cmd1); }
  function executeRDPHalf_2(cmd0,cmd1)            { unimplemented(cmd0,cmd1); }
  function executeRDPHalf_1(cmd0,cmd1)            { unimplemented(cmd0,cmd1); }
  function executeLine3D(cmd0,cmd1)               { unimplemented(cmd0,cmd1); }
  function executeClrGeometryMode(cmd0,cmd1) {
    state.geometryMode &= ~cmd1;
  }
  function executeSetGeometryMode(cmd0,cmd1) {
    state.geometryMode |= cmd1;
  }

  function executeSetOtherModeL(cmd0,cmd1) {
    var shift = (cmd0>>> 8)&0xff;
    var len   = (cmd0>>> 0)&0xff;
    var data  = cmd1;
    var mask = ((1 << len) - 1) << shift;
    state.rdpOtherModeL = (state.rdpOtherModeL & ~mask) | data;
  }
  function executeSetOtherModeH(cmd0,cmd1) {
    var shift = (cmd0>>> 8)&0xff;
    var len   = (cmd0>>> 0)&0xff;
    var data  = cmd1;
    var mask = ((1 << len) - 1) << shift;
    state.rdpOtherModeH = (state.rdpOtherModeH & ~mask) | data;
  }  

  function executeTexture(cmd0,cmd1) {
    //var xparam  =  (cmd0>>>16)&0xff;
    state.level   =  (cmd0>>>11)&0x3;
    state.tile    =  (cmd0>>> 8)&0x7;
    state.enable  =  (cmd0>>> 0)&0xff;
    state.scaleS  = ((cmd1>>>16)&0xffff) / (65535.0 * 32.0);
    state.scaleT  = ((cmd1>>> 0)&0xffff) / (65535.0 * 32.0);
  }

  function executePopMtx(cmd0,cmd1)               { unimplemented(cmd0,cmd1); }
  function executeCullDL(cmd0,cmd1)               { unimplemented(cmd0,cmd1); }
  function executeTri1(cmd0,cmd1)                 { unimplemented(cmd0,cmd1); }
  function executeTriRSP(cmd0,cmd1)               { unimplemented(cmd0,cmd1); }
  function executeTexRect(cmd0,cmd1)              { unimplemented(cmd0,cmd1); }
  function executeTexRectFlip(cmd0,cmd1)          { unimplemented(cmd0,cmd1); }
  function executeSetKeyGB(cmd0,cmd1)             { unimplemented(cmd0,cmd1); }
  function executeSetKeyR(cmd0,cmd1)              { unimplemented(cmd0,cmd1); }
  function executeSetConvert(cmd0,cmd1)           { unimplemented(cmd0,cmd1); }

  function executeSetScissor(cmd0,cmd1) {
    state.scissor.x0   = ((cmd0>>>12)&0xfff)/4.0;
    state.scissor.y0   = ((cmd0>>> 0)&0xfff)/4.0;
    state.scissor.x1   = ((cmd1>>>12)&0xfff)/4.0;
    state.scissor.y1   = ((cmd1>>> 0)&0xfff)/4.0;
    state.scissor.mode = (cmd1>>>24)&0x2;

    // TODO: actually set this
  }

  function executeSetPrimDepth(cmd0,cmd1)         { unimplemented(cmd0,cmd1); }
  function executeSetRDPOtherMode(cmd0,cmd1)      { unimplemented(cmd0,cmd1); }
  function executeLoadTLut(cmd0,cmd1)             { unimplemented(cmd0,cmd1); }
  function executeSetTileSize(cmd0,cmd1)          { unimplemented(cmd0,cmd1); }
  function executeLoadBlock(cmd0,cmd1)            { unimplemented(cmd0,cmd1); }
  function executeLoadTile(cmd0,cmd1)             { unimplemented(cmd0,cmd1); }
  function executeSetTile(cmd0,cmd1)              { unimplemented(cmd0,cmd1); }
  function executeFillRect(cmd0,cmd1) {

    // NB: fraction is ignored
    var x0 = ((cmd1>>>12)&0xfff)>>>2;
    var y0 = ((cmd1>>> 0)&0xfff)>>>2;
    var x1 = ((cmd0>>>12)&0xfff)>>>2;
    var y1 = ((cmd0>>> 0)&0xfff)>>>2;

    if (state.depthImage.address == state.colorImage.address) {
      // FIXME clear the z buffer
      return;
    }

    var color = 'rgb(0,0,0)';

    var cycle_type = getCycleType();

    if (cycle_type === cycleTypeValues.G_CYC_FILL) {
      x1 += 1;
      y1 += 1;

      if (state.colorImage.size === imageSizeTypes.G_IM_SIZ_16b) {
        color = makeRGBFromRGBA16(state.fillColor & 0xffff);
      } else {
        color = makeRGBFromRGBA32(state.fillColor);
      }

      // Clear whole screen in one?
      if (viWidth === (x1-x0) && viHeight === (y1-y0)) {
        state.screenContext2d.fillStyle = color;
        state.screenContext2d.fillRect(x0, y0, x1-x0, y1-y0);
        return;
      }
    } else if (cycle_type === cycleTypeValues.G_CYC_COPY) {
      x1 += 1;
      y1 += 1;
    }

    state.screenContext2d.fillStyle = color;
    state.screenContext2d.fillRect(x0, y0, x1-x0, y1-y0);

  }


  function executeSetFillColor(cmd0,cmd1) {
    state.fillColor = cmd1;
  }

  function executeSetFogColor(cmd0,cmd1)          { unimplemented(cmd0,cmd1); }
  function executeSetBlendColor(cmd0,cmd1)        { unimplemented(cmd0,cmd1); }
  function executeSetPrimColor(cmd0,cmd1)         { unimplemented(cmd0,cmd1); }
  function executeSetEnvColor(cmd0,cmd1)          { unimplemented(cmd0,cmd1); }
  function executeSetCombine(cmd0,cmd1) {
    state.combine.hi = cmd0 & 0x00ffffff;
    state.combine.lo = cmd1;
  }
  function executeSetTImg(cmd0,cmd1)              { unimplemented(cmd0,cmd1); }
  function executeSetZImg(cmd0,cmd1) {
    state.depthImage.address = rdpSegmentAddress(cmd1);
  }

  function executeSetCImg(cmd0,cmd1) {
    state.colorImage = {
      format:   (cmd0>>>21)&0x7,
      size:     (cmd0>>>19)&0x3,
      width:   ((cmd0>>> 0)&0xfff)+1,
      address:   rdpSegmentAddress(cmd1)
    };
  }



  function  cmd_cmd(a,b) { return a>>>24; }
  function  dlist_param(a,b) { return ((a>>>16)&0xff) === 0 ? 'call' : 'jump';}
  function  dlist_address(a,b) { return n64js.toString32(b);}


  var G_MWO_NUMLIGHT          = 0x00;
  var G_MWO_CLIP_RNX          = 0x04;
  var G_MWO_CLIP_RNY          = 0x0c;
  var G_MWO_CLIP_RPX          = 0x14;
  var G_MWO_CLIP_RPY          = 0x1c;
  var G_MWO_SEGMENT_0         = 0x00;
  var G_MWO_SEGMENT_1         = 0x01;
  var G_MWO_SEGMENT_2         = 0x02;
  var G_MWO_SEGMENT_3         = 0x03;
  var G_MWO_SEGMENT_4         = 0x04;
  var G_MWO_SEGMENT_5         = 0x05;
  var G_MWO_SEGMENT_6         = 0x06;
  var G_MWO_SEGMENT_7         = 0x07;
  var G_MWO_SEGMENT_8         = 0x08;
  var G_MWO_SEGMENT_9         = 0x09;
  var G_MWO_SEGMENT_A         = 0x0a;
  var G_MWO_SEGMENT_B         = 0x0b;
  var G_MWO_SEGMENT_C         = 0x0c;
  var G_MWO_SEGMENT_D         = 0x0d;
  var G_MWO_SEGMENT_E         = 0x0e;
  var G_MWO_SEGMENT_F         = 0x0f;
  var G_MWO_FOG               = 0x00;
  var G_MWO_aLIGHT_1          = 0x00;
  var G_MWO_bLIGHT_1          = 0x04;
  var G_MWO_aLIGHT_2          = 0x20;
  var G_MWO_bLIGHT_2          = 0x24;
  var G_MWO_aLIGHT_3          = 0x40;
  var G_MWO_bLIGHT_3          = 0x44;
  var G_MWO_aLIGHT_4          = 0x60;
  var G_MWO_bLIGHT_4          = 0x64;
  var G_MWO_aLIGHT_5          = 0x80;
  var G_MWO_bLIGHT_5          = 0x84;
  var G_MWO_aLIGHT_6          = 0xa0;
  var G_MWO_bLIGHT_6          = 0xa4;
  var G_MWO_aLIGHT_7          = 0xc0;
  var G_MWO_bLIGHT_7          = 0xc4;
  var G_MWO_aLIGHT_8          = 0xe0;
  var G_MWO_bLIGHT_8          = 0xe4;
  var G_MWO_MATRIX_XX_XY_I    = 0x00;
  var G_MWO_MATRIX_XZ_XW_I    = 0x04;
  var G_MWO_MATRIX_YX_YY_I    = 0x08;
  var G_MWO_MATRIX_YZ_YW_I    = 0x0c;
  var G_MWO_MATRIX_ZX_ZY_I    = 0x10;
  var G_MWO_MATRIX_ZZ_ZW_I    = 0x14;
  var G_MWO_MATRIX_WX_WY_I    = 0x18;
  var G_MWO_MATRIX_WZ_WW_I    = 0x1c;
  var G_MWO_MATRIX_XX_XY_F    = 0x20;
  var G_MWO_MATRIX_XZ_XW_F    = 0x24;
  var G_MWO_MATRIX_YX_YY_F    = 0x28;
  var G_MWO_MATRIX_YZ_YW_F    = 0x2c;
  var G_MWO_MATRIX_ZX_ZY_F    = 0x30;
  var G_MWO_MATRIX_ZZ_ZW_F    = 0x34;
  var G_MWO_MATRIX_WX_WY_F    = 0x38;
  var G_MWO_MATRIX_WZ_WW_F    = 0x3c;
  var G_MWO_POINT_RGBA        = 0x10;
  var G_MWO_POINT_ST          = 0x14;
  var G_MWO_POINT_XYSCREEN    = 0x18;
  var G_MWO_POINT_ZSCREEN     = 0x1c;

  var numLightValues = {
    //NUMLIGHTS_0: 1,
    NUMLIGHTS_1: 1,
    NUMLIGHTS_2: 2,
    NUMLIGHTS_3: 3,
    NUMLIGHTS_4: 4,
    NUMLIGHTS_5: 5,
    NUMLIGHTS_6: 6,
    NUMLIGHTS_7: 7,
  }

  function disassembleMoveWord(cmd0,cmd1) {

    var type   = (cmd0    )&0xff;
    var offset = (cmd0>>>8)&0xffff;
    var value  = cmd1;

    switch(type) {
      case G_MW_NUMLIGHT:
        if (offset === G_MWO_NUMLIGHT) {
          var v = ((value - 0x80000000)>>>5) - 1;
          return 'gsSPNumLights(' + getDefine(numLightValues, v) + ');';
        }
        break;
      case G_MW_SEGMENT:
        {
          var v = value === 0 ? '0' : n64js.toString32(value);
          return 'gsSPSegment(' + ((offset >>> 2)&0xf) + ', ' + v + ');';
        }
        break;
    }


    var r = 'gMoveWd(';
    switch(type) {
      case G_MW_MATRIX:     r += 'G_MW_MATRIX';           break;
      case G_MW_NUMLIGHT:   r += 'G_MW_NUMLIGHT';         break;
      case G_MW_CLIP:       r += 'G_MW_CLIP';             break;
      case G_MW_SEGMENT:    r += 'G_MW_SEGMENT';          break;
      case G_MW_FOG:        r += 'G_MW_FOG';              break;
      case G_MW_LIGHTCOL:   r += 'G_MW_LIGHTCOL';         break;
      case G_MW_POINTS:     r += 'G_MW_POINTS';           break;
      default:              r += n64js.toString8(type);   break;
    }
    r += n64js.toString16(offset) + ', ' + n64js.toString32(value) + ')';

    return r;
  }

  var geometryModeFlags = {
    G_ZBUFFER:            0x00000001,
    G_TEXTURE_ENABLE:     0x00000002,  /* Microcode use only */
    G_SHADE:              0x00000004,  /* enable Gouraud interp */
    G_SHADING_SMOOTH:     0x00000200,  /* flat or smooth shaded */
    G_CULL_FRONT:         0x00001000,
    G_CULL_BACK:          0x00002000,
    G_CULL_BOTH:          0x00003000,  /* To make code cleaner */
    G_FOG:                0x00010000,
    G_LIGHTING:           0x00020000,
    G_TEXTURE_GEN:        0x00040000,
    G_TEXTURE_GEN_LINEAR: 0x00080000,
    G_LOD:                0x00100000  /* NOT IMPLEMENTED */

  };

  function getGeometryMode(data) {
    var t = '';

    if (data & geometryModeFlags.G_ZBUFFER)               t += '|G_ZBUFFER';
    if (data & geometryModeFlags.G_TEXTURE_ENABLE)        t += '|G_TEXTURE_ENABLE';
    if (data & geometryModeFlags.G_SHADE)                 t += '|G_SHADE';
    if (data & geometryModeFlags.G_SHADING_SMOOTH)        t += '|G_SHADING_SMOOTH';

    var cull = data & 0x00003000;
         if (cull === geometryModeFlags.G_CULL_FRONT)     t += '|G_CULL_FRONT';
    else if (cull === geometryModeFlags.G_CULL_BACK)      t += '|G_CULL_BACK';
    else if (cull === geometryModeFlags.G_CULL_BOTH)      t += '|G_CULL_BOTH';

    if (data & geometryModeFlags.G_FOG)                   t += '|G_FOG';
    if (data & geometryModeFlags.G_LIGHTING)              t += '|G_LIGHTING';
    if (data & geometryModeFlags.G_TEXTURE_GEN)           t += '|G_TEXTURE_GEN';
    if (data & geometryModeFlags.G_TEXTURE_GEN_LINEAR)    t += '|G_TEXTURE_GEN_LINEAR';
    if (data & geometryModeFlags.G_LOD)                   t += '|G_LOD';

    return t.length > 0 ? t.substr(1) : '0';
  }

  function disassembleSetGeometryMode(a,b) {
    return 'gsSPSetGeometryMode(' + getGeometryMode(b) + ');'
  }

  function disassembleClearGeometryMode(a,b) {
    return 'gsSPClearGeometryMode(' + getGeometryMode(b) + ');'
  }

  // G_SETOTHERMODE_L sft: shift count
  var G_MDSFT_ALPHACOMPARE    = 0;
  var G_MDSFT_ZSRCSEL         = 2;
  var G_MDSFT_RENDERMODE      = 3;
  var G_MDSFT_BLENDER         = 16;


  //G_SETOTHERMODE_H shift count
  var G_MDSFT_BLENDMASK       = 0;
  var G_MDSFT_ALPHADITHER     = 4;
  var G_MDSFT_RGBDITHER       = 6;

  var G_MDSFT_COMBKEY         = 8;
  var G_MDSFT_TEXTCONV        = 9;
  var G_MDSFT_TEXTFILT        = 12;
  var G_MDSFT_TEXTLUT         = 14;
  var G_MDSFT_TEXTLOD         = 16;
  var G_MDSFT_TEXTDETAIL      = 17;
  var G_MDSFT_TEXTPERSP       = 19;
  var G_MDSFT_CYCLETYPE       = 20;
  var G_MDSFT_COLORDITHER     = 22;
  var G_MDSFT_PIPELINE        = 23;

  function getCycleType() {
    return state.rdpOtherModeH & (3<<G_MDSFT_CYCLETYPE);
  }

  var pipelineModeValues = {
    G_PM_1PRIMITIVE:   1 << G_MDSFT_PIPELINE,
    G_PM_NPRIMITIVE:   0 << G_MDSFT_PIPELINE
  };

  var cycleTypeValues = {
    G_CYC_1CYCLE:     0 << G_MDSFT_CYCLETYPE,
    G_CYC_2CYCLE:     1 << G_MDSFT_CYCLETYPE,
    G_CYC_COPY:       2 << G_MDSFT_CYCLETYPE,
    G_CYC_FILL:       3 << G_MDSFT_CYCLETYPE
  };

  var texturePerspValues = {
    G_TP_NONE:        0 << G_MDSFT_TEXTPERSP,
    G_TP_PERSP:       1 << G_MDSFT_TEXTPERSP
  };

  var textureDetailValues = {
    G_TD_CLAMP:       0 << G_MDSFT_TEXTDETAIL,
    G_TD_SHARPEN:     1 << G_MDSFT_TEXTDETAIL,
    G_TD_DETAIL:      2 << G_MDSFT_TEXTDETAIL
  };

  var textureLODValues = {
    G_TL_TILE:        0 << G_MDSFT_TEXTLOD,
    G_TL_LOD:         1 << G_MDSFT_TEXTLOD
  };

  var textureLUTValues = {
    G_TT_NONE:        0 << G_MDSFT_TEXTLUT,
    G_TT_RGBA16:      2 << G_MDSFT_TEXTLUT,
    G_TT_IA16:        3 << G_MDSFT_TEXTLUT
  };

  var textureFilterValues = {
    G_TF_POINT:       0 << G_MDSFT_TEXTFILT,
    G_TF_AVERAGE:     3 << G_MDSFT_TEXTFILT,
    G_TF_BILERP:      2 << G_MDSFT_TEXTFILT
  };

  var textureConvertValues = {
    G_TC_CONV:       0 << G_MDSFT_TEXTCONV,
    G_TC_FILTCONV:   5 << G_MDSFT_TEXTCONV,
    G_TC_FILT:       6 << G_MDSFT_TEXTCONV
  };

  var combineKeyValues = {
    G_CK_NONE:        0 << G_MDSFT_COMBKEY,
    G_CK_KEY:         1 << G_MDSFT_COMBKEY
  };

  var colorDitherValues = {
    G_CD_MAGICSQ:     0 << G_MDSFT_RGBDITHER,
    G_CD_BAYER:       1 << G_MDSFT_RGBDITHER,
    G_CD_NOISE:       2 << G_MDSFT_RGBDITHER,
    G_CD_DISABLE:     3 << G_MDSFT_RGBDITHER
  };

  var alphaDitherValus = {
    G_AD_PATTERN:     0 << G_MDSFT_ALPHADITHER,
    G_AD_NOTPATTERN:  1 << G_MDSFT_ALPHADITHER,
    G_AD_NOISE:       2 << G_MDSFT_ALPHADITHER,
    G_AD_DISABLE:     3 << G_MDSFT_ALPHADITHER
  };

  var alphaCompareValues = {
    G_AC_NONE:          0 << G_MDSFT_ALPHACOMPARE,
    G_AC_THRESHOLD:     1 << G_MDSFT_ALPHACOMPARE,
    G_AC_DITHER:        3 << G_MDSFT_ALPHACOMPARE
  };

  var depthSourceValues = {
    G_ZS_PIXEL:         0 << G_MDSFT_ZSRCSEL,
    G_ZS_PRIM:          1 << G_MDSFT_ZSRCSEL
  };


  function getDefine(m, v) {
    for (var d in m) {
      if (m[d] === v)
        return d;
    }
    return n64js.toString32(v);
  }

  function getOtherModeLShiftCount(sft) {
    switch (sft) {

      case G_MDSFT_ALPHACOMPARE:  return 'G_MDSFT_ALPHACOMPARE';
      case G_MDSFT_ZSRCSEL:       return 'G_MDSFT_ZSRCSEL';
      case G_MDSFT_RENDERMODE:    return 'G_MDSFT_RENDERMODE';
      case G_MDSFT_BLENDER:       return 'G_MDSFT_BLENDER';
    }

    return n64js.toString8(sft);
  }

  function getOtherModeHShiftCount(sft) {
    switch (sft) {

      case G_MDSFT_BLENDMASK:   return 'G_MDSFT_BLENDMASK';
      case G_MDSFT_ALPHADITHER: return 'G_MDSFT_ALPHADITHER';
      case G_MDSFT_RGBDITHER:   return 'G_MDSFT_RGBDITHER';
      case G_MDSFT_COMBKEY:     return 'G_MDSFT_COMBKEY';
      case G_MDSFT_TEXTCONV:    return 'G_MDSFT_TEXTCONV';
      case G_MDSFT_TEXTFILT:    return 'G_MDSFT_TEXTFILT';
      case G_MDSFT_TEXTLUT:     return 'G_MDSFT_TEXTLUT';
      case G_MDSFT_TEXTLOD:     return 'G_MDSFT_TEXTLOD';
      case G_MDSFT_TEXTDETAIL:  return 'G_MDSFT_TEXTDETAIL';
      case G_MDSFT_TEXTPERSP:   return 'G_MDSFT_TEXTPERSP';
      case G_MDSFT_CYCLETYPE:   return 'G_MDSFT_CYCLETYPE';
      case G_MDSFT_COLORDITHER: return 'G_MDSFT_COLORDITHER';
      case G_MDSFT_PIPELINE:    return 'G_MDSFT_PIPELINE';
    }

    return n64js.toString8(sft);
  }

  var renderModeFlags = { 
    AA_EN:               0x0008,
    Z_CMP:               0x0010,
    Z_UPD:               0x0020,
    IM_RD:               0x0040,
    CLR_ON_CVG:          0x0080,
    CVG_DST_CLAMP:       0,
    CVG_DST_WRAP:        0x0100,
    CVG_DST_FULL:        0x0200,
    CVG_DST_SAVE:        0x0300,
    ZMODE_OPA:           0,
    ZMODE_INTER:         0x0400,
    ZMODE_XLU:           0x0800,
    ZMODE_DEC:           0x0c00,
    CVG_X_ALPHA:         0x1000,
    ALPHA_CVG_SEL:       0x2000,
    FORCE_BL:            0x4000,
    TEX_EDGE:            0x0000 /* used to be 0x8000 */
  };

  function getRenderMode(data) {
    var t = '';

    if (data & renderModeFlags.AA_EN)               t += '|AA_EN';
    if (data & renderModeFlags.Z_CMP)               t += '|Z_CMP';
    if (data & renderModeFlags.Z_UPD)               t += '|Z_UPD';
    if (data & renderModeFlags.IM_RD)               t += '|IM_RD';
    if (data & renderModeFlags.CLR_ON_CVG)          t += '|CLR_ON_CVG';

    var cvg = data & 0x0300;
         if (cvg === renderModeFlags.CVG_DST_CLAMP) t += '|CVG_DST_CLAMP';
    else if (cvg === renderModeFlags.CVG_DST_WRAP)  t += '|CVG_DST_WRAP';
    else if (cvg === renderModeFlags.CVG_DST_FULL)  t += '|CVG_DST_FULL';
    else if (cvg === renderModeFlags.CVG_DST_SAVE)  t += '|CVG_DST_SAVE';

    var zmode = data & 0x0c00;
         if (zmode === renderModeFlags.ZMODE_OPA)   t += '|ZMODE_OPA';
    else if (zmode === renderModeFlags.ZMODE_INTER) t += '|ZMODE_INTER';
    else if (zmode === renderModeFlags.ZMODE_XLU)   t += '|ZMODE_XLU';
    else if (zmode === renderModeFlags.ZMODE_DEC)   t += '|ZMODE_DEC';
  
    if (data & renderModeFlags.CVG_X_ALPHA)         t += '|CVG_X_ALPHA';
    if (data & renderModeFlags.ALPHA_CVG_SEL)       t += '|ALPHA_CVG_SEL';
    if (data & renderModeFlags.FORCE_BL)            t += '|FORCE_BL';

    return t.length > 0 ? t.substr(1) : '0';
  }


  function disassembleSetOtherModeL(cmd0, cmd1) {
    var cmd   = (cmd0>>>24)&0xff;
    var shift = (cmd0>>> 8)&0xff;
    var len   = (cmd0>>> 0)&0xff;
    var data  = cmd1;

    var data_str  = n64js.toString32(data);

    switch (shift) {
      case G_MDSFT_ALPHACOMPARE:  if (len === 2)  return 'gsDPSetAlphaCompare(' + getDefine(alphaCompareValues, data) + ');'; break;
      case G_MDSFT_ZSRCSEL:       if (len === 1)  return 'gsDPSetDepthSource('  + getDefine(depthSourceValues, data)  + ');'; break;
      case G_MDSFT_RENDERMODE:    if (len === 29) return 'gsDPSetRenderMode('   + getRenderMode(data) + ');'; break;
      //case G_MDSFT_BLENDER:     break;
    }


    var shift_str = getOtherModeLShiftCount(shift);

    return 'gsSPSetOtherMode(G_SETOTHERMODE_L, ' + shift_str + ', ' + len + ', ' + data_str + ')';
  }

  function disassembleSetOtherModeH(cmd0, cmd1) {
    var cmd   = (cmd0>>>24)&0xff;
    var shift = (cmd0>>> 8)&0xff;
    var len   = (cmd0>>> 0)&0xff;
    var data  = cmd1;

    switch (shift) {

      case G_MDSFT_BLENDMASK:   break; 
      case G_MDSFT_ALPHADITHER: if (len === 2) return 'gsDPSetAlphaDither('   + getDefine(alphaDitherValues, data)    + ');'; break;
      case G_MDSFT_RGBDITHER:   if (len === 2) return 'gsDPSetColorDither('   + getDefine(colorDitherValues, data)    + ');'; break;  // NB HW2?
      case G_MDSFT_COMBKEY:     if (len === 1) return 'gsDPSetCombineKey('    + getDefine(combineKeyValues,  data)    + ');'; break;
      case G_MDSFT_TEXTCONV:    if (len === 3) return 'gsDPSetTextureConvert('+ getDefine(textureConvertValues, data) + ');'; break;
      case G_MDSFT_TEXTFILT:    if (len === 2) return 'gsDPSetTextureFilter(' + getDefine(textureFilterValues, data)  + ');'; break;
      case G_MDSFT_TEXTLOD:     if (len === 1) return 'gsDPSetTextureLOD('    + getDefine(textureLODValues, data)     + ');'; break;
      case G_MDSFT_TEXTLUT:     if (len === 2) return 'gsDPSetTextureLUT('    + getDefine(textureLUTValues, data)     + ');'; break;
      case G_MDSFT_TEXTDETAIL:  if (len === 2) return 'gsDPSetTextureDetail(' + getDefine(textureDetailValues, data)  + ');'; break;
      case G_MDSFT_TEXTPERSP:   if (len === 1) return 'gsDPSetTexturePersp('  + getDefine(texturePerspValues, data)   + ');'; break;
      case G_MDSFT_CYCLETYPE:   if (len === 2) return 'gsDPSetCycleType('     + getDefine(cycleTypeValues, data)      + ');'; break;
      //case G_MDSFT_COLORDITHER: if (len === 1) return 'gsDPSetColorDither('   + data_str + ');'; break;  // NB HW1?
      case G_MDSFT_PIPELINE:    if (len === 1) return 'gsDPPipelineMode('     + getDefine(pipelineModeValues, data)   + ');'; break;
    }

    var shift_str = getOtherModeHShiftCount(shift);
    var data_str  = n64js.toString32(data);

    return 'gsSPSetOtherMode(G_SETOTHERMODE_H, ' + shift_str + ', ' + len + ', ' + data_str + ')';
  }

  var scissorModeValues = {
    G_SC_NON_INTERLACE:     0,
    G_SC_ODD_INTERLACE:     3,
    G_SC_EVEN_INTERLACE:    2
  };

  function disassembleSetScissor(cmd0, cmd1) {
    var x0   = ((cmd0>>>12)&0xfff)/4.0;
    var y0   = ((cmd0>>> 0)&0xfff)/4.0;
    var x1   = ((cmd1>>>12)&0xfff)/4.0;
    var y1   = ((cmd1>>> 0)&0xfff)/4.0;
    var mode = (cmd1>>>24)&0x2;

    return 'gsDPSetScissor(' + getDefine(scissorModeValues, mode) + ', ' + x0 + ', ' + y0 + ', ' + x1 + ', ' + y1 + ')';
  }

  function disassembleTexture(cmd0, cmd1) {

    var xparam  =  (cmd0>>>16)&0xff;
    var level   =  (cmd0>>>11)&0x3;
    var tile    =  (cmd0>>> 8)&0x7;
    var on      =  (cmd0>>> 0)&0xff;
    var s       = ((cmd1>>>16)&0xffff) / (65535.0 * 32.0);
    var t       = ((cmd1>>> 0)&0xffff) / (65535.0 * 32.0);

    if (xparam !== 0) {
      return 'gsSPTextureL(' + s + ', ' + t + ', ' + level + ', ' + xparam + ', ' + tile + ', ' + on + ');';
    }
    return 'gsSPTexture(' + s + ', ' + t + ', ' + level + ', ' + tile + ', ' + on + ');';
  }

  var imageFormatTypes = {
    G_IM_FMT_RGBA:    0,
    G_IM_FMT_YUV:     1,
    G_IM_FMT_CI:      2,
    G_IM_FMT_IA:      3,
    G_IM_FMT_I:       4
  };

  var imageSizeTypes = {
    G_IM_SIZ_4b:      0,
    G_IM_SIZ_8b:      1,
    G_IM_SIZ_16b:     2,
    G_IM_SIZ_32b:     3
  };

  function disassembleSetColorImage(cmd0,cmd1) {
    var fmt   =  (cmd0>>>21)&0x7;
    var siz   =  (cmd0>>>19)&0x3;
    var width = ((cmd0>>> 0)&0xfff)+1;
    return 'gsDPSetColorImage(' + getDefine(imageFormatTypes, fmt) + ', ' + getDefine(imageSizeTypes, siz) + ', ' + width + ', ' + n64js.toString32(cmd1) + ');';
  }
  function disassembleSetDepthImage(cmd0,cmd1) {
    return 'gsDPSetDepthImage(' + n64js.toString32(cmd1) + ');';
  }
  function disassembleSetTexureImage(cmd0,cmd1) {
    var fmt   =  (cmd0>>>21)&0x7;
    var siz   =  (cmd0>>>19)&0x3;
    var width = ((cmd0>>> 0)&0xfff)+1;
    return 'gsDPSetTextureImage(' + getDefine(imageFormatTypes, fmt) + ', ' + getDefine(imageSizeTypes, siz) + ', ' + width + ', ' + n64js.toString32(cmd1) + ');';
  }

  function disassembleSetFillColor(cmd0,cmd1) {
    return 'gsDPSetFillColor(' + n64js.toString32(cmd1) + ');';
  }

  function disassembleFillRect(cmd0,cmd1) {
    // NB: fraction is ignored
    var x0 = ((cmd1>>>12)&0xfff)>>>2;
    var y0 = ((cmd1>>> 0)&0xfff)>>>2;
    var x1 = ((cmd0>>>12)&0xfff)>>>2;
    var y1 = ((cmd0>>> 0)&0xfff)>>>2;

    return 'gsDPFillRectangle(' + x0 + ', ' + y0 + ', ' + x1 + ', ' + y1 + ');';
  }

  function disassembleCommand(a,b) {
    var cmd = a>>>24;
    switch(cmd) {

      case 0x00:      return 'SpNoop';
      case 0x01:      return 'Mtx';
      //case 0x02:    return 'Reserved';
      case 0x03:      return 'MoveMem';
      case 0x04:      return 'Vtx';
      //case 0x05:    return 'Reserved';
      case 0x06:      return 'DL           ' + dlist_param(a,b) + ' ' + dlist_address(a,b);
      //case 0x07:    return 'Reserved';
      //case 0x08:    return 'Reserved';
      case 0x09:      return 'Sprite2DBase';

      //case 0xb0:    return '';
      case 0xb1:      return 'Tri4';
      case 0xb2:      return 'RDPHalf_Cont';
      case 0xb3:      return 'RDPHalf_2';
      case 0xb4:      return 'RDPHalf_1';
      case 0xb5:      return 'Line3D';
      case 0xb6:      return disassembleClearGeometryMode(a,b);
      case 0xb7:      return disassembleSetGeometryMode(a,b);
      case 0xb8:      return 'gsSPEndDisplayList();';
      case 0xb9:      return disassembleSetOtherModeL(a,b);
      case 0xba:      return disassembleSetOtherModeH(a,b);
      case 0xbb:      return disassembleTexture(a,b);
      case 0xbc:      return disassembleMoveWord(a,b);
      case 0xbd:      return 'PopMtx';
      case 0xbe:      return 'CullDL';
      case 0xbf:      return 'Tri1';

      case 0xc0:      return 'gsDPNoOp();';
      case 0xc8:      return 'TriRSP';
      case 0xc9:      return 'TriRSP';
      case 0xca:      return 'TriRSP';
      case 0xcb:      return 'TriRSP';
      case 0xcc:      return 'TriRSP';
      case 0xcd:      return 'TriRSP';
      case 0xce:      return 'TriRSP';
      case 0xcf:      return 'TriRSP';

      case 0xe4:      return 'TexRect';
      case 0xe5:      return 'TexRectFlip';
      case 0xe6:      return 'gsDPLoadSync();';
      case 0xe7:      return 'gsDPPipeSync();';
      case 0xe8:      return 'gsDPTileSync();';
      case 0xe9:      return 'gsDPFullSync();';
      case 0xea:      return 'SetKeyGB';
      case 0xeb:      return 'SetKeyR';
      case 0xec:      return 'SetConvert';
      case 0xed:      return disassembleSetScissor(a,b);
      case 0xee:      return 'SetPrimDepth';
      case 0xef:      return 'SetRDPOtherMode';

      case 0xf0:      return 'LoadTLut';
      //case 0xf1:      return '';
      case 0xf2:      return 'SetTileSize';
      case 0xf3:      return 'LoadBlock';
      case 0xf4:      return 'LoadTile';
      case 0xf5:      return 'SetTile';
      case 0xf6:      return disassembleFillRect(a,b);
      case 0xf7:      return disassembleSetFillColor(a,b);
      case 0xf8:      return 'SetFogColor';
      case 0xf9:      return 'SetBlendColor';
      case 0xfa:      return 'SetPrimColor';
      case 0xfb:      return 'SetEnvColor';
      case 0xfc:      return 'SetCombine';
      case 0xfd:      return disassembleSetTextureImage(a,b);
      case 0xfe:      return disassembleSetDepthImage(a,b);
      case 0xff:      return disassembleSetColorImage(a,b);

      default:
        return 'Unk' + n64js.toString8(cmd);
        break;
    }
  }

  function hleGraphics(task, ram) {
    var code_base = task.getUint32(kOffset_ucode) & 0x1fffffff;
    var code_size = task.getUint32(kOffset_ucode_size);
    var data_base = task.getUint32(kOffset_ucode_data) & 0x1fffffff;
    var data_size = task.getUint32(kOffset_ucode_data_size);
    var data_ptr  = task.getUint32(kOffset_data_ptr);

    var str = detectVersionString(ram, data_base, data_size);
    n64js.log('Found ' + str);

    var ucode = 0;  // FIXME

    config.vertexStride = kUcodeStrides[ucode];

    state.rdpOtherModeL = 0x00500001;
    state.rdpOtherModeH = 0x00000000;

    state.pc = data_ptr;
    state.dlistStack = [];
    for (var i = 0; i < state.segments; ++i)
      state.segments[i] = 0;

    var canvas = document.getElementById('display');
    if (canvas.getContext) {
        state.screenContext2d = canvas.getContext('2d');
    }

    // begin scene
    var ops       = new Array(256);
    for (var i = 0; i < ops.length; ++i)
      ops[i] = executeUnknown;


    ops[0x00] = executeSpNoop;
    ops[0x01] = executeMtx;
    ops[0x03] = executeMoveMem;
    ops[0x04] = executeVtx;
    ops[0x06] = executeDL;
    ops[0x09] = executeSprite2DBase;
    ops[0xb1] = executeTri4;
    ops[0xb2] = executeRDPHalf_Cont;
    ops[0xb3] = executeRDPHalf_2;
    ops[0xb4] = executeRDPHalf_1;
    ops[0xb5] = executeLine3D;
    ops[0xb6] = executeClrGeometryMode;
    ops[0xb7] = executeSetGeometryMode;
    ops[0xb8] = executeEndDL;
    ops[0xb9] = executeSetOtherModeL;
    ops[0xba] = executeSetOtherModeH;
    ops[0xbb] = executeTexture;
    ops[0xbc] = executeMoveWord;
    ops[0xbd] = executePopMtx;
    ops[0xbe] = executeCullDL;
    ops[0xbf] = executeTri1;
    ops[0xc0] = executeNoop;
    ops[0xc8] = executeTriRSP;
    ops[0xc9] = executeTriRSP;
    ops[0xca] = executeTriRSP;
    ops[0xcb] = executeTriRSP;
    ops[0xcc] = executeTriRSP;
    ops[0xcd] = executeTriRSP;
    ops[0xce] = executeTriRSP;
    ops[0xcf] = executeTriRSP;
    ops[0xe4] = executeTexRect;
    ops[0xe5] = executeTexRectFlip;
    ops[0xe6] = executeRDPLoadSync;
    ops[0xe7] = executeRDPPipeSync;
    ops[0xe8] = executeRDPTileSync;
    ops[0xe9] = executeRDPFullSync;
    ops[0xea] = executeSetKeyGB;
    ops[0xeb] = executeSetKeyR;
    ops[0xec] = executeSetConvert;
    ops[0xed] = executeSetScissor;
    ops[0xee] = executeSetPrimDepth;
    ops[0xef] = executeSetRDPOtherMode;
    ops[0xf0] = executeLoadTLut;
    ops[0xf2] = executeSetTileSize;
    ops[0xf3] = executeLoadBlock;
    ops[0xf4] = executeLoadTile;
    ops[0xf5] = executeSetTile;
    ops[0xf6] = executeFillRect;
    ops[0xf7] = executeSetFillColor;
    ops[0xf8] = executeSetFogColor;
    ops[0xf9] = executeSetBlendColor;
    ops[0xfa] = executeSetPrimColor;
    ops[0xfb] = executeSetEnvColor;
    ops[0xfc] = executeSetCombine;
    ops[0xfd] = executeSetTImg;
    ops[0xfe] = executeSetZImg;
    ops[0xff] = executeSetCImg;

    disassembleDisplayList(data_ptr, ram, ucode);

    while (state.pc !== 0) {
      var cmd0 = ram.getUint32( state.pc + 0 );
      var cmd1 = ram.getUint32( state.pc + 4 );
      //n64js.log('[' + n64js.toHex(state.pc,32) + '] ' + n64js.toHex(cmd0,32) + n64js.toHex(cmd1,32) + ' ' + disassembleCommand(cmd0,cmd1) );
      state.pc += 8;

      ops[cmd0>>>24](cmd0,cmd1);
    }

    //n64js.halt('list');

    // end scene
  }

  function disassembleDisplayList(pc, ram, ucode) {

    var $currentDis = $('<pre></pre>');

    var kEndDL = 0xb8;

    while (true) {
      var cmd0 = ram.getUint32( pc + 0 );
      var cmd1 = ram.getUint32( pc + 4 );
      $currentDis.append('[' + n64js.toHex(pc,32) + '] ' + n64js.toHex(cmd0,32) + n64js.toHex(cmd1,32) + ' ' + disassembleCommand(cmd0,cmd1) + '<br>' );
      pc += 8;

      if (cmd0>>>24 === kEndDL) {
        break;
      }
    }

    $dlistOutput.html($currentDis);
  }  


})();