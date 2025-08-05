# LOD and Thumbnail System

## Overview

ImageCanvas uses a sophisticated multi-resolution system that combines:
1. **Server-side thumbnail generation** - Thumbnails generated on upload
2. **TextureLODManager** - WebGL texture management with automatic LOD selection
3. **Client-side thumbnail cache** - Fast access to generated thumbnails

## How It Works

### 1. Image Upload Flow

When an image is uploaded:
1. Original image uploaded to `/uploads/` 
2. Server generates thumbnails at multiple sizes (64, 128, 256, 512, 1024, 2048)
3. Thumbnails saved as WebP at `/thumbnails/{size}/{filename}.webp`

### 2. TextureLODManager

The `TextureLODManager` handles all texture loading for the WebGL renderer:

```javascript
// Automatic LOD selection based on screen size
const optimalLOD = lodManager.getOptimalLOD(screenWidth, screenHeight);

// LOD levels match server thumbnails:
// 64, 128, 256, 512, 1024, 2048, full
```

Features:
- **Automatic LOD selection** based on node's screen size
- **Texture memory management** (512MB default limit)
- **LRU eviction** when memory limit reached
- **Viewport-aware loading** - prioritizes visible nodes
- **Protection for preview textures** - never evicts 256px and below

### 3. Client-Side Thumbnail Cache

The `ThumbnailCache` manages client-generated thumbnails:
- Generates thumbnails progressively during import
- Stores in memory with size limits
- Provides instant access for rendering

### 4. Server Thumbnail Endpoints

Thumbnails are served from:
```
GET /thumbnails/{size}/{filename}.webp
```

Example:
```
/thumbnails/256/image123.webp
/thumbnails/1024/image123.webp
```

## Key Components

### TextureLODManager (js/renderers/TextureLODManager.js)

Manages WebGL textures with automatic LOD selection:
- Loads appropriate resolution based on zoom level
- Manages texture memory (512MB limit)
- Handles upload queue with frame budget
- Protects actively rendered textures from eviction

### ThumbnailCache (js/utils/cache.js)

Client-side thumbnail generation and caching:
- Progressive thumbnail generation
- Memory-aware storage
- Subscription system for updates

### WebGLRenderer Integration

The renderer automatically uses the LOD system:
```javascript
// In drawNode()
const texture = this.lodManager.getBestTexture(
    node.properties.hash,
    screenWidth,
    screenHeight
);
```

## Benefits

1. **Performance**
   - Only loads resolution needed for current zoom
   - Reduces GPU memory usage
   - Smooth zooming with progressive enhancement

2. **Scalability**
   - Handles thousands of images
   - Automatic memory management
   - Smart eviction of unused textures

3. **Quality**
   - High-quality downsampling with mipmaps
   - Anisotropic filtering for sharp angles
   - Seamless LOD transitions

## Memory Management

The system implements multiple layers of memory protection:

1. **Texture Memory Limit** (512MB)
   - LRU eviction when limit reached
   - Never evicts preview textures (≤256px)
   - Protects actively rendered textures

2. **Full Resolution Limit** (10 textures)
   - Limits number of full-res textures in memory
   - Automatically downgrades when limit reached
   - Keeps lower resolutions available

3. **Viewport-Based Unloading**
   - Unloads high-res textures for off-screen nodes
   - Keeps preview resolutions for quick display
   - Aggressive mode for critical memory situations

## Usage

The system works automatically:

1. **Upload** - Server generates thumbnails
2. **Display** - LODManager selects appropriate resolution
3. **Zoom** - Higher resolutions loaded as needed
4. **Pan** - Off-screen textures unloaded

## Debugging

```javascript
// Check texture cache status
window.checkTextureCache();

// Enable LOD debugging
window.DEBUG_LOD_STATUS = true;

// View memory usage
const stats = window.app.graphCanvas.webglRenderer.lodManager.getStats();
```

## Future Improvements

1. **Compressed Textures** - Use DXT/ETC2/ASTC compression (4-6x reduction)
2. **Progressive Loading** - Load low-res first, upgrade progressively
3. **Predictive Loading** - Pre-load based on pan/zoom direction
4. **CDN Integration** - Serve thumbnails from CDN for better performance