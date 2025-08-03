# Cached Rendering System for Color Corrections

## Overview
The cached rendering system improves performance when multiple nodes have color corrections applied by caching the rendered results and only re-rendering the actively adjusted node in real-time.

## Implementation Details

### 1. Active Node Tracking
The FloatingColorCorrection UI component notifies the WebGLRenderer when adjustments begin and end:

- `updateNodeAdjustment()` - Calls `startAdjustment()` on drag, `endAdjustment()` on release
- `updateNodeCurve()` - Tracks tone curve adjustments
- `updateColorBalance()` - Tracks color balance wheel adjustments

### 2. Cache Management in WebGLRenderer

#### Properties
```javascript
// Cache storage
this.colorCorrectedCache = new Map(); // nodeId -> cached render data
this.activeAdjustmentNodeId = null;   // Currently adjusted node
this.maxCachedTextures = 50;          // Maximum cached textures
this.maxCacheMemory = 256 * 1024 * 1024; // 256MB limit
```

#### Key Methods
- `nodeHasColorCorrection(node)` - Checks if node has any active corrections
- `_getCachedOrRender(node, sourceTexture)` - Returns cached texture or renders new one
- `_renderToTexture(node, source, width, height)` - Renders node with corrections to FBO
- `_isCacheValid(node, cached)` - Validates if cache matches current state
- `_invalidateCache(nodeId)` - Clears cache for specific node

### 3. Integration in drawNode()

The main rendering path now checks:
1. Does the node have color corrections?
2. Is it the actively adjusted node?
3. For videos, is it paused?

If conditions are met, it uses the cached texture instead of rendering with the color correction shader.

### 4. Special Cases

#### Video Nodes
- Playing videos always render in real-time (no caching)
- Paused videos are cached like images
- Cache is invalidated when playback state changes

#### Memory Management
- Tracks total GPU memory usage
- Evicts oldest cached textures when limits are reached
- Configurable limits for both texture count and memory usage

## Performance Benefits

1. **Reduced Shader Operations**: Non-active nodes skip color correction calculations
2. **GPU Memory Trade-off**: Uses texture memory to save computation
3. **Smooth Interactions**: Active node renders at full framerate
4. **Scalability**: Performance remains constant regardless of correction complexity

## Usage

The system works automatically when:
1. Multiple images have color corrections applied
2. User adjusts one image via the FloatingColorCorrection panel
3. Only the actively adjusted image renders in real-time
4. Other images use cached renders

## Debug Output

Enable console logging to see:
- Cache hits/misses
- Active adjustment tracking
- Memory usage statistics

## Configuration

Adjust cache limits in WebGLRenderer constructor:
```javascript
this.maxCachedTextures = 50;  // Maximum number of cached textures
this.maxCacheMemory = 256 * 1024 * 1024; // Maximum GPU memory for cache
```