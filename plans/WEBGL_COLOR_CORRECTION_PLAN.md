# WebGL Color Correction System Plan

## Overview

This document outlines a comprehensive plan for implementing real-time color correction and image adjustments using WebGL in the ImageCanvas project. The system would allow users to apply non-destructive color adjustments to images with hardware-accelerated performance.

## Core Features

### Color Adjustments
- **Brightness**: Adjust overall image luminance (-100 to +100)
- **Contrast**: Modify tonal range (-100 to +100)
- **Saturation**: Control color intensity (-100 to +100)
- **Hue**: Shift colors around the color wheel (-180° to +180°)
- **Temperature**: Warm/cool color balance adjustment
- **Tint**: Green/magenta balance correction
- **Highlights/Shadows**: Separate control over light and dark areas
- **Vibrance**: Smart saturation that protects skin tones

### Advanced Features
- **Curves**: RGB and individual channel curve adjustments
- **Color Grading**: Split-toning for highlights and shadows
- **Levels**: Black point, white point, and gamma adjustments
- **HSL Adjustments**: Target specific color ranges

## Architecture

### 1. WebGL Renderer Layer
```javascript
class WebGLImageRenderer {
    constructor(canvas) {
        this.gl = canvas.getContext('webgl2');
        this.shaderPrograms = new Map();
        this.framebuffers = new Map();
        this.textures = new Map();
    }
    
    // Compile and cache shaders for each effect
    initializeShaders() {
        this.compileShader('colorAdjustment', vertexShader, colorAdjustmentFragmentShader);
        this.compileShader('curves', vertexShader, curvesFragmentShader);
        // ... more shaders
    }
    
    // Apply adjustments to image
    renderWithAdjustments(imageNode, adjustments) {
        // Bind texture, set uniforms, render
    }
}
```

### 2. Shader System

#### Basic Color Adjustment Fragment Shader
```glsl
precision highp float;

uniform sampler2D u_image;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hue;

varying vec2 v_texCoord;

vec3 rgb2hsv(vec3 c) {
    // HSV conversion implementation
}

vec3 hsv2rgb(vec3 c) {
    // RGB conversion implementation
}

void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    
    // Brightness
    color.rgb += u_brightness;
    
    // Contrast
    color.rgb = (color.rgb - 0.5) * (1.0 + u_contrast) + 0.5;
    
    // Saturation & Hue in HSV space
    vec3 hsv = rgb2hsv(color.rgb);
    hsv.y *= (1.0 + u_saturation);
    hsv.x += u_hue / 360.0;
    color.rgb = hsv2rgb(hsv);
    
    gl_FragColor = vec4(color.rgb, color.a);
}
```

### 3. Integration with Canvas System

```javascript
class ImageNode extends BaseNode {
    constructor() {
        super('media/image');
        // ... existing properties
        
        // Color adjustment properties
        this.adjustments = {
            brightness: 0,
            contrast: 0,
            saturation: 0,
            hue: 0,
            temperature: 0,
            tint: 0,
            highlights: 0,
            shadows: 0,
            vibrance: 0,
            // Curves data
            curves: {
                rgb: [], // Control points
                r: [],
                g: [],
                b: []
            }
        };
        
        // WebGL resources
        this.glTexture = null;
        this.adjustedCanvas = null;
        this.needsGLUpdate = true;
    }
    
    updateAdjustments(newAdjustments) {
        Object.assign(this.adjustments, newAdjustments);
        this.needsGLUpdate = true;
        this.dirty = true;
    }
}
```

### 4. Render Pipeline Integration

```javascript
// In canvas.js drawNode method
drawNode(ctx, node) {
    if (node.type === 'media/image' && node.hasAdjustments()) {
        // Use WebGL-processed canvas if adjustments exist
        const processedCanvas = this.webglRenderer.getProcessedCanvas(node);
        ctx.drawImage(processedCanvas, node.pos[0], node.pos[1], node.size[0], node.size[1]);
    } else {
        // Regular drawing path
        // ... existing code
    }
}
```

## UI/UX Design

### Adjustment Panel
- **Floating Panel**: Similar to properties inspector
- **Real-time Preview**: Adjustments apply instantly
- **Presets**: Save and load adjustment combinations
- **Reset**: One-click reset to original
- **Before/After Toggle**: Quick comparison view

### Controls Layout
```
┌─────────────────────────────┐
│ Color Adjustments           │
├─────────────────────────────┤
│ Brightness    [----|----]   │
│ Contrast      [----|----]   │
│ Saturation    [----|----]   │
│ Hue           [----|----]   │
├─────────────────────────────┤
│ Temperature   [----|----]   │
│ Tint          [----|----]   │
├─────────────────────────────┤
│ Highlights    [----|----]   │
│ Shadows       [----|----]   │
│ Vibrance      [----|----]   │
├─────────────────────────────┤
│ [Curves] [Presets] [Reset]  │
└─────────────────────────────┘
```

## Performance Considerations

### 1. Caching Strategy
- Cache processed textures when adjustments stabilize
- Invalidate cache on adjustment change
- Use lower resolution for real-time preview
- Full resolution on adjustment completion

### 2. GPU Memory Management
- Limit simultaneous WebGL contexts
- Share WebGL context across all adjusted images
- Dispose unused textures promptly
- Implement texture atlas for small images

### 3. Fallback System
- Canvas 2D fallback for WebGL-unsupported browsers
- CPU-based adjustments for small images
- Progressive enhancement approach

## Implementation Phases

### Phase 1: Basic Adjustments
- Brightness, Contrast, Saturation, Hue
- WebGL infrastructure setup
- Basic UI panel

### Phase 2: Advanced Color
- Temperature/Tint
- Highlights/Shadows
- Vibrance
- Improved shader efficiency

### Phase 3: Professional Tools
- Curves editor
- HSL targeted adjustments
- Color grading
- LUT support

### Phase 4: Optimization & Polish
- Performance optimization
- Preset system
- Batch adjustments
- Export with adjustments

## Collaborative Considerations

### Syncing Adjustments
- Adjustments stored as node properties
- Sync through existing operation pipeline
- Efficient diff-based updates

### Operation Commands
```javascript
{
    type: 'node_adjust_colors',
    params: {
        nodeId: 'node-123',
        adjustments: {
            brightness: 0.1,
            contrast: 0.2
            // ... other adjustments
        }
    }
}
```

## Benefits

1. **Non-Destructive**: Original image data preserved
2. **Real-Time**: Hardware-accelerated performance
3. **Professional**: Industry-standard adjustment tools
4. **Integrated**: Works with existing canvas system
5. **Collaborative**: Adjustments sync across users

## Technical Requirements

- WebGL 2.0 support (with WebGL 1.0 fallback)
- Efficient shader compilation and caching
- GPU memory management
- Color space conversions (sRGB, Linear RGB)
- High precision calculations (16-bit minimum)

## Future Enhancements

- AI-powered auto adjustments
- Histogram display
- Scopes (waveform, vectorscope)
- RAW image support
- 3D LUT support
- Masking and selective adjustments