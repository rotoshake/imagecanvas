# ImageCanvas Performance Optimization Guide

## Performance Goals

- **60 FPS** canvas rendering
- **< 100ms** operation latency
- **10+ concurrent users** without degradation
- **1000+ objects** on canvas
- **< 3s** initial load time

## Client-Side Optimizations

### 1. Rendering Performance

#### Canvas Optimization
```javascript
// Use layered rendering for static content
class LayeredCanvas {
  constructor() {
    this.staticLayer = document.createElement('canvas');
    this.dynamicLayer = document.createElement('canvas');
    this.uiLayer = document.createElement('canvas');
  }

  render() {
    // Only redraw changed layers
    if (this.staticDirty) {
      this.renderStaticLayer();
    }
    if (this.dynamicDirty) {
      this.renderDynamicLayer();
    }
    // UI layer always redraws (handles, selection)
    this.renderUILayer();
  }
}
```

#### Viewport Culling
```javascript
// Only render visible nodes
function renderVisibleNodes(ctx, nodes, viewport) {
  const visibleBounds = viewport.getVisibleBounds();
  
  nodes.forEach(node => {
    if (node.intersects(visibleBounds)) {
      node.render(ctx, viewport);
    }
  });
}
```

#### Image Caching
```javascript
// Cache rendered images at different scales
class ImageCache {
  constructor(maxSize = 50 * 1024 * 1024) { // 50MB
    this.cache = new Map();
    this.size = 0;
    this.maxSize = maxSize;
  }

  get(url, width, height) {
    const key = `${url}_${width}x${height}`;
    const entry = this.cache.get(key);
    
    if (entry) {
      // Move to end (LRU)
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.canvas;
    }
    
    return null;
  }

  set(url, width, height, canvas) {
    const key = `${url}_${width}x${height}`;
    const size = width * height * 4; // Approximate size
    
    // Evict if necessary
    while (this.size + size > this.maxSize && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      const entry = this.cache.get(firstKey);
      this.size -= entry.size;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, { canvas, size });
    this.size += size;
  }
}
```

### 2. Operation Batching

#### Batch Multiple Operations
```javascript
class OperationBatcher {
  constructor(flushDelay = 100) {
    this.operations = [];
    this.flushDelay = flushDelay;
    this.timer = null;
  }

  add(operation) {
    this.operations.push(operation);
    
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    this.timer = setTimeout(() => this.flush(), this.flushDelay);
  }

  flush() {
    if (this.operations.length === 0) return;
    
    // Combine operations
    const batch = {
      type: 'batch',
      operations: this.operations,
      timestamp: Date.now()
    };
    
    // Send as single message
    networkLayer.emit('operation', batch);
    
    this.operations = [];
    this.timer = null;
  }
}
```

### 3. Memory Management

#### Object Pooling
```javascript
// Reuse objects to reduce garbage collection
class ObjectPool {
  constructor(factory, reset, maxSize = 100) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    this.maxSize = maxSize;
  }

  acquire() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    return this.factory();
  }

  release(obj) {
    if (this.pool.length < this.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    }
  }
}

// Usage for temporary points
const pointPool = new ObjectPool(
  () => ({ x: 0, y: 0 }),
  (p) => { p.x = 0; p.y = 0; },
  1000
);
```

#### Weak References
```javascript
// Use weak references for caches
class WeakCache {
  constructor() {
    this.cache = new WeakMap();
  }

  get(node) {
    return this.cache.get(node);
  }

  set(node, data) {
    this.cache.set(node, data);
  }
}
```

### 4. Event Handling

#### Throttle Mouse Events
```javascript
// Limit frequency of expensive operations
function throttle(fn, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

// Throttle cursor updates
canvas.addEventListener('mousemove', throttle((e) => {
  handleMouseMove(e);
}, 16)); // ~60fps
```

#### Debounce Text Input
```javascript
// Delay text sync until typing stops
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Debounce text updates
textInput.addEventListener('input', debounce((e) => {
  syncTextContent(e.target.value);
}, 300));
```

## Server-Side Optimizations

### 1. Database Performance

#### Connection Pooling
```javascript
// Reuse database connections
const Database = require('better-sqlite3');

class DatabasePool {
  constructor(filename, poolSize = 5) {
    this.connections = [];
    this.available = [];
    
    for (let i = 0; i < poolSize; i++) {
      const db = new Database(filename);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      this.connections.push(db);
      this.available.push(db);
    }
  }

  acquire() {
    if (this.available.length === 0) {
      throw new Error('No database connections available');
    }
    return this.available.pop();
  }

  release(db) {
    this.available.push(db);
  }
}
```

#### Prepared Statements
```javascript
// Cache prepared statements
class QueryCache {
  constructor(db) {
    this.db = db;
    this.statements = new Map();
  }

  prepare(sql) {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.db.prepare(sql));
    }
    return this.statements.get(sql);
  }

  run(sql, params) {
    return this.prepare(sql).run(params);
  }

  get(sql, params) {
    return this.prepare(sql).get(params);
  }
}
```

### 2. WebSocket Optimization

#### Message Compression
```javascript
// Enable per-message compression
io.use((socket, next) => {
  socket.compress(true);
  next();
});

// Compress large messages
function emitCompressed(socket, event, data) {
  const json = JSON.stringify(data);
  if (json.length > 1024) { // 1KB threshold
    socket.compress(true).emit(event, data);
  } else {
    socket.compress(false).emit(event, data);
  }
}
```

#### Room-based Broadcasting
```javascript
// Only send to relevant clients
class CanvasRooms {
  joinCanvas(socket, canvasId) {
    // Leave other canvas rooms
    Object.keys(socket.rooms).forEach(room => {
      if (room.startsWith('canvas:') && room !== socket.id) {
        socket.leave(room);
      }
    });
    
    // Join new canvas room
    socket.join(`canvas:${canvasId}`);
  }

  broadcast(canvasId, event, data, excludeSocket) {
    const room = `canvas:${canvasId}`;
    if (excludeSocket) {
      excludeSocket.to(room).emit(event, data);
    } else {
      io.to(room).emit(event, data);
    }
  }
}
```

### 3. Caching Strategy

#### Redis Integration
```javascript
// Cache frequently accessed data
const redis = require('redis');
const client = redis.createClient();

class StateCache {
  async get(canvasId) {
    const cached = await client.get(`canvas:${canvasId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  }

  async set(canvasId, state, ttl = 3600) {
    await client.setex(
      `canvas:${canvasId}`,
      ttl,
      JSON.stringify(state)
    );
  }

  async invalidate(canvasId) {
    await client.del(`canvas:${canvasId}`);
  }
}
```

#### CDN for Static Assets
```javascript
// Serve static files through CDN
app.use('/uploads', (req, res, next) => {
  // Set cache headers
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
  next();
}, express.static('uploads'));

// Generate CDN URLs
function getCDNUrl(path) {
  if (process.env.CDN_URL) {
    return `${process.env.CDN_URL}${path}`;
  }
  return path;
}
```

## Network Optimization

### 1. Reduce Payload Size

#### Efficient Serialization
```javascript
// Minimize data sent over network
class EfficientSerializer {
  static serializeNode(node) {
    // Use short property names
    return {
      i: node.id,
      t: node.type,
      x: Math.round(node.x),
      y: Math.round(node.y),
      w: Math.round(node.width),
      h: Math.round(node.height),
      r: Math.round(node.rotation * 100) / 100,
      d: node.data
    };
  }

  static deserializeNode(data) {
    return {
      id: data.i,
      type: data.t,
      x: data.x,
      y: data.y,
      width: data.w,
      height: data.h,
      rotation: data.r,
      data: data.d
    };
  }
}
```

#### Delta Updates
```javascript
// Send only changes, not full state
class DeltaSync {
  constructor() {
    this.lastState = new Map();
  }

  computeDelta(nodeId, newState) {
    const oldState = this.lastState.get(nodeId) || {};
    const delta = {};
    
    for (const key in newState) {
      if (newState[key] !== oldState[key]) {
        delta[key] = newState[key];
      }
    }
    
    this.lastState.set(nodeId, { ...newState });
    return delta;
  }
}
```

### 2. Progressive Loading

#### Lazy Load Images
```javascript
// Load images on demand
class LazyImageLoader {
  constructor() {
    this.loading = new Set();
    this.loaded = new Map();
  }

  async load(url, priority = 'low') {
    if (this.loaded.has(url)) {
      return this.loaded.get(url);
    }

    if (this.loading.has(url)) {
      // Wait for existing load
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.loaded.has(url)) {
            clearInterval(check);
            resolve(this.loaded.get(url));
          }
        }, 50);
      });
    }

    this.loading.add(url);

    const img = new Image();
    if (priority === 'high') {
      img.loading = 'eager';
    } else {
      img.loading = 'lazy';
    }

    return new Promise((resolve, reject) => {
      img.onload = () => {
        this.loaded.set(url, img);
        this.loading.delete(url);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }
}
```

## Monitoring and Profiling

### Performance Metrics
```javascript
// Track key metrics
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      fps: [],
      renderTime: [],
      operationLatency: [],
      memoryUsage: []
    };
  }

  measureFPS() {
    let lastTime = performance.now();
    let frames = 0;

    const measure = () => {
      frames++;
      const currentTime = performance.now();
      
      if (currentTime >= lastTime + 1000) {
        const fps = Math.round((frames * 1000) / (currentTime - lastTime));
        this.metrics.fps.push(fps);
        frames = 0;
        lastTime = currentTime;
      }
      
      requestAnimationFrame(measure);
    };
    
    measure();
  }

  measureRenderTime(fn) {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;
    this.metrics.renderTime.push(duration);
  }

  getAverageMetrics() {
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    return {
      avgFPS: avg(this.metrics.fps),
      avgRenderTime: avg(this.metrics.renderTime),
      avgLatency: avg(this.metrics.operationLatency)
    };
  }
}
```

### Chrome DevTools Integration
```javascript
// Add performance marks
performance.mark('render-start');
canvas.render();
performance.mark('render-end');
performance.measure('render', 'render-start', 'render-end');

// Log slow operations
const slowOps = performance.getEntriesByType('measure')
  .filter(entry => entry.duration > 16); // Slower than 60fps
console.warn('Slow operations:', slowOps);
```

## Best Practices

### 1. Avoid Memory Leaks
- Remove event listeners when components are destroyed
- Clear timers and intervals
- Dispose of WebGL contexts properly
- Use WeakMap for object associations

### 2. Optimize Asset Loading
- Use WebP for thumbnails (30-50% smaller)
- Implement progressive image loading
- Preload critical assets
- Use HTTP/2 for parallel loading

### 3. Reduce Reflows/Repaints
- Batch DOM updates
- Use CSS transforms instead of position
- Avoid reading layout properties in loops
- Use `will-change` CSS property sparingly

### 4. Profile Regularly
- Use Chrome Performance tab
- Monitor memory usage
- Track network waterfall
- Set performance budgets