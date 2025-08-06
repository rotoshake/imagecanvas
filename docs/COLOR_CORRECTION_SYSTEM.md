# Color Correction System

## Overview

ImageCanvas provides a comprehensive color correction system with GPU-accelerated processing, allowing real-time adjustments to images and videos through an intuitive floating panel interface.

## Architecture

### Components

1. **FloatingColorCorrection** (`js/ui/floating-color-correction.js`)
   - Main UI panel controller
   - Manages all color correction interfaces
   - Handles state persistence and undo/redo integration

2. **SplineCurveEditor** (`js/ui/components/spline-curve-editor.js`)
   - Interactive tone curve editor
   - Catmull-Rom spline interpolation
   - Real-time curve preview

3. **ColorBalanceWheel** (`js/ui/components/color-balance-wheel.js`)
   - Three-way color grading wheels
   - YUV color space manipulation
   - Separate controls for shadows/midtones/highlights

4. **WebGLRenderer** (`js/renderers/WebGLRenderer.js`)
   - GPU-accelerated processing
   - Shader-based color corrections
   - Efficient texture caching

## User Interface

### Main Panel Features
- **Draggable Window**: Positioned anywhere on screen
- **Persistent State**: Position and visibility saved
- **Selection Integration**: Auto-shows for selected media
- **Keyboard Shortcut**: 'C' to toggle visibility

### Tone Curve Section
- **Interactive Graph**: Click to add points, drag to adjust
- **Auto-Smoothing**: Catmull-Rom splines for smooth curves
- **Point Management**: Right-click to remove points
- **Visual Feedback**: Grid and diagonal reference line
- **Bypass Toggle**: Disable without losing settings

### Color Adjustments
Individual sliders with visual gradients:
- **Brightness**: -1 to +1 range
- **Contrast**: -1 to +1 range  
- **Saturation**: -1 to +1 range
- **Hue**: -180° to +180° rotation
- **Temperature**: Cool to warm adjustment
- **Tint**: Green to magenta balance

### Color Balance Panel
- **Three Wheels**: Shadows, midtones, highlights
- **Vectorscope-Based**: NTSC color angle mapping
- **YRGB Display**: Real-time value readout
- **Luminance Control**: Y-axis adjustment per range
- **Separate Window**: Additional floating panel

## Technical Implementation

### GPU Processing Pipeline

1. **Texture Upload**: Original image to GPU
2. **Shader Processing**: 
   - Tone curve LUT application
   - Color matrix transformations
   - Three-way color balance
3. **Cache Management**: LOD-specific result caching

### Shader Implementation

```glsl
// Tone Curve Application
vec3 applyToneCurve(vec3 color, sampler2D curveLUT) {
    return vec3(
        texture2D(curveLUT, vec2(color.r, 0.0)).r,
        texture2D(curveLUT, vec2(color.g, 0.0)).g,
        texture2D(curveLUT, vec2(color.b, 0.0)).b
    );
}

// Color Adjustments
vec3 applyAdjustments(vec3 color, ColorAdjustments adj) {
    // Brightness
    color = color + vec3(adj.brightness);
    
    // Contrast
    color = (color - 0.5) * (1.0 + adj.contrast) + 0.5;
    
    // Saturation (in HSL space)
    // ... HSL conversion and adjustment
    
    return color;
}
```

### Color Balance Algorithm

Uses three-range lift/gamma/gain approach:
- **Shadows**: Affects dark tones (0-0.25 range)
- **Midtones**: Affects middle values (0.25-0.75)
- **Highlights**: Affects bright areas (0.75-1.0)

Smooth transitions between ranges using weight functions.

## Data Storage

### Node Properties
```javascript
{
    // Tone curve data
    toneCurve: {
        controlPoints: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 }
        ]
    },
    
    // Color adjustments
    adjustments: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        hue: 0,
        temperature: 0,
        tint: 0
    },
    
    // Color balance
    colorBalance: {
        shadows: { x: 0, y: 0, luminance: 0.5 },
        midtones: { x: 0, y: 0, luminance: 0.5 },
        highlights: { x: 0, y: 0, luminance: 0.5 }
    },
    
    // Bypass states
    toneCurveBypassed: false,
    colorAdjustmentsBypassed: false,
    colorBalanceBypassed: false
}
```

## Performance Optimizations

### Caching Strategy
1. **LOD-Specific Caches**: Separate cache per detail level
2. **Adjustment Tracking**: Only re-render on changes
3. **Texture Reuse**: GPU textures kept alive during edits

### Memory Management
- **Texture Limits**: Automatic cleanup near memory limits
- **Cache Invalidation**: Smart invalidation on adjustment
- **Deferred Updates**: Batch multiple adjustments

### Rendering Optimizations
- **Idle Detection**: Skip re-renders when values unchanged
- **Progressive Updates**: Low-quality preview during adjustment
- **Final Quality**: Full resolution on interaction end

## Integration

### Undo/Redo System
- **Interaction Grouping**: Drag operations as single undo
- **Property Tracking**: Each adjustment type tracked
- **Server Sync**: All changes persisted to server

### Real-time Collaboration
- **Live Updates**: Color corrections sync across users
- **Optimistic Application**: Immediate local preview
- **Conflict Resolution**: Last-write-wins per property

### Video Support
- **Frame-Independent**: Corrections apply to all frames
- **Real-time Preview**: GPU processing maintains playback
- **Same Interface**: Unified controls for images/video

## User Workflow

### Basic Workflow
1. Select image or video node
2. Press 'C' or click color correction button
3. Make adjustments with real-time preview
4. Changes auto-save to server

### Advanced Techniques
- **Tone Mapping**: S-curve for contrast enhancement
- **Color Grading**: Film-style looks with color balance
- **Split Toning**: Different colors for highlights/shadows
- **Neutral Correction**: Temperature/tint for white balance

### Bypass Workflow
- Toggle individual sections while comparing
- A/B comparison without losing settings
- Quick reset via bypass all

## Keyboard Shortcuts

- **C**: Toggle color correction panel
- **Double-click sliders**: Reset to default
- **Alt+Drag**: Fine adjustment control
- **Shift+Click curve**: Snap to diagonal

## Best Practices

### Performance Tips
1. Close panel when not actively adjusting
2. Use bypass instead of zeroing values
3. Work at lower zoom for faster preview

### Quality Guidelines
1. Start with tone curve for overall contrast
2. Fine-tune with individual adjustments
3. Use color balance for creative looks
4. Check results at different zoom levels

## Future Enhancements

### Planned Features
- Histogram overlay on tone curve
- Preset system with save/load
- Mask-based local adjustments
- Auto-correction algorithms
- Batch processing for multiple nodes
- LUT import/export support

### UI Improvements
- Before/after split view
- Numerical input for precise values
- Color picker for target matching
- Scope displays (waveform, vectorscope)