# WebGL Rendering System

## Overview

ImageCanvas uses a sophisticated WebGL-based rendering system that provides hardware-accelerated image display with advanced features like LOD (Level of Detail) management, texture caching, and real-time color correction.

## Architecture

### Core Components

1. **WebGLRenderer** (`js/renderers/WebGLRenderer.js`)
   - Main rendering engine
   - Shader management
   - Draw call optimization
   - Color correction integration

2. **TextureLODManager** (`js/renderers/TextureLODManager.js`)
   - Multi-resolution texture management
   - Memory limit enforcement
   - Automatic quality selection
   - Cache lifecycle management

3. **Shader System**
   - Modular shader architecture
   - Real-time uniform updates
   - Efficient state management

## LOD (Level of Detail) System

### Overview
The LOD system automatically selects and renders the appropriate image resolution based on the current zoom level, optimizing both performance and memory usage.

### LOD Levels
```javascript
LOD_THRESHOLDS = [
    { maxScale: 0.125, size: 64 },    // Very zoomed out
    { maxScale: 0.25, size: 128 },    
    { maxScale: 0.5, size: 256 },     
    { maxScale: 1.0, size: 512 },     // 1:1 view
    { maxScale: 2.0, size: 1024 },    
    { maxScale: Infinity, size: 2048 } // Maximum quality
]
```

### Cached Rendering
The system pre-renders color-corrected versions at each LOD level:
1. Original texture uploaded to GPU
2. Color corrections applied via shaders
3. Result rendered to framebuffer
4. Cached texture stored for reuse
5. Cache invalidated on adjustment change

## Memory Management

### Automatic Limits
```javascript
// Memory limits by device type
Desktop: 512MB
Mobile/Tablet: 128MB

// Automatic detection and adjustment
const isMobile = /mobile|tablet/i.test(navigator.userAgent);
const memoryLimit = isMobile ? 128 * 1024 * 1024 : 512 * 1024 * 1024;
```

### Texture Lifecycle
1. **Creation**: On-demand when needed
2. **Caching**: Stored in VRAM for reuse
3. **Eviction**: LRU when approaching limits
4. **Disposal**: Proper cleanup of GPU resources

### Memory Monitoring
- Real-time usage tracking
- Automatic quality reduction near limits
- Warning system for memory pressure
- Graceful degradation strategy

## Rendering Pipeline

### Standard Flow
1. **Check Cache**: Look for existing LOD texture
2. **Load if Needed**: Request appropriate resolution
3. **Upload to GPU**: Create WebGL texture
4. **Apply Corrections**: If color corrections active
5. **Render**: Draw with optimized shader
6. **Cache Result**: Store for future frames

### Optimization Techniques

#### Texture Atlasing
- Batch multiple small images
- Reduce texture switches
- Optimize draw calls

#### State Management
- Minimize WebGL state changes
- Batch similar renders
- Shader program reuse

#### Idle Optimization
Eliminates unnecessary 60fps rendering:
```javascript
// Only render when:
- Canvas is dirty (dirty_canvas flag)
- Animations are active
- User is interacting
- Nodes are loading
```

## Shader System

### Base Vertex Shader
```glsl
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform mat3 u_matrix;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);
    v_texCoord = a_texCoord;
}
```

### Fragment Shader with Color Correction
```glsl
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_toneCurveLUT;
uniform float u_brightness;
uniform float u_contrast;
// ... other uniforms

void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    
    // Apply tone curve
    if (u_toneCurveEnabled > 0.5) {
        color.rgb = applyToneCurve(color.rgb, u_toneCurveLUT);
    }
    
    // Apply adjustments
    color.rgb = applyColorAdjustments(color.rgb);
    
    // Apply color balance
    color.rgb = applyColorBalance(color.rgb);
    
    gl_FragColor = color;
}
```

## Integration with Canvas

### Initialization
```javascript
// Create WebGL renderer
const renderer = new WebGLRenderer(canvas, {
    maxTextureSize: 4096,
    antialias: true,
    preserveDrawingBuffer: false
});

// Initialize LOD manager
renderer.lodManager = new TextureLODManager(renderer);
```

### Render Loop Integration
```javascript
// In canvas render method
drawNode(node) {
    if (node.type === 'media/image' && WEBGL_ENABLED) {
        renderer.renderImage(node, viewport);
    } else {
        // Fallback to 2D canvas
        this.drawImage2D(node);
    }
}
```

## Performance Monitoring

### Metrics Tracked
- Draw calls per frame
- Texture memory usage
- Cache hit rate
- Render time per frame
- State changes count

### Debug Overlay
When enabled, displays:
- Current FPS
- Memory usage graph
- Active texture count
- Cache statistics
- LOD distribution

## Best Practices

### Texture Management
1. **Preload Critical Images**: Load important images early
2. **Release Unused**: Explicitly dispose when done
3. **Batch Operations**: Group similar renders
4. **Monitor Memory**: Watch for pressure warnings

### Performance Tips
1. **Limit Simultaneous Loads**: Queue texture uploads
2. **Use Appropriate LODs**: Don't over-render
3. **Cache Aggressively**: Reuse computed results
4. **Profile Regularly**: Monitor performance metrics

### Color Correction
1. **Batch Updates**: Apply multiple adjustments together
2. **Use Bypass**: Instead of zeroing values
3. **Cache Results**: Leverage LOD caching
4. **Preview Quality**: Lower quality during adjustment

## Troubleshooting

### Common Issues

#### Black/Missing Images
- Check WebGL context creation
- Verify texture upload succeeded
- Ensure shader compilation worked
- Check for WebGL context loss

#### Performance Problems
- Monitor texture memory usage
- Check for texture thrashing
- Verify LOD selection logic
- Profile shader complexity

#### Memory Issues
- Reduce memory limits for device
- Implement more aggressive eviction
- Use lower maximum LOD
- Enable memory warnings

### Debug Tools
```javascript
// Enable debug mode
renderer.debug = true;

// Log statistics
console.log(renderer.getStats());

// Force cache clear
renderer.clearAllCaches();

// Dump texture info
renderer.dumpTextureInfo();
```

## Future Enhancements

### Planned Features
- WebGL2 support for better performance
- Texture compression (BASIS/KTX2)
- Multi-threaded texture decode
- Adaptive quality based on GPU
- Texture streaming for huge images
- GPU-accelerated image filters

### Optimization Opportunities
- Instanced rendering for duplicates
- Geometry batching
- Shader permutation reduction
- Async shader compilation
- WebGPU migration path