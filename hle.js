if (typeof n64js === 'undefined') {
  var n64js = {};
}

(function () {'use strict';

  var graphics_task_count = 0;

  var $dlistOutput = $('#dlist-content');
  var $textureOutput = $('#texture-content');

  var gl       = null;

  // n64's display resolution
  var viWidth  = 320;
  var viHeight = 240;

  // canvas dimension
  var canvasWidth  = 640;
  var canvasHeight = 480;

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

  var G_MTX_MODELVIEW             = 0x00;
  var G_MTX_PROJECTION            = 0x01;
  var G_MTX_MUL                   = 0x00;
  var G_MTX_LOAD                  = 0x02;
  var G_MTX_NOPUSH                = 0x00;
  var G_MTX_PUSH                  = 0x04;

  var G_DL_PUSH                   = 0x00;
  var G_DL_NOPUSH                 = 0x01;

  var moveWordTypeValues = {
    G_MW_MATRIX:             0x00,
    G_MW_NUMLIGHT:           0x02,
    G_MW_CLIP:               0x04,
    G_MW_SEGMENT:            0x06,
    G_MW_FOG:                0x08,
    G_MW_LIGHTCOL:           0x0a,
    G_MW_POINTS:             0x0c,
    G_MW_PERSPNORM:          0x0e
  };

  var moveMemTypeValues = {
    G_MV_VIEWPORT:           0x80,
    G_MV_LOOKATY:            0x82,
    G_MV_LOOKATX:            0x84,
    G_MV_L0:                 0x86,
    G_MV_L1:                 0x88,
    G_MV_L2:                 0x8a,
    G_MV_L3:                 0x8c,
    G_MV_L4:                 0x8e,
    G_MV_L5:                 0x90,
    G_MV_L6:                 0x92,
    G_MV_L7:                 0x94,
    G_MV_TXTATT:             0x96,
    G_MV_MATRIX_1:           0x9e,
    G_MV_MATRIX_2:           0x98,
    G_MV_MATRIX_3:           0x9a,
    G_MV_MATRIX_4:           0x9c
  }

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

  var G_TX_LOADTILE   = 7;
  var G_TX_RENDERTILE = 0;

  var G_TX_WRAP       = 0x0;
  var G_TX_MIRROR     = 0x1;
  var G_TX_CLAMP      = 0x2;

  //
  var kUCode_GBI0 = 0;
  var kUCode_GBI1 = 1;
  var kUCode_GBI2 = 2;

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
    vertexStride:  10
  };

  var state = {
    ram:            0,
    pc:             0,
    dlistStack:     [],
    segments:       [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    tiles:          new Array(8),
    lights:         new Array(8),
    numLights:      0,
    geometryMode:   0,
    rdpOtherModeL:  0,
    rdpOtherModeH:  0,

    rdpHalf1:       0,
    rdpHalf2:       0,

    viewport: {
      scale: [160.0, 120.0],
      trans: [160.0, 120.0]
    },

    // matrix stacks
    projection:     [],
    modelview:      [],

    projectedVertices: new Array(64),

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
      scaleS:       1.0,
      scaleT:       1.0,
    },

    combine: {
      lo: 0,
      hi: 0
    },

    fillColor:      0,
    envColor:       0,
    primColor:      0,
    blendColor:     0,
    fogColor:       0,

    primDepth:      0.0,

    colorImage: {
      format:   0,
      size:     0,
      width:    0,
      address:  0
    },

    textureImage: {
      format:   0,
      size:     0,
      width:    0,
      address:  0
    },

    depthImage: {
      address:  0
    },

    tmemLoadMap: new Array(4096),   // Map keeping track of what's been loaded to each tmem address

    screenContext2d: null   // canvas context
  };

  var n64ToCanvasScale     = [ 1.0, 1.0 ];
  var n64ToCanvasTranslate = [ 0.0, 0.0 ];

  var canvas2dMatrix = makeOrtho(0,canvasWidth, canvasHeight,0, 0,1);

  function convertN64ToCanvas( n64_coords ) {
    return [
      Math.round( Math.round( n64_coords[0] ) * n64ToCanvasScale[0] + n64ToCanvasTranslate[0] ),
      Math.round( Math.round( n64_coords[1] ) * n64ToCanvasScale[1] + n64ToCanvasTranslate[1] )
    ];
  }

  function convertN64ToDisplay( n64_coords ) {
    var canvas = convertN64ToCanvas( n64_coords );
    return [ canvas[0] * canvas2dMatrix.elems[0] + canvas2dMatrix.elems[12],
             canvas[1] * canvas2dMatrix.elems[5] + canvas2dMatrix.elems[13] ];
  }

  function setCanvasViewport(w,h) {

    canvasWidth  = w;
    canvasHeight = h;

    n64ToCanvasScale     = [ w / viWidth, h / viHeight ];
    n64ToCanvasTranslate = [ 0, 0 ];

    updateViewport();
  }

  function setN64Viewport(scale, trans) {
    //n64js.log('Viewport: scale=' + scale[0] + ',' + scale[1] + ' trans=' + trans[0] + ',' + trans[1] );

    if (scale[0] === state.viewport.scale[0] &&
        scale[1] === state.viewport.scale[1] &&
        trans[0] === state.viewport.trans[0] &&
        trans[1] === state.viewport.trans[1]) {
      return;
    }

    state.viewport.scale = scale;
    state.viewport.trans = trans;
    updateViewport();
  }

  function updateViewport() {
    var n64_min = [ state.viewport.trans[0] - state.viewport.scale[0], state.viewport.trans[1] - state.viewport.scale[1] ];
    var n64_max = [ state.viewport.trans[0] + state.viewport.scale[0], state.viewport.trans[1] + state.viewport.scale[1] ];

    var canvas_min = convertN64ToCanvas( n64_min );
    var canvas_max = convertN64ToCanvas( n64_max );

    var   vp_x      = canvas_min[0];
    var   vp_y      = canvas_min[1];
    var   vp_width  = canvas_max[0] - canvas_min[0];
    var   vp_height = canvas_max[1] - canvas_min[1];

    canvas2dMatrix = makeOrtho( canvas_min[0], canvas_max[0], canvas_max[1], canvas_min[1], 0, 1 );

    gl.viewport(vp_x, vp_y, vp_width, vp_height);
  }

  function loadMatrix(address) {
    var recip = 1.0 / 65536.0;

    var dv = new DataView(state.ram.buffer, address);

    var elements = new Float32Array(16);

    for (var i = 0; i < 4; ++i) {
      elements[4*0 + i] = (dv.getInt16(i*8 + 0)<<16 | dv.getUint16(i*8 + 0+32)) * recip;
      elements[4*1 + i] = (dv.getInt16(i*8 + 2)<<16 | dv.getUint16(i*8 + 2+32)) * recip;
      elements[4*2 + i] = (dv.getInt16(i*8 + 4)<<16 | dv.getUint16(i*8 + 4+32)) * recip;
      elements[4*3 + i] = (dv.getInt16(i*8 + 6)<<16 | dv.getUint16(i*8 + 6+32)) * recip;
    }

    return new Matrix(elements);
  }

  function getTextureDimension(ul, lr, mask) {
    var dim = ((lr - ul) / 4) + 1;
    return mask ? Math.min( 1 << mask, dim ) : dim;
  }

  function nextPow2(x) {
    var y = 1;
    while(y < x)
      y *= 2;

    return y;
  }

  function rdpSegmentAddress(addr) {
    var segment = (addr>>>24)&0xf;
    return (state.segments[segment]&0x00ffffff) + (addr & 0x00ffffff);
  }

  function makeRGBFromRGBA16(col) {
    return {
      r: ((col>>>11)&0x1f)/31.0,
      g: ((col>>> 6)&0x1f)/31.0,
      b: ((col>>> 1)&0x1f)/31.0
    };
  }

  function makeRGBFromRGBA32(col) {
    return {
      r: ((col>>>24)&0xff)/255.0,
      g: ((col>>>16)&0xff)/255.0,
      b: ((col>>> 8)&0xff)/255.0
    };
  }

  function unpackRGBAToColor(col) {
    return {
        r: ((col>>>24)&0xff)/255.0,
        g: ((col>>>16)&0xff)/255.0,
        b: ((col>>> 8)&0xff)/255.0,
        a: ((col>>> 0)&0xff)/255.0
      };
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
        hleGraphics(task, ram);
        n64js.interruptDP();
        n64js.returnControlToSystem();
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
    n64js.log('Unimplemented display list op ' + disassembleCommand(cmd0,cmd1));
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

  function executeDL(cmd0,cmd1) {
    var param = ((cmd0>>>16)&0xff);
    var address = rdpSegmentAddress(cmd1);

    if (param === G_DL_PUSH) {
      state.dlistStack.push({pc: state.pc});
    }
    state.pc = address;
  }

  function executeEndDL(cmd0,cmd1) {
    if (state.dlistStack.length > 0) {
      state.pc = state.dlistStack.pop().pc;
    } else {
      state.pc = 0;
    }
  }

  function executeMatrix(cmd0,cmd1) {
    var flags   = (cmd0>>>16)&0xff;
    var length  = (cmd0>>> 0)&0xffff;
    var address = rdpSegmentAddress(cmd1);

    var push = flags & G_MTX_PUSH;
    var replace = flags & G_MTX_LOAD;

    var matrix = loadMatrix(address);

    var stack = flags & G_MTX_PROJECTION ? state.projection : state.modelview;

    if (!replace) {
      matrix = stack[stack.length-1].multiply(matrix);
    }

    if (push) {
      stack.push(matrix);
    } else {
      stack[stack.length-1] = matrix;
    }
  }

  function executePopMatrix(cmd0,cmd1) {
    if (state.modelview.length > 0) {
      state.modelview.pop();
    }
  }

  function executeMoveMem(cmd0,cmd1) {
    var type    = (cmd0>>>16)&0xff;
    var length  = (cmd0>>> 0)&0xffff;
    var address = rdpSegmentAddress(cmd1);


    switch (type) {
      case moveMemTypeValues.G_MV_VIEWPORT:
        var scale = new Array(2);
        var trans = new Array(2);
        scale[0] = state.ram.getInt16(address +  0) / 4.0;
        scale[1] = state.ram.getInt16(address +  2) / 4.0;

        trans[0] = state.ram.getInt16(address +  8) / 4.0;
        trans[1] = state.ram.getInt16(address + 10) / 4.0;
        setN64Viewport(scale, trans);
        break;

      case moveMemTypeValues.G_MV_L0:
      case moveMemTypeValues.G_MV_L1:
      case moveMemTypeValues.G_MV_L2:
      case moveMemTypeValues.G_MV_L3:
      case moveMemTypeValues.G_MV_L4:
      case moveMemTypeValues.G_MV_L5:
      case moveMemTypeValues.G_MV_L6:
      case moveMemTypeValues.G_MV_L7:
        var light_idx = (type - moveMemTypeValues.G_MV_L0) / 2;
        state.lights[light_idx].color = unpackRGBAToColor(state.ram.getUint32(address + 0));
        state.lights[light_idx].dir   = Vector3.create([state.ram.getUint8(address +  8),
                                                        state.ram.getUint8(address +  9),
                                                        state.ram.getUint8(address + 10)]).normaliseInPlace();
        break;
    }
  }

  function executeMoveWord(cmd0,cmd1) {
    var type   = (cmd0    )&0xff;
    var offset = (cmd0>>>8)&0xffff;
    var value  = cmd1;

    switch(type) {
      case moveWordTypeValues.G_MW_MATRIX:     unimplemented(cmd0,cmd1); break;
      case moveWordTypeValues.G_MW_NUMLIGHT:   state.numLights = ((value - 0x80000000)>>>5) - 1; break;
      case moveWordTypeValues.G_MW_CLIP:       unimplemented(cmd0,cmd1); break;
      case moveWordTypeValues.G_MW_SEGMENT:    state.segments[((offset >>> 2)&0xf)] = value; break;
      case moveWordTypeValues.G_MW_FOG:        unimplemented(cmd0,cmd1); break;
      case moveWordTypeValues.G_MW_LIGHTCOL:   unimplemented(cmd0,cmd1); break;
      case moveWordTypeValues.G_MW_POINTS:     unimplemented(cmd0,cmd1); break;
      default:                                 unimplemented(cmd0,cmd1); break;
    }
  }

  var X_NEG  = 0x01;  //left
  var Y_NEG  = 0x02;  //bottom
  var Z_NEG  = 0x04;  //far
  var X_POS  = 0x08;  //right
  var Y_POS  = 0x10;  //top
  var Z_POS  = 0x20;  //near

  function calculateLighting(normal) {

    var num_lights = state.numLights;
    var r = state.lights[num_lights].color.r;
    var g = state.lights[num_lights].color.g;
    var b = state.lights[num_lights].color.b;
    var a;

    for (var l = 0; l < num_lights; ++l) {
      var light = state.lights[l];
      var d = normal.dot( light.dir );
      if (d > 0.0) {
        r += light.color.r * d;
        g += light.color.g * d;
        b += light.color.b * d;
      }
    }

    r = Math.min(r, 1.0) * 255.0;
    g = Math.min(g, 1.0) * 255.0;
    b = Math.min(b, 1.0) * 255.0;
    a = 255;

    return (a<<24) | (b<<16) | (g<<8) | r;
  }

  function ProjectedVertex()
  {
    this.pos    = new Vector4();
    this.colour = 0;
    this.u      = 0;
    this.v      = 0;
  }

  function executeVertexImpl(v0, n, address) {
    var light     = state.geometryMode & geometryModeFlags.G_LIGHTING;
    var texgen    = state.geometryMode & geometryModeFlags.G_TEXTURE_GEN;
    var texgenlin = state.geometryMode & geometryModeFlags.G_TEXTURE_GEN_LINEAR;


    if (v0+n >= 64) {
      n64js.halt('Too many verts');
      state.pc = 0;
      return;
    }

    var dv = new DataView(state.ram.buffer, address);
    var mvmtx = state.modelview[state.modelview.length-1];
    var pmtx  = state.projection[state.projection.length-1];

    var wvp = pmtx.multiply(mvmtx);

    var scale_s = state.texture.scaleS;
    var scale_t = state.texture.scaleT;

    var xyz    = new Vector3();
    var normal = new Vector3();
    var transformedNormal = new Vector3();

    for (var i = 0; i < n; ++i) {
      var vtx_base = (v0+i)*16;
      var vertex = state.projectedVertices[v0+i];

      xyz.elems[0] = dv.getInt16(vtx_base + 0);
      xyz.elems[1] = dv.getInt16(vtx_base + 2);
      xyz.elems[2] = dv.getInt16(vtx_base + 4);
      //var w = dv.getInt16(vtx_base + 6);
      var u = dv.getInt16(vtx_base + 8);
      var v = dv.getInt16(vtx_base + 10);

      var projected = vertex.pos;
      wvp.transformPoint(xyz, projected);


      //n64js.halt( x + ',' + y + ',' + z + '-&gt;' + projected.elems[0] + ',' + projected.elems[1] + ',' + projected.elems[2] );

      // var clip_flags = 0;
      //      if (projected[0] < -projected[3]) clip_flags |= X_POS;
      // else if (projected[0] >  projected[3]) clip_flags |= X_NEG;

      //      if (projected[1] < -projected[3]) clip_flags |= Y_POS;
      // else if (projected[1] >  projected[3]) clip_flags |= Y_NEG;

      //      if (projected[2] < -projected[3]) clip_flags |= Z_POS;
      // else if (projected[2] >  projected[3]) clip_flags |= Z_NEG;
      // state.projectedVertices.clipFlags = clip_flags;

      if (light) {
        normal.elems[0] = dv.getInt8(vtx_base + 12);
        normal.elems[1] = dv.getInt8(vtx_base + 13);
        normal.elems[2] = dv.getInt8(vtx_base + 14);
        var a  = dv.getUint8(vtx_base + 15);

        // calculate transformed normal
        mvmtx.transformNormal(normal, transformedNormal);
        transformedNormal.normaliseInPlace();

        vertex.color = calculateLighting(transformedNormal);

        if (texgen) {

          // retransform using wvp
          wvp.transformNormal(normal, transformedNormal);
          transformedNormal.normaliseInPlace();

          if (texgenlin) {
            vertex.u = 0.5 * (1.0 + transformedNormal.elems[0]);
            vertex.v = 0.5 * (1.0 + transformedNormal.elems[1]);
          } else {
            var normX = Math.abs( transformedNormal.elems[0] );
            var normY = Math.abs( transformedNormal.elems[1] );
            vertex.u = 0.5 - 0.25 * normX - 0.25 * normX * normX * normX;
            vertex.v = 0.5 - 0.25 * normY - 0.25 * normY * normY * normY;
          }
        } else {
          vertex.u = u * scale_s;
          vertex.v = v * scale_t;
        }
      } else {
        vertex.u = u * scale_s;
        vertex.v = v * scale_t;

        var r = dv.getUint8(vtx_base + 12);
        var g = dv.getUint8(vtx_base + 13);
        var b = dv.getUint8(vtx_base + 14);
        var a = dv.getUint8(vtx_base + 15);

        vertex.color = (a<<24) | (b<<16) | (g<<8) | r;
      }

      //var flag = dv.getUint16(vtx_base + 6);

      //var tu = dv.getInt16(vtx_base + 8);
      //var tv = dv.getInt16(vtx_base + 10);
      //var rgba = dv.getInt16(vtx_base + 12);    // nx/ny/nz/a
    }
  }

  function executeSprite2DBase(cmd0,cmd1)         { unimplemented(cmd0,cmd1); }
  function executeTri4(cmd0,cmd1)                 { unimplemented(cmd0,cmd1); }
  function executeRDPHalf_Cont(cmd0,cmd1)         { unimplemented(cmd0,cmd1); }

  function executeRDPHalf_2(cmd0,cmd1) {
    state.rdpHalf2 = cmd1;
  }

  function executeRDPHalf_1(cmd0,cmd1) {
    state.rdpHalf1 = cmd1;
  }

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
    state.texture.level  =  (cmd0>>>11)&0x3;
    state.texture.tile   =  (cmd0>>> 8)&0x7;
    var enable           =  (cmd0>>> 0)&0xff;
    state.texture.scaleS = ((cmd1>>>16)&0xffff) / (65536.0 * 32.0);
    state.texture.scaleT = ((cmd1>>> 0)&0xffff) / (65536.0 * 32.0);

    if (enable)
      state.geometryMode |=  geometryModeFlags.G_TEXTURE_ENABLE;
    else
      state.geometryMode &= ~geometryModeFlags.G_TEXTURE_ENABLE;
  }

  function executeCullDL(cmd0,cmd1)               { unimplemented(cmd0,cmd1); }

  function executeTri1(cmd0,cmd1) {

    var kTri1 = 0xbf;

    var kMaxTris = 64;
    var vertex_positions = new Float32Array(kMaxTris*3*4);
    var vertex_colours   = new  Uint32Array(kMaxTris*3*1);
    var vertex_coords    = new Float32Array(kMaxTris*3*2);
    var tri_idx     = 0;
    var vtx_pos_idx = 0;
    var vtx_col_idx = 0;
    var vtx_uv_idx  = 0;

    var pc = state.pc;
    do {
      var flag   =  (cmd1>>>24)&0xff;
      var v0_idx = ((cmd1>>>16)&0xff)/config.vertexStride;
      var v1_idx = ((cmd1>>> 8)&0xff)/config.vertexStride;
      var v2_idx = ((cmd1>>> 0)&0xff)/config.vertexStride;

      pushTri(v0_idx, v1_idx, v2_idx, vertex_positions, vertex_colours, vertex_coords, tri_idx);

      tri_idx++;
      cmd0 = state.ram.getUint32( pc + 0 );
      cmd1 = state.ram.getUint32( pc + 4 );
      pc += 8;
    } while ((cmd0>>>24) === kTri1 && tri_idx < kMaxTris);

    state.pc = pc-8;

    flushTris(tri_idx*3, vertex_positions, vertex_colours, vertex_coords);
  }

  function executeLine3D(cmd0,cmd1) {
    var kLine3D = 0xb5;

    var kMaxTris = 64;
    var vertex_positions = new Float32Array(kMaxTris*3*4);
    var vertex_colours   = new  Uint32Array(kMaxTris*3*1);
    var vertex_coords    = new Float32Array(kMaxTris*3*2);
    var tri_idx     = 0;
    var vtx_pos_idx = 0;
    var vtx_col_idx = 0;
    var vtx_uv_idx  = 0;

    var pc = state.pc;
    do {
      var v3_idx = ((cmd1>>>24)&0xff)/config.vertexStride;
      var v0_idx = ((cmd1>>>16)&0xff)/config.vertexStride;
      var v1_idx = ((cmd1>>> 8)&0xff)/config.vertexStride;
      var v2_idx = ((cmd1>>> 0)&0xff)/config.vertexStride;

      pushTri(v0_idx, v1_idx, v2_idx, vertex_positions, vertex_colours, vertex_coords, tri_idx);
      tri_idx++;
      pushTri(v2_idx, v3_idx, v0_idx, vertex_positions, vertex_colours, vertex_coords, tri_idx);
      tri_idx++;

      cmd0 = state.ram.getUint32( pc + 0 );
      cmd1 = state.ram.getUint32( pc + 4 );
      pc += 8;
    } while ((cmd0>>>24) === kLine3D && tri_idx+1 < kMaxTris);

    state.pc = pc-8;

    flushTris(tri_idx*3, vertex_positions, vertex_colours, vertex_coords);
  }

  function executeTriRSP(cmd0,cmd1)               { unimplemented(cmd0,cmd1); }

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

  function calcTextureAddress(uls, ult) {
    return state.textureImage.address + ult * (state.textureImage.width << state.textureImage.size >>> 1) + (uls << state.textureImage.size >>> 1);
  }

  function executeLoadBlock(cmd0,cmd1) {
    var uls      = (cmd0>>>12)&0xfff;
    var ult      = (cmd0>>> 0)&0xfff;
    var tile_idx = (cmd1>>>24)&0x7;
    //var lrs    = (cmd1>>>12)&0xfff;
    var dxt      = (cmd1>>> 0)&0xfff;

    var tile         = state.tiles[tile_idx];
    var tmem_address = tile.tmem || 0;

    state.tmemLoadMap[tmem_address] = {
      address:    calcTextureAddress(uls, ult),
      pitch:      0xffffffff,
      swapped:    (dxt == 0)
    };

    // invalidate all textures
  }

  function executeLoadTile(cmd0,cmd1) {
    var uls      = (cmd0>>>12)&0xfff;
    var ult      = (cmd0>>> 0)&0xfff;
    var tile_idx = (cmd1>>>24)&0x7;
    //var lrs    = (cmd1>>>12)&0xfff;
    //var lrt    = (cmd1>>> 0)&0xfff;

    var tile         = state.tiles[tile_idx];
    var tmem_address = tile.tmem || 0;

    var pitch = (state.textureImage.width << state.textureImage.size >>> 1);

    state.tmemLoadMap[tmem_address] = {
      address:    calcTextureAddress(uls >>> 2, ult >>> 2),
      pitch:      pitch,
      swapped:    false
    };

    // invalidate all textures
  }

  function executeSetTile(cmd0,cmd1) {
    var tile_idx = (cmd1>>>24)&0x7;

    var tile = state.tiles[tile_idx];

    tile.format   = (cmd0>>>21)&0x7;
    tile.size     = (cmd0>>>19)&0x3;
    tile.line     = (cmd0>>> 9)&0x1ff;
    tile.tmem     = (cmd0>>> 0)&0x1ff;
    tile.palette  = (cmd1>>>20)&0xf;
    tile.cm_t     = (cmd1>>>18)&0x3;
    tile.mask_t   = (cmd1>>>14)&0xf;
    tile.shift_t  = (cmd1>>>10)&0xf;
    tile.cm_s     = (cmd1>>> 8)&0x3;
    tile.mask_s   = (cmd1>>> 4)&0xf;
    tile.shift_s  = (cmd1>>> 0)&0xf;
  }

  function executeSetTileSize(cmd0,cmd1) {
    var tile_idx = (cmd1>>>24)&0x7;

    var tile = state.tiles[tile_idx];

    tile.uls = (cmd0>>>12)&0xfff;
    tile.ult = (cmd0>>> 0)&0xfff;
    tile.lrs = (cmd1>>>12)&0xfff;
    tile.lrt = (cmd1>>> 0)&0xfff;
  }

  function executeFillRect(cmd0,cmd1) {

    // NB: fraction is ignored
    var x0 = ((cmd1>>>12)&0xfff)>>>2;
    var y0 = ((cmd1>>> 0)&0xfff)>>>2;
    var x1 = ((cmd0>>>12)&0xfff)>>>2;
    var y1 = ((cmd0>>> 0)&0xfff)>>>2;

    if (state.depthImage.address == state.colorImage.address) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      return;
    }

    var cycle_type = getCycleType();

    var color = {r:0, g:0, b:0, a:0};

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
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
    } else if (cycle_type === cycleTypeValues.G_CYC_COPY) {
      x1 += 1;
      y1 += 1;
    }
    //color.r = Math.random();
    color.a = 1.0;
    fillRect(x0, y0, x1, y1, color);
  }

  function executeTexRect(cmd0,cmd1) {

    // The following 2 commands contain additional info
    // TODO: check op code matches what we expect?
    var pc = state.pc;
    var cmd2 = state.ram.getUint32( state.pc + 4 );
    var cmd3 = state.ram.getUint32( state.pc + 12 );
    state.pc += 16;

    var xh   = ((cmd0>>>12)&0xfff)  / 4.0;
    var yh   = ((cmd0>>> 0)&0xfff)  / 4.0;
    var tile =  (cmd1>>>24)&0x7;
    var xl   = ((cmd1>>>12)&0xfff)  / 4.0;
    var yl   = ((cmd1>>> 0)&0xfff)  / 4.0;
    var s0   = ((cmd2>>>16)&0xffff) / 32.0;
    var t0   = ((cmd2>>> 0)&0xffff) / 32.0;
    var dsdx = ((cmd3|0  )>>16) / 1024.0;   // NB - signed value
    var dtdy = ((cmd3<<16)>>16) / 1024.0;

    var cycle_type = getCycleType();

    // In copy mode 4 pixels are copied at once.
    if (cycle_type === cycleTypeValues.G_CYC_COPY) {
      dsdx *= 0.25;
    }

    // In Fill/Copy mode the coordinates are inclusive (i.e. add 1.0f to the w/h)
    if (cycle_type === cycleTypeValues.G_CYC_COPY ||
        cycle_type === cycleTypeValues.G_CYC_FILL) {
      xh += 1.0;
      yh += 1.0;
    }

    var s1 = s0 + dsdx * (xh - xl);
    var t1 = t0 + dtdy * (yh - yl);

    texRect(tile, xl,yl, xh,yh, s0,t0, s1,t1, false);
  }

  function executeTexRectFlip(cmd0,cmd1) {
    // The following 2 commands contain additional info
    // TODO: check op code matches what we expect?
    var pc = state.pc;
    var cmd2 = state.ram.getUint32( state.pc + 4 );
    var cmd3 = state.ram.getUint32( state.pc + 12 );
    state.pc += 16;

    var xh   = ((cmd0>>>12)&0xfff)  / 4.0;
    var yh   = ((cmd0>>> 0)&0xfff)  / 4.0;
    var tile =  (cmd1>>>24)&0x7;
    var xl   = ((cmd1>>>12)&0xfff)  / 4.0;
    var yl   = ((cmd1>>> 0)&0xfff)  / 4.0;
    var s0   = ((cmd2>>>16)&0xffff) / 32.0;
    var t0   = ((cmd2>>> 0)&0xffff) / 32.0;
    var dsdx = ((cmd3|0  )>>16) / 1024.0;   // NB - signed value
    var dtdy = ((cmd3<<16)>>16) / 1024.0;

    var cycle_type = getCycleType();

    // In copy mode 4 pixels are copied at once.
    if (cycle_type === cycleTypeValues.G_CYC_COPY) {
      dsdx *= 0.25;
    }

    // In Fill/Copy mode the coordinates are inclusive (i.e. add 1.0f to the w/h)
    if (cycle_type === cycleTypeValues.G_CYC_COPY ||
        cycle_type === cycleTypeValues.G_CYC_FILL) {
      xh += 1.0;
      yh += 1.0;
    }

    var s1 = s0 + dsdx * (yh - yl); // NB x/y flipped
    var t1 = t0 + dtdy * (xh - xl); // NB x/y flipped

    texRect(tile, xl,yl, xh,yh, s0,t0, s1,t1, true);
  }


  function executeSetFillColor(cmd0,cmd1) {
    state.fillColor = cmd1;
  }

  function executeSetFogColor(cmd0,cmd1) {
    state.fogColor = cmd1;
  }
  function executeSetBlendColor(cmd0,cmd1) {
    state.blendColor = cmd1;
  }

  function executeSetPrimColor(cmd0,cmd1) {
    // minlevel, primlevel ignored!
    state.primColor = cmd1;
  }

  function executeSetEnvColor(cmd0,cmd1) {
    state.envColor = cmd1;
  }

  function executeSetCombine(cmd0,cmd1) {
    state.combine.hi = cmd0 & 0x00ffffff;
    state.combine.lo = cmd1;
  }

  function executeSetTImg(cmd0,cmd1) {
    state.textureImage = {
      format:   (cmd0>>>21)&0x7,
      size:     (cmd0>>>19)&0x3,
      width:   ((cmd0>>> 0)&0xfff)+1,
      address:   rdpSegmentAddress(cmd1)
    };
  }

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


  function disassembleDL(cmd0,cmd1) {
    var param = ((cmd0>>>16)&0xff);
    var address = n64js.toString32(cmd1);

    if (param === G_DL_PUSH)
      return 'gsSPDisplayList(<span class="dl-branch">' + address + '</span>);';
    return 'gsSPBranchList(<span class="dl-branch">' + address + '</span>);';
  }

  function disassembleMatrix(cmd0,cmd1) {
    var flags   = (cmd0>>>16)&0xff;
    var length  = (cmd0>>> 0)&0xffff;
    var address = n64js.toString32(cmd1);

    var t = '';
    t += (flags & G_MTX_PROJECTION) ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';
    t += (flags & G_MTX_LOAD) ?       '|G_MTX_LOAD'       : '|G_MTX_MUL';
    t += (flags & G_MTX_PUSH) ?       '|G_MTX_PUSH'       : ''; //'|G_MTX_NOPUSH';

    return 'gsSPMatrix(' + address + ', ' + t + ');';
  }

  function disassemblePopMatrix(cmd0,cmd1) {
    var flags = (cmd1>>>0)&0xff;

    var t = '';
    t += (flags & G_MTX_PROJECTION) ? 'G_MTX_PROJECTION' : 'G_MTX_MODELVIEW';

    return 'gsSPPopMatrix(' + t + ');';
  }

  function disassembleVertex_GBI0(cmd0,cmd1) {
    var n       = ((cmd0>>>20)&0xf) + 1;
    var v0      =  (cmd0>>>16)&0xf;
    //var length  = (cmd0>>> 0)&0xffff;
    var address = n64js.toString32(cmd1);

    return 'gsSPVertex(' + address + ', ' + n + ', ' + v0 + ');';
  }

  function previewVertex_GBI0(cmd0,cmd1, ram, rdpSegmentAddress) {
    var n       = ((cmd0>>>20)&0xf) + 1;
    var v0      =  (cmd0>>>16)&0xf;
    var address = rdpSegmentAddress(cmd1);

    return previewVertexImpl(v0, n, address, ram);
  }

  function executeVertex_GBI0(cmd0,cmd1) {
    var n       = ((cmd0>>>20)&0xf) + 1;
    var v0      =  (cmd0>>>16)&0xf;
    //var length  = (cmd0>>> 0)&0xffff;
    var address = rdpSegmentAddress(cmd1);

    executeVertexImpl(v0, n, address);
  }



  function disassembleVertex_GBI1(cmd0,cmd1) {
    var v0      = ((cmd0>>>16)&0xff) / config.vertexStride;
    var n       = ((cmd0>>>10)&0x3f);
    //var length  = (cmd0>>> 0)&0x3ff;
    var address = n64js.toString32(cmd1);

    return 'gsSPVertex(' + address + ', ' + n + ', ' + v0 + ');';
  }

  function previewVertex_GBI1(cmd0,cmd1, ram, rdpSegmentAddress) {
    var v0      = ((cmd0>>>16)&0xff) / config.vertexStride;
    var n       = ((cmd0>>>10)&0x3f);
    //var length  = (cmd0>>> 0)&0x3ff;
    var address = rdpSegmentAddress(cmd1);

    return previewVertexImpl(v0, n, address, ram);
  }

  function executeVertex_GBI1(cmd0,cmd1) {
    var v0      = ((cmd0>>>16)&0xff) / config.vertexStride;
    var n       = ((cmd0>>>10)&0x3f);
    //var length  = (cmd0>>> 0)&0x3ff;
    var address = rdpSegmentAddress(cmd1);

    executeVertexImpl(v0, n, address);
  }

  function previewVertexImpl(v0, n, address, ram) {
    var dv      = new DataView(ram.buffer, address);
    var tip = '';

    tip += '<table class="vertex-table">';

    var cols = ['#', 'x', 'y', 'z', '?', 'u', 'v', 'norm', 'rgba'];

    tip += '<tr><th>' + cols.join('</th><th>') + '</th></tr>\n';

    for (var i = 0; i < n; ++i) {
      var vtx_base = (v0+i)*16;
      var v = [ v0+i,
                dv.getInt16(vtx_base + 0),  // x
                dv.getInt16(vtx_base + 2),  // y
                dv.getInt16(vtx_base + 4),  // z
                dv.getInt16(vtx_base + 6),  // ?
                dv.getInt16(vtx_base + 8),  // u
                dv.getInt16(vtx_base + 10), // v
                dv.getInt8(vtx_base  + 12) + ',' + dv.getInt8(vtx_base  + 13) + ',' + dv.getInt8(vtx_base  + 14),  // norm
                n64js.toString32( dv.getUint32(vtx_base + 12) ) // rgba
      ];

      tip += '<tr><td>' + v.join('</td><td>') + '</td></tr>\n';
    }
    tip += '</table>';
    return tip;
  }


  function disassembleMoveMem(cmd0,cmd1) {
    var type    = (cmd0>>>16)&0xff;
    var length  = (cmd0>>> 0)&0xffff;
    var address = n64js.toString32(cmd1);

    switch (type) {
      case moveMemTypeValues.G_MV_VIEWPORT:
        if (length === 16)
          return 'gsSPViewport(' + address + ');';
        break;
    }

    var type_str = getDefine(moveMemTypeValues, type);

    return 'gsDma1p(G_MOVEMEM, ' + address + ', ' + length + ', ' + type_str + ');';
  }


  function disassembleMoveWord(cmd0,cmd1) {

    var type   = (cmd0    )&0xff;
    var offset = (cmd0>>>8)&0xffff;
    var value  = cmd1;

    switch (type) {
      case moveWordTypeValues.G_MW_NUMLIGHT:
        if (offset === G_MWO_NUMLIGHT) {
          var v = ((value - 0x80000000)>>>5) - 1;
          return 'gsSPNumLights(' + getDefine(numLightValues, v) + ');';
        }
        break;
      case moveWordTypeValues.G_MW_SEGMENT:
        {
          var v = value === 0 ? '0' : n64js.toString32(value);
          return 'gsSPSegment(' + ((offset >>> 2)&0xf) + ', ' + v + ');';
        }
        break;
    }


    return 'gMoveWd(' + getDefine(moveWordTypeValues, type) + ', ' + n64js.toString16(offset) + ', ' + n64js.toString32(value) + ');';
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

  function getTextureFilterType() {
    return state.rdpOtherModeH & (3<<G_MDSFT_TEXTFILT);
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

    return 'gsSPSetOtherMode(G_SETOTHERMODE_L, ' + shift_str + ', ' + len + ', ' + data_str + ');';
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

    return 'gsSPSetOtherMode(G_SETOTHERMODE_H, ' + shift_str + ', ' + len + ', ' + data_str + ');';
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

    return 'gsDPSetScissor(' + getDefine(scissorModeValues, mode) + ', ' + x0 + ', ' + y0 + ', ' + x1 + ', ' + y1 + ');';
  }

  function disassembleTexture(cmd0, cmd1) {

    var xparam  =  (cmd0>>>16)&0xff;
    var level   =  (cmd0>>>11)&0x3;
    var tile    =  (cmd0>>> 8)&0x7;
    var on      =  (cmd0>>> 0)&0xff;
    var s       = ((cmd1>>>16)&0xffff) / (65536.0 * 32.0);
    var t       = ((cmd1>>> 0)&0xffff) / (65536.0 * 32.0);

    var s_text = s.toString();
    var t_text = t.toString();

    if (s > 0.0 && s < 1.0) s_text = '1/' + (1.0/s).toString();
    if (t > 0.0 && t < 1.0) t_text = '1/' + (1.0/t).toString();

    if (xparam !== 0) {
      return 'gsSPTextureL(' + s_text + ', ' + t_text + ', ' + level + ', ' + xparam + ', ' + tile + ', ' + on + ');';
    }
    return 'gsSPTexture(' + s_text + ', ' + t_text + ', ' + level + ', ' + tile + ', ' + on + ');';
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
    var format =  (cmd0>>>21)&0x7;
    var size   =  (cmd0>>>19)&0x3;
    var width  = ((cmd0>>> 0)&0xfff)+1;
    return 'gsDPSetColorImage(' + getDefine(imageFormatTypes, format) + ', ' + getDefine(imageSizeTypes, size) + ', ' + width + ', ' + n64js.toString32(cmd1) + ');';
  }
  function disassembleSetDepthImage(cmd0,cmd1) {
    return 'gsDPSetDepthImage(' + n64js.toString32(cmd1) + ');';
  }
  function disassembleSetTextureImage(cmd0,cmd1) {
    var format =  (cmd0>>>21)&0x7;
    var size   =  (cmd0>>>19)&0x3;
    var width  = ((cmd0>>> 0)&0xfff)+1;
    return 'gsDPSetTextureImage(' + getDefine(imageFormatTypes, format) + ', ' + getDefine(imageSizeTypes, size) + ', ' + width + ', ' + n64js.toString32(cmd1) + ');';
  }

  function disassembleSetFillColor(cmd0,cmd1) {
    return 'gsDPSetFillColor(' + n64js.toString32(cmd1) + ');';   // Can be 16 or 32 bit
  }

  function disassembleSetEnvColor(cmd0,cmd1) {
    var r = (cmd1>>>24)&0xff;
    var g = (cmd1>>>16)&0xff;
    var b = (cmd1>>> 8)&0xff;
    var a = (cmd1>>> 0)&0xff;

    return 'gsDPSetEnvColor(' + r + ', ' + g + ', ' + b + ', ' + a + ');';
  }

  function disassembleSetBlendColor(cmd0,cmd1) {
    var r = (cmd1>>>24)&0xff;
    var g = (cmd1>>>16)&0xff;
    var b = (cmd1>>> 8)&0xff;
    var a = (cmd1>>> 0)&0xff;

    return 'gsDPSetBlendColor(' + r + ', ' + g + ', ' + b + ', ' + a + ');';
  }

  function disassembleSetFogColor(cmd0,cmd1) {
    var r = (cmd1>>>24)&0xff;
    var g = (cmd1>>>16)&0xff;
    var b = (cmd1>>> 8)&0xff;
    var a = (cmd1>>> 0)&0xff;

    return 'gsDPSetFogColor(' + r + ', ' + g + ', ' + b + ', ' + a + ');';
  }

  function disassembleSetPrimColor(cmd0,cmd1) {
    var m = (cmd0>>> 8)&0xff;
    var l = (cmd0>>> 0)&0xff;
    var r = (cmd1>>>24)&0xff;
    var g = (cmd1>>>16)&0xff;
    var b = (cmd1>>> 8)&0xff;
    var a = (cmd1>>> 0)&0xff;

    return 'gsDPSetPrimColor(' + m + ', ' + l + ', ' + r + ', ' + g + ', ' + b + ', ' + a + ');';
  }

  var colcombine32 = [
    'Combined    ', 'Texel0      ',
    'Texel1      ', 'Primitive   ',
    'Shade       ', 'Env         ',
    '1           ', 'CombAlp     ',
    'Texel0_Alp  ', 'Texel1_Alp  ',
    'Prim_Alpha  ', 'Shade_Alpha ',
    'Env_Alpha   ', 'LOD_Frac    ',
    'PrimLODFrac ', 'K5          ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '0           '
  ];
  var colcombine16 = [
    'Combined    ', 'Texel0      ',
    'Texel1      ', 'Primitive   ',
    'Shade       ', 'Env         ',
    '1           ', 'CombAlp     ',
    'Texel0_Alp  ', 'Texel1_Alp  ',
    'Prim_Alp    ', 'Shade_Alpha ',
    'Env_Alpha   ', 'LOD_Frac    ',
    'PrimLOD_Frac', '0           '
  ];
  var colcombine8 = [
    'Combined    ', 'Texel0      ',
    'Texel1      ', 'Primitive   ',
    'Shade       ', 'Env         ',
    '1           ', '0           ',
  ];


  function disassembleSetCombine(cmd0,cmd1) {
    var mux0 = cmd0&0x00ffffff;
    var mux1 = cmd1;

    //
    var aRGB0  = (mux0>>>20)&0x0F; // c1 c1    // a0
    var bRGB0  = (mux1>>>28)&0x0F; // c1 c2    // b0
    var cRGB0  = (mux0>>>15)&0x1F; // c1 c3    // c0
    var dRGB0  = (mux1>>>15)&0x07; // c1 c4    // d0

    var aA0    = (mux0>>>12)&0x07; // c1 a1    // Aa0
    var bA0    = (mux1>>>12)&0x07; // c1 a2    // Ab0
    var cA0    = (mux0>>> 9)&0x07; // c1 a3    // Ac0
    var dA0    = (mux1>>> 9)&0x07; // c1 a4    // Ad0

    var aRGB1  = (mux0>>> 5)&0x0F; // c2 c1    // a1
    var bRGB1  = (mux1>>>24)&0x0F; // c2 c2    // b1
    var cRGB1  = (mux0>>> 0)&0x1F; // c2 c3    // c1
    var dRGB1  = (mux1>>> 6)&0x07; // c2 c4    // d1

    var aA1    = (mux1>>>21)&0x07; // c2 a1    // Aa1
    var bA1    = (mux1>>> 3)&0x07; // c2 a2    // Ab1
    var cA1    = (mux1>>>18)&0x07; // c2 a3    // Ac1
    var dA1    = (mux1>>> 0)&0x07; // c2 a4    // Ad1

    var decoded = '';

    decoded += '\n';
    decoded += '\tRGB0 = (' + colcombine16[aRGB0] + ' - ' + colcombine16[bRGB0] + ') * ' + colcombine32[cRGB0] + ' + ' + colcombine8[dRGB0] + '\n';
    decoded += '\t  A0 = (' + colcombine8 [  aA0] + ' - ' + colcombine8 [  bA0] + ') * ' + colcombine8 [  cA0] + ' + ' + colcombine8[  dA0] + '\n';
    decoded += '\tRGB1 = (' + colcombine16[aRGB1] + ' - ' + colcombine16[bRGB1] + ') * ' + colcombine32[cRGB1] + ' + ' + colcombine8[dRGB1] + '\n';
    decoded += '\t  A1 = (' + colcombine8 [  aA1] + ' - ' + colcombine8 [  bA1] + ') * ' + colcombine8 [  cA1] + ' + ' + colcombine8[  dA1] + '\n';

    return 'gsDPSetCombine(' + n64js.toString32(mux0) + ', ' + n64js.toString32(mux1) + ');' + decoded;
  }

  function getClampMirrorWrapText(flags) {
    switch (flags) {
      case G_TX_WRAP:              return 'G_TX_WRAP';
      case G_TX_MIRROR:            return 'G_TX_MIRROR';
      case G_TX_CLAMP:             return 'G_TX_CLAMP';
      case G_TX_MIRROR|G_TX_CLAMP: return 'G_TX_MIRROR|G_TX_CLAMP';
    }

    return flags;
  }


  function disassembleSetTile(cmd0,cmd1) {
    var format   = (cmd0>>>21)&0x7;
    var size     = (cmd0>>>19)&0x3;
    //var pad0   = (cmd0>>>18)&0x1;
    var line     = (cmd0>>> 9)&0x1ff;
    var tmem     = (cmd0>>> 0)&0x1ff;

    //var pad1   = (cmd1>>>27)&0x1f;
    var tile_idx = (cmd1>>>24)&0x7;
    var palette  = (cmd1>>>20)&0xf;

    var cm_t     = (cmd1>>>18)&0x3;
    var mask_t   = (cmd1>>>14)&0xf;
    var shift_t  = (cmd1>>>10)&0xf;

    var cm_s     = (cmd1>>> 8)&0x3;
    var mask_s   = (cmd1>>> 4)&0xf;
    var shift_s  = (cmd1>>> 0)&0xf;

    var cm_s_text = getClampMirrorWrapText(cm_s);
    var cm_t_text = getClampMirrorWrapText(cm_t);

    var tile_text = tile_idx;
    if (tile_idx === G_TX_LOADTILE)   tile_text = 'G_TX_LOADTILE';
    if (tile_idx === G_TX_RENDERTILE) tile_text = 'G_TX_RENDERTILE';

    return 'gsDPSetTile(' + getDefine(imageFormatTypes, format) + ', ' + getDefine(imageSizeTypes, size) + ', ' +
     line + ', ' + tmem + ', ' + tile_text + ', ' + palette + ', ' +
     cm_t_text + ', ' + mask_t + ', ' + shift_t + ', ' +
     cm_s_text + ', ' + mask_s + ', ' + shift_s + ');';
  }

  function disassembleSetTileSize(cmd0,cmd1) {
    var uls      = (cmd0>>>12)&0xfff;
    var ult      = (cmd0>>> 0)&0xfff;
    var tile_idx = (cmd1>>>24)&0x7;
    var lrs      = (cmd1>>>12)&0xfff;
    var lrt      = (cmd1>>> 0)&0xfff;

    return 'gsDPSetTileSize(' + tile_idx + ', ' + uls + ', ' + ult + ', ' + lrs + ', ' + lrt + ');';
  }

 function disassembleLoadTile(cmd0,cmd1) {
   var uls      = (cmd0>>>12)&0xfff;
   var ult      = (cmd0>>> 0)&0xfff;
   var tile_idx = (cmd1>>>24)&0x7;
   var lrs      = (cmd1>>>12)&0xfff;
   var lrt      = (cmd1>>> 0)&0xfff;

   return 'gsDPLoadTile(' + tile_idx + ', ' + uls + ', ' + ult + ', ' + lrs + ', ' + lrt + ');';
 }

  function disassembleLoadBlock(cmd0,cmd1) {
    var uls      = (cmd0>>>12)&0xfff;
    var ult      = (cmd0>>> 0)&0xfff;
    var tile_idx = (cmd1>>>24)&0x7;
    var lrs      = (cmd1>>>12)&0xfff;
    var dxt      = (cmd1>>> 0)&0xfff;

   return 'gsDPLoadBlock(' + tile_idx + ', ' + uls + ', ' + ult + ', ' + lrs + ', ' + dxt + ');';
  }

  function disassembleFillRect(cmd0,cmd1) {
    // NB: fraction is ignored
    var x0 = ((cmd1>>>12)&0xfff)>>>2;
    var y0 = ((cmd1>>> 0)&0xfff)>>>2;
    var x1 = ((cmd0>>>12)&0xfff)>>>2;
    var y1 = ((cmd0>>> 0)&0xfff)>>>2;

    return 'gsDPFillRectangle(' + x0 + ', ' + y0 + ', ' + x1 + ', ' + y1 + ');';
  }

  function disassembleTri1(cmd0,cmd1) {
    var flag   =  (cmd1>>>24)&0xff;
    var v0_idx = ((cmd1>>>16)&0xff)/config.vertexStride;
    var v1_idx = ((cmd1>>> 8)&0xff)/config.vertexStride;
    var v2_idx = ((cmd1>>> 0)&0xff)/config.vertexStride;

    return 'gsSP1Triangle(' + v0_idx + ', ' + v1_idx + ', ' + v2_idx + ', ' + flag + ');';
  }

  function disassembleTexRect(cmd0,cmd1) {
    var xh       = ((cmd0>>>12)&0xfff)  / 4.0;
    var yh       = ((cmd0>>> 0)&0xfff)  / 4.0;
    var tile_idx =  (cmd1>>>24)&0x7;
    var xl       = ((cmd1>>>12)&0xfff)  / 4.0;
    var yl       = ((cmd1>>> 0)&0xfff)  / 4.0;
    // TODO from subsequent commands:
    // var s    = ((cmd2>>>16)&0xffff) / 32.0;
    // var t    = ((cmd2>>> 0)&0xffff) / 32.0;
    // var dsdx = ((cmd3>>>16)&0xffff) / 1024.0;
    // var dtdy = ((cmd3>>> 0)&0xffff) / 1024.0;

    var tile_text = tile_idx;
    if (tile_idx === G_TX_LOADTILE)   tile_text = 'G_TX_LOADTILE';
    if (tile_idx === G_TX_RENDERTILE) tile_text = 'G_TX_RENDERTILE';

    return 'gsSPTextureRectangle(' + xl + ',' + yl + ',' + xh + ',' + yh + ',' + tile_text + ', ???);';
  }

  function disassembleLine3D(cmd0,cmd1) {
    var v3_idx = ((cmd1>>>24)&0xff)/config.vertexStride;
    var v0_idx = ((cmd1>>>16)&0xff)/config.vertexStride;
    var v1_idx = ((cmd1>>> 8)&0xff)/config.vertexStride;
    var v2_idx = ((cmd1>>> 0)&0xff)/config.vertexStride;

    return 'gsSPLine3D(' + v0_idx + ', ' + v1_idx + ', ' + v2_idx + ', ' + v3_idx + ');';
  }

  function disassembleCommand(a,b) {
    var cmd = a>>>24;
    switch(cmd) {

      case 0x00:      return 'SpNoop';
      case 0x01:      return disassembleMatrix(a,b);
      //case 0x02:    return 'Reserved';
      case 0x03:      return disassembleMoveMem(a,b);
      case 0x04:      return disassembleVertex(a,b);
      //case 0x05:    return 'Reserved';
      case 0x06:      return disassembleDL(a,b);
      //case 0x07:    return 'Reserved';
      //case 0x08:    return 'Reserved';
      case 0x09:      return 'Sprite2DBase';

      //case 0xb0:    return '';
      case 0xb1:      return 'Tri4';
      case 0xb2:      return 'RDPHalf_Cont';
      case 0xb3:      return 'gsImmp1(G_RDPHALF_2, ' + n64js.toString32(b) + ');';
      case 0xb4:      return 'gsImmp1(G_RDPHALF_1, ' + n64js.toString32(b) + ');';
      case 0xb5:      return disassembleLine3D(a,b);
      case 0xb6:      return disassembleClearGeometryMode(a,b);
      case 0xb7:      return disassembleSetGeometryMode(a,b);
      case 0xb8:      return 'gsSPEndDisplayList();';
      case 0xb9:      return disassembleSetOtherModeL(a,b);
      case 0xba:      return disassembleSetOtherModeH(a,b);
      case 0xbb:      return disassembleTexture(a,b);
      case 0xbc:      return disassembleMoveWord(a,b);
      case 0xbd:      return disassemblePopMatrix(a,b);
      case 0xbe:      return 'CullDL';
      case 0xbf:      return disassembleTri1(a,b);

      case 0xc0:      return 'gsDPNoOp();';
      case 0xc8:      return 'TriRSP';
      case 0xc9:      return 'TriRSP';
      case 0xca:      return 'TriRSP';
      case 0xcb:      return 'TriRSP';
      case 0xcc:      return 'TriRSP';
      case 0xcd:      return 'TriRSP';
      case 0xce:      return 'TriRSP';
      case 0xcf:      return 'TriRSP';

      case 0xe4:      return disassembleTexRect(a,b);
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
      case 0xf2:      return disassembleSetTileSize(a,b);
      case 0xf3:      return disassembleLoadBlock(a,b);
      case 0xf4:      return disassembleLoadTile(a,b);
      case 0xf5:      return disassembleSetTile(a,b);
      case 0xf6:      return disassembleFillRect(a,b);
      case 0xf7:      return disassembleSetFillColor(a,b);
      case 0xf8:      return disassembleSetFogColor(a,b);
      case 0xf9:      return disassembleSetBlendColor(a,b);
      case 0xfa:      return disassembleSetPrimColor(a,b);
      case 0xfb:      return disassembleSetEnvColor(a,b);
      case 0xfc:      return disassembleSetCombine(a,b);
      case 0xfd:      return disassembleSetTextureImage(a,b);
      case 0xfe:      return disassembleSetDepthImage(a,b);
      case 0xff:      return disassembleSetColorImage(a,b);

      default:
        return 'Unk' + n64js.toString8(cmd);
        break;
    }
  }

  function logGLCall(functionName, args) {
     console.log("gl." + functionName + "(" +
        WebGLDebugUtils.glFunctionArgsToString(functionName, args) + ")");
  }

  function initWebGL(canvas) {
    if (gl)
      return;

    try {
      // Try to grab the standard context. If it fails, fallback to experimental.
      gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");

      //gl = WebGLDebugUtils.makeDebugContext(gl, undefined, logGLCall);
    }
    catch(e) {}

    // If we don't have a GL context, give up now
    if (!gl) {
      alert("Unable to initialize WebGL. Your browser may not support it.");
    }
  }

  function initShaders(vs_name, fs_name) {
    var fragmentShader = getShader(gl, fs_name);
    var vertexShader   = getShader(gl, vs_name);

    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    // If creating the shader program failed, alert
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      alert("Unable to initialize the shader program.");
    }
    return program;
  }

  function getShader(gl, id) {
    var shaderScript, theSource, shader_type;

    shaderScript = document.getElementById(id);

    if (!shaderScript) {
        return null;
    }

    theSource = getScriptNodeSource(shaderScript);

    if (shaderScript.type === "x-shader/x-fragment") {
      shader_type = gl.FRAGMENT_SHADER;
    } else if (shaderScript.type === "x-shader/x-vertex") {
      shader_type = gl.VERTEX_SHADER;
    } else {
       // Unknown shader type
       return null;
    }

    return createShader(theSource, shader_type);
  }

  function getScriptNodeSource(shaderScript) {
    var theSource, currentChild;

    theSource = "";
    currentChild = shaderScript.firstChild;

    while(currentChild) {
      if (currentChild.nodeType == currentChild.TEXT_NODE) {
          theSource += currentChild.textContent;
      }

      currentChild = currentChild.nextSibling;
    }

    return theSource;
  }

  // shader_type is 'gl.FRAGMENT_SHADER' or 'gl.VERTEX_SHADER'
  function createShader(theSource, shader_type) {
    var shader = gl.createShader(shader_type);

    gl.shaderSource(shader, theSource);

    gl.compileShader(shader);

    // See if it compiled successfully
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
  }


  var fillShaderProgram;
  var rectVerticesBuffer;
  var n64PositionsBuffer;
  var n64ColorsBuffer;
  var n64UVBuffer;


  function pushTri(v0_idx, v1_idx, v2_idx, vertex_positions, vertex_colours, vertex_coords, tri_idx) {

    var vtx_pos_idx = tri_idx * 3*4;
    var vtx_col_idx = tri_idx * 3*1;
    var vtx_uv_idx  = tri_idx * 3*2;

    var v0 = state.projectedVertices[v0_idx];
    var v1 = state.projectedVertices[v1_idx];
    var v2 = state.projectedVertices[v2_idx];

    var vp0 = v0.pos.elems;
    var vp1 = v1.pos.elems;
    var vp2 = v2.pos.elems;

    vertex_positions[vtx_pos_idx+ 0] = vp0[0];
    vertex_positions[vtx_pos_idx+ 1] = vp0[1];
    vertex_positions[vtx_pos_idx+ 2] = vp0[2];
    vertex_positions[vtx_pos_idx+ 3] = vp0[3];

    vertex_positions[vtx_pos_idx+ 4] = vp1[0];
    vertex_positions[vtx_pos_idx+ 5] = vp1[1];
    vertex_positions[vtx_pos_idx+ 6] = vp1[2];
    vertex_positions[vtx_pos_idx+ 7] = vp1[3];

    vertex_positions[vtx_pos_idx+ 8] = vp2[0];
    vertex_positions[vtx_pos_idx+ 9] = vp2[1];
    vertex_positions[vtx_pos_idx+10] = vp2[2];
    vertex_positions[vtx_pos_idx+11] = vp2[3];

    vertex_colours[vtx_col_idx + 0] = v0.color;
    vertex_colours[vtx_col_idx + 1] = v1.color;
    vertex_colours[vtx_col_idx + 2] = v2.color;


    vertex_coords[vtx_uv_idx+ 0] = v0.u;
    vertex_coords[vtx_uv_idx+ 1] = v0.v;

    vertex_coords[vtx_uv_idx+ 2] = v1.u;
    vertex_coords[vtx_uv_idx+ 3] = v1.v;

    vertex_coords[vtx_uv_idx+ 4] = v2.u;
    vertex_coords[vtx_uv_idx+ 5] = v2.v;
  }

  function setProgramState(vertex_positions, vertex_colours, vertex_coords, textureinfo, tex_gen_enabled) {

    var cycle_type = getCycleType();
    if (cycle_type < cycleTypeValues.G_CYC_COPY) {
      initBlend();
    } else {
      gl.disable(gl.BLEND);
    }

    var program = getCurrentShaderProgram(cycle_type);
    gl.useProgram(program);

    var vertexPositionAttribute = gl.getAttribLocation(program,  "aVertexPosition");
    var vertexColorAttribute    = gl.getAttribLocation(program,  "aVertexColor");
    var texCoordAttribute       = gl.getAttribLocation(program,  "aTextureCoord");
    var uSamplerUniform         = gl.getUniformLocation(program, "uSampler");
    var uPrimColorUniform       = gl.getUniformLocation(program, "uPrimColor");
    var uEnvColorUniform        = gl.getUniformLocation(program, "uEnvColor");
    var uTexScaleUniform        = gl.getUniformLocation(program, "uTexScale");
    var uTexOffsetUniform       = gl.getUniformLocation(program, "uTexOffset");

    // aVertexPosition
    gl.enableVertexAttribArray(vertexPositionAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, n64PositionsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex_positions), gl.STATIC_DRAW);
    gl.vertexAttribPointer(vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);

    // aVertexColor
    gl.enableVertexAttribArray(vertexColorAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, n64ColorsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array(vertex_colours), gl.STATIC_DRAW);
    gl.vertexAttribPointer(vertexColorAttribute, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    // aTextureCoord
    gl.enableVertexAttribArray(texCoordAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, n64UVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex_coords), gl.STATIC_DRAW);
    gl.vertexAttribPointer(texCoordAttribute, 2, gl.FLOAT, false, 0, 0);

    // uSampler
    if (textureinfo) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureinfo.texture);
      gl.uniform1i(uSamplerUniform, 0);

      var uv_offset_u = textureinfo.left;
      var uv_offset_v = textureinfo.top;
      var uv_scale_u = 1.0 / textureinfo.nativeWidth;
      var uv_scale_v = 1.0 / textureinfo.nativeHeight;

      // When texture coordinates are generated, they're already correctly scaled. Maybe they should be generated in this coord space?
      if (tex_gen_enabled) {
        uv_scale_u  = 1;
        uv_scale_v  = 1;
        uv_offset_u = 0;
        uv_offset_v = 0;
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureinfo.texture);
      gl.uniform1i(uSamplerUniform, 0);

      gl.uniform2f(uTexScaleUniform,  uv_scale_u,  uv_scale_v );
      gl.uniform2f(uTexOffsetUniform, uv_offset_u, uv_offset_u );

      if (getTextureFilterType() == textureFilterValues.G_TF_POINT) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
      }
    }

    gl.uniform4f(uPrimColorUniform, ((state.primColor>>>24)&0xff)/255.0,  ((state.primColor>>>16)&0xff)/255.0, ((state.primColor>>> 8)&0xff)/255.0, ((state.primColor>>> 0)&0xff)/255.0 );
    gl.uniform4f(uEnvColorUniform,  ((state.envColor >>>24)&0xff)/255.0,  ((state.envColor >>>16)&0xff)/255.0, ((state.envColor >>> 8)&0xff)/255.0, ((state.envColor >>> 0)&0xff)/255.0 );

  }

  function flushTris(num_tris, vertex_positions, vertex_colours, vertex_coords) {

    var cycle_type = getCycleType();
    var textureinfo;
    var tex_gen_enabled = false;

    if (state.geometryMode & geometryModeFlags.G_TEXTURE_ENABLE) {
      textureinfo     = installTexture(state.texture.tile);
      tex_gen_enabled = (state.geometryMode & (geometryModeFlags.G_LIGHTING|geometryModeFlags.G_TEXTURE_GEN)) === (geometryModeFlags.G_LIGHTING|geometryModeFlags.G_TEXTURE_GEN);
    }

    setProgramState(vertex_positions, vertex_colours, vertex_coords, textureinfo, tex_gen_enabled);

    initDepth();

    //texture filter

    if (state.geometryMode & geometryModeFlags.G_CULL_BOTH) {
      gl.enable(gl.CULL_FACE);
      var mode = (state.geometryMode & geometryModeFlags.G_CULL_FRONT) ? gl.FRONT : gl.BACK;
      gl.cullFace(mode);
    } else {
      gl.disable(gl.CULL_FACE);
    }

    gl.drawArrays(gl.TRIANGLES, 0, num_tris);
    //gl.drawArrays(gl.LINE_STRIP, 0, num_tris);
  }

  function fillRect(x0,y0, x1,y1, color) {
    // multiply by state.viewport.trans/scale
    var screen0 = convertN64ToCanvas( [x0,y0] );
    var screen1 = convertN64ToCanvas( [x1,y1] );

    var vertices = [
      screen1[0], screen1[1], 0.0,
      screen0[0], screen1[1], 0.0,
      screen1[0], screen0[1], 0.0,
      screen0[0], screen0[1], 0.0
    ];

    var program = fillShaderProgram;
    gl.useProgram(program);

    var vertexPositionAttribute = gl.getAttribLocation(fillShaderProgram, "aVertexPosition");
    var uPMatrixUniform         = gl.getUniformLocation(fillShaderProgram, "uPMatrix");
    var fillColorUniform        = gl.getUniformLocation(fillShaderProgram, "uFillColor");

    // aVertexPosition
    gl.enableVertexAttribArray(vertexPositionAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, rectVerticesBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0);

    // uPMatrix
    gl.uniformMatrix4fv(uPMatrixUniform, false, canvas2dMatrix.elems);

    // uFillColor
    gl.uniform4f(fillColorUniform, color.r, color.g, color.b, color.a);

    // Disable depth testing
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function texRect(tile_idx, x0,y0, x1,y1, s0,t0, s1,t1, flip) {

    // TODO: check scissor

    var textureinfo = installTexture(tile_idx);

    // multiply by state.viewport.trans/scale
    var screen0 = convertN64ToDisplay( [x0,y0] );
    var screen1 = convertN64ToDisplay( [x1,y1] );

    var depth_source_prim = (state.rdpOtherModeL & depthSourceValues.G_ZS_PRIM) !== 0;

    var depth = depth_source_prim ? state.primDepth : 0.0;

    var vertices = [
      screen0[0], screen0[1], depth, 1.0,
      screen1[0], screen0[1], depth, 1.0,
      screen0[0], screen1[1], depth, 1.0,
      screen1[0], screen1[1], depth, 1.0
    ];

    var uvs;

    if (flip) {
      uvs = [
        s0, t0,
        s0, t1,
        s1, t0,
        s1, t1
      ];
    } else {
      uvs = [
        s0, t0,
        s1, t0,
        s0, t1,
        s1, t1
      ];
    }

    var colours = [ 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff ];

    setProgramState(vertices, colours, uvs, textureinfo, false /*tex_gen_enabled*/);

    // uTexScale/uTexOffset

    gl.disable(gl.CULL_FACE);

    var depth_enabled = depth_source_prim ? true : false;
    if (depth_enabled) {
      initDepth();
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    }

    var cycle_type = getCycleType();
    if (cycle_type < cycleTypeValues.G_CYC_COPY) {

      if ((state.rdpOtherModeL & renderModeFlags.FORCE_BL) !== 0) {
        initBlend();
      } else {
        gl.disable(gl.BLEND);
      }
    }


    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function initDepth() {

    // Fixes Zfighting issues we have on the PSP.
    //if( gRDPOtherMode.zmode == 3 ) ...

    // Disable depth testing
    var zgeom_mode      = (state.geometryMode  & geometryModeFlags.G_ZBUFFER) !== 0;
    var zcmp_rendermode = (state.rdpOtherModeL & renderModeFlags.Z_CMP) !== 0;
    var zupd_rendermode = (state.rdpOtherModeL & renderModeFlags.Z_UPD) !== 0;

    if ((zgeom_mode && zcmp_rendermode) || zupd_rendermode) {
      gl.enable(gl.DEPTH_TEST);
    } else {
      gl.disable(gl.DEPTH_TEST);
    }

    gl.depthMask(zupd_rendermode);
  }


  function initBlend() {
    var blend_mode = state.rdpOtherModeL >> G_MDSFT_BLENDER;
    switch(blend_mode) {
      //case 0x0044:        // ?
      //case 0x0055:        // ?
      case 0x0c08:          // In * 0 + In * 1 || :In * AIn + In * 1-A        Tarzan - Medalion in bottom part of the screen
      //case 0x0c19:        // ?
      case 0x0f0a:          // In * 0 + In * 1 || :In * 0 + In * 1            SSV - ??? and MM - Walls, Wipeout - Mountains
      case 0x0fa5:          // In * 0 + Bl * AMem || :In * 0 + Bl * AMem      OOT Menu
      //case 0x5f50:        // ?
      case 0x8410:          // Bl * AFog + In * 1-A || :In * AIn + Mem * 1-A  Paper Mario Menu
      case 0xc302:          // Fog * AIn + In * 1-A || :In * 0 + In * 1       ISS64 - Ground
      case 0xc702:          // Fog * AFog + In * 1-A || :In * 0 + In * 1      Donald Duck - Sky
      //case 0xc811:        // ?
      case 0xfa00:          // Fog * AShade + In * 1-A || :Fog * AShade + In * 1-A  F-Zero - Power Roads
      //case 0x07c2:        // In * AFog + Fog * 1-A || In * 0 + In * 1       Conker - ??
        gl.disable(gl.BLEND);
        break;

      //case 0x55f0:        // Mem * AFog + Fog * 1-A || :Mem * AFog + Fog * 1-A  Bust a Move 3 - ???
      case 0x0150:          // In * AIn + Mem * 1-A || :In * AFog + Mem * 1-A   Spiderman - Waterfall Intro
      case 0x0f5a:          // In * 0 + Mem * 1 || :In * 0 + Mem * 1            Starwars Racer
      case 0x0010:          // In * AIn + In * 1-A || :In * AIn + Mem * 1-A     Hey You Pikachu - Shadow
      case 0x0040:          // In * AIn + Mem * 1-A || :In * AIn + In * 1-A     Mario - Princess peach text
      //case 0x0050:        // In * AIn + Mem * 1-A || :In * AIn + Mem * 1-A:   SSV - TV Screen and SM64 text
      case 0x04d0:          // In * AFog + Fog * 1-A || In * AIn + Mem * 1-A    Conker's Eyes
      case 0x0c18:          // In * 0 + In * 1 || :In * AIn + Mem * 1-A:        SSV - WaterFall and dust
      case 0xc410:          // Fog * AFog + In * 1-A || :In * AIn + Mem * 1-A   Donald Duck - Stars
      case 0xc810:          // Fog * AShade + In * 1-A || :In * AIn + Mem * 1-A SSV - Fog? and MM - Shadows
      case 0xcb02:          // Fog * AShade + In * 1-A || :In * 0 + In * 1      Doom 64 - Weapons
      default:
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.blendEquation(gl.FUNC_ADD);
        gl.enable(gl.BLEND);
        break;
    }
  }

  function installTexture(tile_idx) {
    var tile         = state.tiles[tile_idx];
    var tmem_address = tile.tmem;

    if (state.tmemLoadMap.hasOwnProperty(tmem_address)) {
      var load_details = state.tmemLoadMap[tmem_address];
      var pitch = load_details.pitch;

      // If loaded via LoadBlock, the pitch isn't set and is deterined via tile.line
      if (pitch == 0xffffffff) {
        if (tile.size === imageSizeTypes.G_IM_SIZ_32b)
          pitch = tile.line << 4;
        else
          pitch = tile.line << 3;
      }

      var width  = getTextureDimension( tile.uls, tile.lrs, tile.mask_s );
      var height = getTextureDimension( tile.ult, tile.lrt, tile.mask_t );

      var textureinfo = loadTexture({
        'tmem':    tile.tmem,
        'palette': tile.palette,
        'address': load_details.address,
        'format':  tile.format,
        'size':    tile.size,
        'width':   width,
        'height':  height,
        'pitch':   pitch,
        //'tlutfmt': ?
        'swapped': load_details.swapped,
        'cm_s':    tile.cm_s,
        'cm_t':    tile.cm_t,
        'mask_s':  tile.mask_s,
        'mask_t':  tile.mask_t,
      });

      textureinfo.left = tile.uls;
      textureinfo.top  = tile.ult;

      return textureinfo;
    }
  }


  // The implementation for these ops is ucode dependent
  var disassembleVertex = disassembleVertex_GBI0;
  var previewVertex     = previewVertex_GBI0;
  var executeVertex     = executeVertex_GBI0;

  function buildUCodeTables(ucode) {
    switch (ucode) {
      case kUCode_GBI0:
        disassembleVertex = disassembleVertex_GBI0;
        previewVertex     = previewVertex_GBI0;
        executeVertex     = executeVertex_GBI0;
        break;
      case kUCode_GBI1:
        disassembleVertex = disassembleVertex_GBI1;
        previewVertex     = previewVertex_GBI1;
        executeVertex     = executeVertex_GBI1;
        break;
    }
  }

  var last_ucode_str = '';

  function hleGraphics(task, ram) {
    ++graphics_task_count;

    if (!gl) {
        return;
    }

    var code_base = task.getUint32(kOffset_ucode) & 0x1fffffff;
    var code_size = task.getUint32(kOffset_ucode_size);
    var data_base = task.getUint32(kOffset_ucode_data) & 0x1fffffff;
    var data_size = task.getUint32(kOffset_ucode_data_size);
    var data_ptr  = task.getUint32(kOffset_data_ptr);

    var str = detectVersionString(ram, data_base, data_size);

    if (str !== last_ucode_str) {
      n64js.log('GFX: ' + graphics_task_count + ' - ' + str);
    }
    last_ucode_str = str;

    var ucode = kUCode_GBI0;

    // FIXME: lots of work here
    if (str.indexOf('F3DEX') >= 0 && str.indexOf('0.95') >= 0) ucode = kUCode_GBI1;
    if (str.indexOf('F3DEX') >= 0 && str.indexOf('1.21') >= 0) ucode = kUCode_GBI1;

    buildUCodeTables(ucode);

    config.vertexStride = kUcodeStrides[ucode];

    state.ram           = ram;
    state.rdpOtherModeL = 0x00500001;
    state.rdpOtherModeH = 0x00000000;

    state.projection    = [ Matrix.identity() ];
    state.modelview     = [ Matrix.identity() ];

    state.pc = data_ptr;
    state.dlistStack = [];
    for (var i = 0; i < state.segments.length; ++i) {
      state.segments[i] = 0;
    }

    for (var i = 0; i < state.tiles.length; ++i) {
      state.tiles[i] = {};
    }

    state.numLights = 0;
    for (var i = 0; i < state.lights.length; ++i) {
      state.lights[i] = {color: {r:0,g:0,b:0,a:0}, dir: Vector3.create([1,0,0])};
    }

    for (var i = 0; i < state.projectedVertices.length; ++i) {
      state.projectedVertices[i] = new ProjectedVertex();
    }

    var canvas = document.getElementById('display');
    //if (canvas.getContext) {
    //    state.screenContext2d = canvas.getContext('2d');
    //}

    // set viWidth/viHeight from video registers

    setCanvasViewport(canvas.clientWidth, canvas.clientHeight);


    var ops       = new Array(256);
    for (var i = 0; i < ops.length; ++i)
      ops[i] = executeUnknown;


    ops[0x00] = executeSpNoop;
    ops[0x01] = executeMatrix;
    ops[0x03] = executeMoveMem;
    ops[0x04] = executeVertex;
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
    ops[0xbd] = executePopMatrix;
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
      var pc = state.pc;
      var cmd0 = ram.getUint32( pc + 0 );
      var cmd1 = ram.getUint32( pc + 4 );
      state.pc += 8;

      //try {
        ops[cmd0>>>24](cmd0,cmd1);
      //} catch(e) {
      //  throw 'Exception ' + e.toString() + ' at ' + n64js.toString32(pc) + ' ' + disassembleCommand(cmd0,cmd1);
      //}
    }

    gl.finish();
  }

  function disassembleDisplayList(pc, ram, ucode) {

    if (!$dlistOutput.hasClass('active')) {
      return;
    }

    buildUCodeTables(ucode);

    var kMatrix   = 0x01;
    var kVertex   = 0x04;
    var kDL       = 0x06;
    var kEndDL    = 0xb8;
    var kMoveWord = 0xbc;

    var state = {
      pc:             pc,
      dlistStack:     [],
      segments:       [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    };

    function rdpSegmentAddress(addr) {
      var segment = (addr>>>24)&0xf;
      return (state.segments[segment]&0x00ffffff) + (addr & 0x00ffffff);
    }

    var ops = [];

    while (state.pc != 0) {
      var cmd0 = ram.getUint32( state.pc + 0 );
      var cmd1 = ram.getUint32( state.pc + 4 );

      var op = {pc:state.pc, cmd0:cmd0, cmd1:cmd1, depth:state.dlistStack.length};

      ops.push(op);

      state.pc += 8;

      var cmd = cmd0>>>24;

      switch (cmd) {
        case kDL:
          var param = ((cmd0>>>16)&0xff);
          var address = rdpSegmentAddress(cmd1);

          if (param === G_DL_PUSH) {
            state.dlistStack.push({pc: state.pc});
          }
          state.pc = address;
          break;
        case kEndDL:
          if (state.dlistStack.length > 0) {
            state.pc = state.dlistStack.pop().pc;
          } else {
            state.pc = 0;
          }
          break;
        case kMoveWord:
          {
            var type   = (cmd0    )&0xff;
            var offset = (cmd0>>>8)&0xffff;
            var value  = cmd1;

            if (type === moveWordTypeValues.G_MW_SEGMENT) {
              state.segments[((offset >>> 2)&0xf)] = value;
            }
          }
          break;

        case kMatrix:
          {
            var address = rdpSegmentAddress(cmd1);
            var m = loadMatrix(address).elems;

            var a = [m[ 0], m[ 1], m[ 2], m[ 3]];
            var b = [m[ 4], m[ 5], m[ 6], m[ 7]];
            var c = [m[ 8], m[ 9], m[10], m[11]];
            var d = [m[12], m[13], m[14], m[15]];

            op.tip = '<div><table class="matrix-table">' +
            '<tr><td>' + a.join('</td><td>') + '</td></tr>' +
            '<tr><td>' + b.join('</td><td>') + '</td></tr>' +
            '<tr><td>' + c.join('</td><td>') + '</td></tr>' +
            '<tr><td>' + d.join('</td><td>') + '</td></tr>' +
            '</table></div>';
          }
          break;

        case kVertex:
          op.tip = previewVertex(cmd0,cmd1, ram, rdpSegmentAddress);
          break;
      }

    }

    var $currentDis = $('<pre></pre>');

    for (var i = 0; i < ops.length; ++i) {
      var op = ops[i];
      var indent = Array(op.depth).join('    ');

      var $span = $('<span />');

      $span.append('[' + n64js.toHex(op.pc,32) + '] ' + n64js.toHex(op.cmd0,32) + n64js.toHex(op.cmd1,32) + ' ' + indent + disassembleCommand(op.cmd0,op.cmd1) + '<br>' );
      if (op.tip) {
        var $d = $(op.tip);
        $d.hide();
        $span.append($d);
        $span.click(
          (function (e) {
            return function () { e.toggle() };
          })($d)
        );
      }
      $currentDis.append($span);
    }

    $currentDis.find('.dl-branch').click(function () {
      //
    });

    $dlistOutput.html($currentDis);
  }


  //
  // start
  //
  // Called when the canvas is created to get the ball rolling.
  // Figuratively, that is. There's nothing moving in this demo.
  //
  n64js.initialiseRenderer = function ($canvas) {
    var canvas = $canvas[0];

    initWebGL(canvas);      // Initialize the GL context

    // Only continue if WebGL is available and working

    if (gl) {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);  // Clear to black, fully opaque
      gl.clearDepth(1.0);                 // Clear everything
      gl.disable(gl.DEPTH_TEST);          // Enable depth testing
      gl.disable(gl.BLEND);
      gl.depthFunc(gl.LEQUAL);            // Near things obscure far things

      fillShaderProgram    = initShaders("fill-shader-vs", "fill-shader-fs");

      rectVerticesBuffer = gl.createBuffer();

      n64PositionsBuffer = gl.createBuffer();
      n64ColorsBuffer    = gl.createBuffer();
      n64UVBuffer        = gl.createBuffer();

      setCanvasViewport(canvas.clientWidth, canvas.clientHeight);
    }
  }

  var programs = {};

  var fragmentSource = null;    // We patch in our shader instructions into this source.
  var genericVertexShader = null;

  var rgbParams32 = [
    'combined.rgb', 'tex0.rgb',
    'tex1.rgb',     'prim.rgb',
    'shade.rgb',    'env.rgb',
    'one.rgb',  'combined.a',
    'tex0.a',       'tex1.a',
    'prim.a',       'shade.a',
    'env.a',        'LOD_Frac',
    'PrimLODFrac ', 'K5          ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', '?           ',
    '?           ', 'zero.rgb'
  ];
  var rgbParams16 = [
    'combined.rgb', 'tex0.rgb',
    'tex1.rgb',     'prim.rgb',
    'shade.rgb',    'env.rgb',
    'one.rgb',      'combined.a',
    'tex0.a',       'tex1.a',
    'prim.a',       'shade.a',
    'env.a',        'LOD_Frac',
    'PrimLOD_Frac', 'zero.rgb'
  ];
  var rgbParams8 = [
    'combined.rgb', 'tex0.rgb',
    'tex1.rgb',     'prim.rgb',
    'shade.rgb',    'env.rgb',
    'one.rgb',      'zero.rgb',
  ];

  var alphaParams8 = [
    'combined.a', 'tex0.a',
    'tex1.a',     'prim.a',
    'shade.a',    'env.a',
    'one.a',      'zero.a',
  ];

  function getCurrentShaderProgram(cycle_type) {

    var mux0   = state.combine.hi;
    var mux1   = state.combine.lo;

    // Check if this shader already exists. Copy/Fill are fixed-function so ignore mux for these.
    var state_text = (cycle_type === cycleTypeValues.G_CYC_1CYCLE) ? (mux0.toString(16) + mux1.toString(16)) : cycle_type;
    var program = programs[state_text];
    if (program) {
      return program;
    }

    if (!genericVertexShader) {
      genericVertexShader = getShader(gl, 'n64-shader-vs');
    }

    if (!fragmentSource) {
      var fragmentScript = document.getElementById('n64-shader-fs');
      if (fragmentScript) {
        fragmentSource = getScriptNodeSource(fragmentScript);
      }
    }

    var fragmentShader;
    var theSource = fragmentSource;

    //
    var aRGB0  = (mux0>>>20)&0x0F; // c1 c1    // a0
    var bRGB0  = (mux1>>>28)&0x0F; // c1 c2    // b0
    var cRGB0  = (mux0>>>15)&0x1F; // c1 c3    // c0
    var dRGB0  = (mux1>>>15)&0x07; // c1 c4    // d0

    var aA0    = (mux0>>>12)&0x07; // c1 a1    // Aa0
    var bA0    = (mux1>>>12)&0x07; // c1 a2    // Ab0
    var cA0    = (mux0>>> 9)&0x07; // c1 a3    // Ac0
    var dA0    = (mux1>>> 9)&0x07; // c1 a4    // Ad0

    var aRGB1  = (mux0>>> 5)&0x0F; // c2 c1    // a1
    var bRGB1  = (mux1>>>24)&0x0F; // c2 c2    // b1
    var cRGB1  = (mux0>>> 0)&0x1F; // c2 c3    // c1
    var dRGB1  = (mux1>>> 6)&0x07; // c2 c4    // d1

    var aA1    = (mux1>>>21)&0x07; // c2 a1    // Aa1
    var bA1    = (mux1>>> 3)&0x07; // c2 a2    // Ab1
    var cA1    = (mux1>>>18)&0x07; // c2 a3    // Ac1
    var dA1    = (mux1>>> 0)&0x07; // c2 a4    // Ad1

    // patch in instructions for this mux
    if (cycle_type === cycleTypeValues.G_CYC_FILL) {
      theSource = theSource.replace('{{body}}', 'col = shade;');
    } else if (cycle_type === cycleTypeValues.G_CYC_COPY) {
      theSource = theSource.replace('{{body}}', 'col = tex0;');
    } else if (cycle_type === cycleTypeValues.G_CYC_1CYCLE) {

      //var foo = 'col.rgb = tex0.rgb;';
      var foo = '';
      foo += 'col.rgb = (' + rgbParams16 [aRGB0] + ' - ' + rgbParams16 [bRGB0] + ') * ' + rgbParams32 [cRGB0] + ' + ' + rgbParams8  [dRGB0] + ';\n';
      foo += 'col.a = ('   + alphaParams8[  aA0] + ' - ' + alphaParams8[  bA0] + ') * ' + alphaParams8[  cA0] + ' + ' + alphaParams8[  dA0] + ';\n';
      foo += 'vec4 combined = vec4(col.rgb, col.a);\n';

      theSource = theSource.replace('{{body}}', foo);

      if (0) {
        var decoded = '';

        decoded += '\n';
        decoded += '\tRGB0 = (' + colcombine16[aRGB0] + ' - ' + colcombine16[bRGB0] + ') * ' + colcombine32[cRGB0] + ' + ' + colcombine8[dRGB0] + '\n';
        decoded += '\t  A0 = (' + colcombine8 [  aA0] + ' - ' + colcombine8 [  bA0] + ') * ' + colcombine8 [  cA0] + ' + ' + colcombine8[  dA0] + '\n';

        var m = theSource.split('\n').join('<br>');

        n64js.log('Compiled ' + decoded + '\nto\n' + m);
      }

    } else {
      n64js.halt(getDefine(cycleTypeValues, cycle_type) + ' is not a supported cycle type');
    }

    fragmentShader = createShader(theSource, gl.FRAGMENT_SHADER);

    var program = gl.createProgram();
    gl.attachShader(program, genericVertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    // If creating the shader program failed, alert
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      alert("Unable to initialize the shader program.");
    }

    programs[state_text] = program;

    return program;
  }

  var textures = {};
  function loadTexture(info) {
    // FIXME: need to check other properties, and recreate every frame (or when underlying data changes)
    if (textures.hasOwnProperty(info.address))
      return textures[info.address];

    var width   = info.width;
    var height  = info.height;
    var address = info.address;
    var pitch   = info.pitch;

    var fixed_w = nextPow2(width);
    var fixed_h = nextPow2(height);

    var mirror_s = info.cm_s & G_TX_MIRROR;
    var mirror_t = info.cm_t & G_TX_MIRROR;

    // if (mirror_s)
    //   fixed_w *= 2;
    // if (mirror_t)
    //   fixed_h *= 2;

    var $canvas = $( '<canvas width="' + fixed_w + '" height="' + fixed_h + '" />', {'width':fixed_w, 'height':fixed_h} );
    if (!$canvas[0].getContext)
      return null;

    var texture = gl.createTexture();

    var textureinfo = {
      'canvas':   $canvas,
      'texture':  texture,
      'nativeWidth': fixed_w,
      'nativeHeight': fixed_h
    };

    textures[info.address] = textureinfo;

    $textureOutput.append(n64js.toString32(info.address) + ', ' +
      getDefine(imageFormatTypes, info.format) + ', ' +
      getDefine(imageSizeTypes, info.size) + ',' +
      info.width + 'x' + info.height + ', ' +
      'pitch=' + info.pitch + '<br>');

    var handled = false;

    var ctx      = $canvas[0].getContext('2d');
    var img_data = ctx.createImageData(fixed_w, fixed_h);

    switch (info.format) {
      case imageFormatTypes.G_IM_FMT_RGBA:
        switch (info.size) {
          case imageSizeTypes.G_IM_SIZ_32b:
            convertRGBA32(img_data, address, width, height, pitch);
            handled = true;
            break;
          case imageSizeTypes.G_IM_SIZ_16b:
            convertRGBA16(img_data, address, width, height, pitch);
            handled = true;
            break;
        }
        break;

      case imageFormatTypes.G_IM_FMT_IA:
        switch (info.size) {
        case imageSizeTypes.G_IM_SIZ_16b:
          convertIA16(img_data, address, width, height, pitch);
          handled = true;
          break;
        case imageSizeTypes.G_IM_SIZ_8b:
          convertIA8(img_data, address, width, height, pitch);
          handled = true;
          break;
        case imageSizeTypes.G_IM_SIZ_4b:
          convertIA4(img_data, address, width, height, pitch);
          handled = true;
          break;
        }
        break;

      default:
        break;
    }

    // if (mirror_s || mirror_t) {
    //   mirror(img_data, width, height, mirror_s, mirror_t);
    // }

    if (handled) {
      ctx.putImageData(img_data, 0, 0);

      $textureOutput.append($canvas);
      $textureOutput.append('<br>');
    } else {
      $textureOutput.append(getDefine(imageFormatTypes, info.format) + '/' + getDefine(imageSizeTypes, info.size) + ' is unhandled');
      // FIXME: fill with placeholder texture
      n64js.halt('texture format unhandled!');
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, $canvas[0]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);

    var mode_s = (info.cm_s === G_TX_CLAMP || (info.mask_s === 0)) ? gl.CLAMP_TO_EDGE : (info.cm_s === G_TX_MIRROR ? gl.MIRRORED_REPEAT : gl.REPEAT);
    var mode_t = (info.cm_t === G_TX_CLAMP || (info.mask_t === 0)) ? gl.CLAMP_TO_EDGE : (info.cm_t === G_TX_MIRROR ? gl.MIRRORED_REPEAT : gl.REPEAT);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode_s);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode_t);

    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return textureinfo;
  }

  var OneToEight =
  [
    0x00,   // 0 -> 00 00 00 00
    0xff    // 1 -> 11 11 11 11
  ];

  var ThreeToEight =
  [
    0x00,   // 000 -> 00 00 00 00
    0x24,   // 001 -> 00 10 01 00
    0x49,   // 010 -> 01 00 10 01
    0x6d,   // 011 -> 01 10 11 01
    0x92,   // 100 -> 10 01 00 10
    0xb6,   // 101 -> 10 11 01 10
    0xdb,   // 110 -> 11 01 10 11
    0xff    // 111 -> 11 11 11 11
  ];

  var FourToEight =
  [
    0x00, 0x11, 0x22, 0x33,
    0x44, 0x55, 0x66, 0x77,
    0x88, 0x99, 0xaa, 0xbb,
    0xcc, 0xdd, 0xee, 0xff
  ];

  var FiveToEight =
  [
    0x00, // 00000 -> 00000000
    0x08, // 00001 -> 00001000
    0x10, // 00010 -> 00010000
    0x18, // 00011 -> 00011000
    0x21, // 00100 -> 00100001
    0x29, // 00101 -> 00101001
    0x31, // 00110 -> 00110001
    0x39, // 00111 -> 00111001
    0x42, // 01000 -> 01000010
    0x4a, // 01001 -> 01001010
    0x52, // 01010 -> 01010010
    0x5a, // 01011 -> 01011010
    0x63, // 01100 -> 01100011
    0x6b, // 01101 -> 01101011
    0x73, // 01110 -> 01110011
    0x7b, // 01111 -> 01111011

    0x84, // 10000 -> 10000100
    0x8c, // 10001 -> 10001100
    0x94, // 10010 -> 10010100
    0x9c, // 10011 -> 10011100
    0xa5, // 10100 -> 10100101
    0xad, // 10101 -> 10101101
    0xb5, // 10110 -> 10110101
    0xbd, // 10111 -> 10111101
    0xc6, // 11000 -> 11000110
    0xce, // 11001 -> 11001110
    0xd6, // 11010 -> 11010110
    0xde, // 11011 -> 11011110
    0xe7, // 11100 -> 11100111
    0xef, // 11101 -> 11101111
    0xf7, // 11110 -> 11110111
    0xff  // 11111 -> 11111111
  ];

  function mirror(img_data, width, height, mirror_s, mirror_t) {
    var data   = img_data.data;
    var stride = img_data.width*4;  // Might not be the same as width, due to power of 2

    if (mirror_s) {
      var end = ((width*2)-1) * 4;
      var row_offset = 0;
      for (var y = 0; y < height; ++y) {

        var src_idx = row_offset;
        var dst_idx = row_offset + end;

        for (var x = 0; x < width; ++x) {

          data[dst_idx + 0] = data[src_idx + 0];
          data[dst_idx + 1] = data[src_idx + 1];
          data[dst_idx + 2] = data[src_idx + 2];
          data[dst_idx + 3] = data[src_idx + 3];

          src_idx += 4;
          dst_idx -= 4;
        }
        row_offset += stride;
      }
    }

    if (mirror_t) {
      var src_offset = 0;
      var dst_offset = ((height*2)-1)*stride;

      for (var y = 0; y < height; ++y) {
        for (var x = 0; x < width*2*4; ++x) {
          data[dst_offset+x] = data[src_offset+x];
        }
        src_offset += stride;
        dst_offset -= stride;
      }
    }

  }

  function convertRGBA32(img_data, address, width, height, pitch) {
    var dst            = img_data.data;
    var src            = new DataView(state.ram.buffer, 0);

    var dst_row_stride = img_data.width*4;  // Might not be the same as width, due to power of 2
    var src_row_stride = pitch;

    var dst_row_offset = 0;
    var src_row_offset = address;
    for (var y = 0; y < height; ++y) {

      var src_offset = src_row_offset;
      var dst_offset = dst_row_offset;
      for (var x = 0; x < width; ++x) {

        var src_pixel = src.getUint32(src_offset);

        dst[dst_offset+0] = (src_pixel>>>24)&0xff;
        dst[dst_offset+1] = (src_pixel>>>16)&0xff;
        dst[dst_offset+2] = (src_pixel>>> 8)&0xff;
        dst[dst_offset+3] = (src_pixel     )&0xff;

        src_offset += 4;
        dst_offset += 4;
      }
      src_row_offset += src_row_stride;
      dst_row_offset += dst_row_stride;
    }
  }

  function convertRGBA16(img_data, address, width, height, pitch) {
    var dst            = img_data.data;
    var src            = new DataView(state.ram.buffer, 0);

    var dst_row_stride = img_data.width*4;  // Might not be the same as width, due to power of 2
    var src_row_stride = pitch;

    var dst_row_offset = 0;
    var src_row_offset = address;
    for (var y = 0; y < height; ++y) {

      var src_offset = src_row_offset;
      var dst_offset = dst_row_offset;
      for (var x = 0; x < width; ++x) {

        var src_pixel = src.getUint16(src_offset);

        dst[dst_offset+0] = FiveToEight[(src_pixel>>>11)&0x1f];
        dst[dst_offset+1] = FiveToEight[(src_pixel>>> 6)&0x1f];
        dst[dst_offset+2] = FiveToEight[(src_pixel>>> 1)&0x1f];
        dst[dst_offset+3] = ((src_pixel     )&0x01)? 255 : 0;

        src_offset += 2;
        dst_offset += 4;
      }
      src_row_offset += src_row_stride;
      dst_row_offset += dst_row_stride;
    }
  }

  function convertIA16(img_data, address, width, height, pitch) {
    var dst            = img_data.data;
    var src            = new DataView(state.ram.buffer, 0);

    var dst_row_stride = img_data.width*4;  // Might not be the same as width, due to power of 2
    var src_row_stride = pitch;

    var dst_row_offset = 0;
    var src_row_offset = address;
    for (var y = 0; y < height; ++y) {

      var src_offset = src_row_offset;
      var dst_offset = dst_row_offset;
      for (var x = 0; x < width; ++x) {

        var src_pixel = src.getUint16(src_offset);

        var i = (src_pixel>>>8)&0xff;
        var a = (src_pixel    )&0xff;

        dst[dst_offset+0] = i;
        dst[dst_offset+1] = i;
        dst[dst_offset+2] = i;
        dst[dst_offset+3] = a;

        src_offset += 2;
        dst_offset += 4;
      }
      src_row_offset += src_row_stride;
      dst_row_offset += dst_row_stride;
    }
  }

  function convertIA8(img_data, address, width, height, pitch) {
    var dst            = img_data.data;
    var src            = new DataView(state.ram.buffer, 0);

    var dst_row_stride = img_data.width*4;  // Might not be the same as width, due to power of 2
    var src_row_stride = pitch;

    var dst_row_offset = 0;
    var src_row_offset = address;
    for (var y = 0; y < height; ++y) {

      var src_offset = src_row_offset;
      var dst_offset = dst_row_offset;
      for (var x = 0; x < width; ++x) {

        var src_pixel = src.getUint8(src_offset);

        var i = FourToEight[(src_pixel>>>4)&0xf];
        var a = FourToEight[(src_pixel    )&0xf];

        dst[dst_offset+0] = i;
        dst[dst_offset+1] = i;
        dst[dst_offset+2] = i;
        dst[dst_offset+3] = a;

        src_offset += 1;
        dst_offset += 4;
      }
      src_row_offset += src_row_stride;
      dst_row_offset += dst_row_stride;
    }
  }

  function convertIA4(img_data, address, width, height, pitch) {
    var dst            = img_data.data;
    var src            = new DataView(state.ram.buffer, 0);

    var dst_row_stride = img_data.width*4;  // Might not be the same as width, due to power of 2
    var src_row_stride = pitch;

    var dst_row_offset = 0;
    var src_row_offset = address;
    for (var y = 0; y < height; ++y) {

      var src_offset = src_row_offset;
      var dst_offset = dst_row_offset;

      // Process 2 pixels at a time
      for (var x = 0; x+1 < width; x+=2) {

        var src_pixel = src.getUint8(src_offset);

        var i0 = ThreeToEight[(src_pixel&0xe0)>>>5];
        var a0 =   OneToEight[(src_pixel&0x10)>>>4];

        var i1 = ThreeToEight[(src_pixel&0x0e)>>>1];
        var a1 =   OneToEight[(src_pixel&0x01)>>>0];

        dst[dst_offset+0] = i0;
        dst[dst_offset+1] = i0;
        dst[dst_offset+2] = i0;
        dst[dst_offset+3] = a0;

        dst[dst_offset+4] = i1;
        dst[dst_offset+5] = i1;
        dst[dst_offset+6] = i1;
        dst[dst_offset+7] = a1;

        src_offset += 1;
        dst_offset += 8;
      }

      // Handle trailing pixel, if odd width
      if (width&1) {
        var src_pixel = src.getUint8(src_offset);

        var i0 = ThreeToEight[(src_pixel&0xe0)>>>5];
        var a0 =   OneToEight[(src_pixel&0x10)>>>4];

        dst[dst_offset+0] = i0;
        dst[dst_offset+1] = i0;
        dst[dst_offset+2] = i0;
        dst[dst_offset+3] = a0;

        src_offset += 1;
        dst_offset += 4;
      }

      src_row_offset += src_row_stride;
      dst_row_offset += dst_row_stride;
    }
  }

})();