# Complete LOD System Refactor Proposal

## Current Problems
1. **Multiple competing caching systems** - LOD textures, color-corrected textures, thumbnail cache
2. **Inconsistent priority logic** - Different code paths assign different priorities
3. **Poor eviction strategy** - Evicts textures that are about to be needed again
4. **Thrashing** - Constantly loading/unloading the same textures
5. **Complex decision trees** - Too many conditions and edge cases

## Design Principles for New System

### 1. Single Source of Truth
- ONE texture manager that handles everything (LOD, color correction, caching)
- ONE priority queue for all texture operations
- ONE eviction strategy based on viewport distance and zoom level

### 2. Predictive Loading
- Pre-load textures for nodes just outside viewport
- Pre-load next LOD level when zooming
- Keep recently used textures warm in cache

### 3. Aggressive Performance
- Never block the main thread
- Use web workers for decode operations
- Stream textures progressively (low res → high res)

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   TextureManager                         │
│  (Single unified manager for all texture operations)     │
├─────────────────────────────────────────────────────────┤
│  • Viewport-aware priority queue                         │
│  • Unified texture cache (LOD + color correction)        │
│  • Smart eviction based on viewport distance             │
│  • Web Worker decode pool                                │
└─────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Priority     │     │ Cache        │     │ Decode       │
│ Calculator   │     │ Manager      │     │ Workers      │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ • Viewport   │     │ • Memory     │     │ • Parallel   │
│   distance   │     │   limits     │     │   decode     │
│ • Zoom level │     │ • Smart      │     │ • Off-thread │
│ • Visibility │     │   eviction   │     │ • Progressive│
└──────────────┘     └──────────────┘     └──────────────┘
```

## Core Components

### 1. Unified TextureManager

```javascript
class TextureManager {
    constructor(gl, options) {
        this.gl = gl;
        this.maxMemory = options.maxMemory || 1.5 * 1024 * 1024 * 1024; // 1.5GB
        
        // Single cache for everything
        this.cache = new Map(); // key -> TextureEntry
        
        // Priority queue for loading
        this.loadQueue = new PriorityQueue();
        
        // Decode workers
        this.decodeWorkers = new WorkerPool(4);
        
        // Viewport tracking
        this.viewport = null;
        this.frameId = 0;
    }
    
    // Single entry point for texture requests
    requestTexture(node, screenSize) {
        const key = this.getTextureKey(node, screenSize);
        
        // Check cache first
        if (this.cache.has(key)) {
            this.cache.get(key).lastAccess = this.frameId;
            return this.cache.get(key).texture;
        }
        
        // Calculate priority based on viewport
        const priority = this.calculatePriority(node, screenSize);
        
        // Add to load queue
        this.loadQueue.add({
            node,
            screenSize,
            priority,
            key
        });
        
        // Return placeholder or lower res if available
        return this.getBestAvailable(node);
    }
}
```

### 2. Smart Priority Calculation

```javascript
calculatePriority(node, screenSize) {
    const viewport = this.viewport;
    if (!viewport) return 100; // Default low priority
    
    // 1. Distance from viewport center (0-1, 0 = center)
    const nodeCenter = [
        node.pos[0] + node.size[0] / 2,
        node.pos[1] + node.size[1] / 2
    ];
    const viewportCenter = viewport.getCenter();
    const maxDistance = Math.sqrt(viewport.width * viewport.width + viewport.height * viewport.height);
    const distance = Math.min(1, 
        Math.sqrt(
            Math.pow(nodeCenter[0] - viewportCenter[0], 2) +
            Math.pow(nodeCenter[1] - viewportCenter[1], 2)
        ) / maxDistance
    );
    
    // 2. Viewport coverage (0-1, 1 = fills viewport)
    const coverage = Math.min(1, (screenSize * screenSize) / (viewport.width * viewport.height));
    
    // 3. Is visible (0 or 1)
    const visible = this.isNodeVisible(node) ? 0 : 0.5;
    
    // 4. LOD appropriateness (0-1, 0 = perfect LOD for zoom)
    const optimalLOD = this.getOptimalLOD(screenSize);
    const currentLOD = this.getCurrentLOD(node);
    const lodScore = currentLOD ? Math.abs(optimalLOD - currentLOD) / 2048 : 1;
    
    // Combined priority (lower = higher priority)
    // Heavily weight visibility and coverage for zoomed content
    const priority = (
        distance * 0.2 +      // 20% weight on distance
        (1 - coverage) * 0.4 + // 40% weight on coverage (inverted)
        visible * 0.3 +        // 30% weight on visibility
        lodScore * 0.1         // 10% weight on LOD match
    );
    
    return priority;
}
```

### 3. Aggressive Memory Management

```javascript
class CacheManager {
    constructor(maxMemory) {
        this.maxMemory = maxMemory;
        this.currentMemory = 0;
        this.entries = new Map();
    }
    
    // Evict based on viewport-aware scoring
    evict(requiredMemory) {
        const candidates = Array.from(this.entries.values())
            .map(entry => ({
                entry,
                score: this.getEvictionScore(entry)
            }))
            .sort((a, b) => b.score - a.score); // Higher score = evict first
        
        let freed = 0;
        for (const { entry } of candidates) {
            if (freed >= requiredMemory) break;
            
            // Never evict textures currently on screen
            if (entry.isVisible) continue;
            
            // Never evict textures that were just loaded
            if (this.frameId - entry.loadFrame < 60) continue; // 1 second protection
            
            this.removeEntry(entry);
            freed += entry.memorySize;
        }
    }
    
    getEvictionScore(entry) {
        // Higher score = more likely to evict
        const age = this.frameId - entry.lastAccess;
        const distance = entry.viewportDistance || 1;
        const size = entry.memorySize / (1024 * 1024); // MB
        
        return (
            age * 0.4 +           // 40% weight on age
            distance * 0.4 +      // 40% weight on distance from viewport
            size * 0.2            // 20% weight on memory size
        );
    }
}
```

### 4. Progressive Loading Strategy

```javascript
class ProgressiveLoader {
    async loadTexture(node, targetLOD) {
        const levels = [64, 128, 256, 512, 1024, 2048, null]; // null = full res
        
        // Find starting point (best available)
        let startIndex = 0;
        for (let i = 0; i < levels.length; i++) {
            if (this.hasTexture(node, levels[i])) {
                startIndex = i + 1;
            }
        }
        
        // Load progressively up to target
        const targetIndex = levels.indexOf(targetLOD);
        for (let i = startIndex; i <= targetIndex; i++) {
            // Load in background, don't block
            this.scheduleLoad(node, levels[i], i - startIndex);
        }
    }
}
```

### 5. Color Correction Integration

```javascript
class TextureEntry {
    constructor(node, lod) {
        this.node = node;
        this.lod = lod;
        this.baseTexture = null;
        this.correctedTexture = null;
        this.corrections = null;
    }
    
    getTexture(corrections) {
        // If no corrections needed, return base
        if (!corrections || this.isNeutral(corrections)) {
            return this.baseTexture;
        }
        
        // If corrections match cached, return cached
        if (this.correctedTexture && this.correctionsMatch(corrections)) {
            return this.correctedTexture;
        }
        
        // Generate new corrected texture
        this.correctedTexture = this.applyCorrections(this.baseTexture, corrections);
        this.corrections = corrections;
        return this.correctedTexture;
    }
}
```

## Implementation Strategy

### Phase 1: Core Architecture (Week 1)
1. Create unified TextureManager
2. Implement priority queue
3. Set up viewport-aware scoring

### Phase 2: Progressive Loading (Week 2)
1. Implement progressive texture loading
2. Add decode worker pool
3. Handle color correction integration

### Phase 3: Performance Optimization (Week 3)
1. Tune priority weights
2. Optimize memory thresholds
3. Add predictive pre-loading

## Expected Improvements

### Performance
- **Initial load**: 5-10x faster (parallel decoding, smarter priorities)
- **Zoom performance**: No resolution drops (predictive loading)
- **Memory usage**: 30-50% more efficient (smarter eviction)
- **Frame rate**: Consistent 60fps (off-thread decoding)

### User Experience
- Images stay sharp during zoom
- No visible loading delays
- Smooth scrolling even with 1000s of images
- Color corrections apply instantly

## Key Differences from Current System

| Current System | New System |
|---------------|------------|
| Multiple caches | Single unified cache |
| Complex priority logic | Simple viewport-based scoring |
| Synchronous decoding | Worker-based async decoding |
| Reactive loading | Predictive pre-loading |
| Fixed LOD levels | Progressive streaming |
| Separate color correction | Integrated correction cache |

## Migration Path

1. **Phase 1**: Build new system alongside old one
2. **Phase 2**: A/B test with feature flag
3. **Phase 3**: Gradual rollout with fallback
4. **Phase 4**: Remove old system

## Success Metrics

- Zero resolution drops during zoom
- < 100ms to first paint on page load
- < 50ms to sharp image when zooming
- Consistent 60fps during all operations
- Memory usage stays under 1.5GB limit