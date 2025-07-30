# WebGL LOD System Documentation

## Overview

The WebGL LOD (Level of Detail) system provides high-performance texture management for rendering hundreds of images with smooth interaction. It automatically selects the appropriate resolution based on display size and manages GPU memory efficiently.

## Architecture

### Core Components

1. **TextureLODManager** (`js/renderers/TextureLODManager.js`)
   - Manages multiple resolution levels per image
   - Implements LRU cache with memory limits
   - Progressive texture uploading within frame budget
   - Automatic LOD selection based on screen size

2. **TextureAtlasManager** (`js/renderers/TextureAtlasManager.js`)
   - Packs 64x64 thumbnails into 4096x4096 texture atlases
   - Reduces texture switches and draw calls
   - Efficient for rendering many small images

3. **WebGLRenderer** (Enhanced)
   - Integrates LOD and atlas managers
   - Frame budget management (2ms for uploads, 1ms for packing)
   - Falls back to Canvas2D when textures aren't ready

## Features

### Multi-Resolution Support
- 5 LOD levels: 64px, 256px, 512px, 1024px, and full resolution
- Automatic selection based on display size
- Seamless transitions between levels

### Memory Management
- Configurable memory limit (default 512MB)
- LRU eviction when approaching limits
- Tracks texture memory usage precisely

### Performance Optimizations
- Frame budget prevents stuttering
- Progressive loading prioritizes visible content
- High-quality filtering with mipmaps
- Anisotropic filtering for sharp textures

### Quality Features
- Linear mipmap filtering prevents aliasing
- 16x anisotropic filtering when available
- Proper edge clamping for clean borders

## Usage

The system works automatically when WebGL renderer is enabled:

```javascript
// Enable WebGL renderer in config
CONFIG.RENDERER = { DEFAULT: 'webgl' };
```

## Benefits

1. **Smooth 60fps interaction** - Even with 1000+ images
2. **Optimal memory usage** - Only loads necessary resolutions
3. **High visual quality** - No aliasing or screen-door effects
4. **Progressive enhancement** - Shows low quality immediately, improves over time

## Debug Tools

- **Thumbnail Debug Tinting** - Visual overlay showing which LOD is used
- **WebGL LOD Statistics** - Real-time performance monitoring
- Both tools available in `.scratch/` directory

## Future Enhancements

1. **LOD Blending** - Smooth transitions between quality levels
2. **Instanced Rendering** - Batch draw calls for same LOD
3. **Predictive Loading** - Pre-load textures near viewport
4. **WebGL2 Features** - PBOs for async uploads

## Technical Details

### LOD Selection Algorithm
```
if (screenSize <= 96) return 64;
if (screenSize <= 384) return 256;
if (screenSize <= 768) return 512;
return null; // Full resolution
```

### Memory Calculation
- Base texture: width × height × 4 bytes
- With mipmaps: × 1.33
- Atlas efficiency: ~95% utilization

### Frame Budget
- 2ms for texture uploads per frame
- 1ms for atlas packing per frame
- Ensures consistent 60fps rendering