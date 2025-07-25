# Master Plan: Fix Image Loading After Browser Refresh

## Overview

Both solution documents correctly identify the same root cause: when `resolveImageSource()` receives a relative URL as the `src` parameter, it returns it without converting to an absolute URL. However, `IMAGE_LOADING_FIX_SOLUTION.md` identifies an additional potential issue with CORS configuration on the server.

## Root Causes

### 1. Primary Issue: URL Resolution (Both docs agree)
- `StateSyncManager.createNodeFromData()` passes `serverUrl` (e.g., "/uploads/1234.png") to `setImage()`
- `resolveImageSource()` returns this relative URL as-is because of the early return: `if (src) return src;`
- Browser tries to load from wrong origin, causing failure

### 2. Potential CORS Issue (Only in SOLUTION doc)
- Server has duplicate handlers for `/uploads` route
- Static middleware might serve files without CORS headers
- This could cause issues since `image-node.js` sets `crossOrigin = 'anonymous'`

## Recommended Solution

### Phase 1: Fix URL Resolution (Required)

Implement the more specific check from `IMAGE_LOADING_FIX_SOLUTION.md`:

```javascript
async resolveImageSource(src) {
    // 1. If we have a direct source, check if it needs conversion
    if (src) {
        // Convert relative server URLs to absolute
        // More specific check for known upload paths
        if (src.startsWith('/uploads/') || src.startsWith('/thumbnails/')) {
            const absoluteUrl = CONFIG.SERVER.API_BASE + src;
            console.log(`🔗 Converting relative URL: ${src} → ${absoluteUrl}`);
            return absoluteUrl;
        }
        // Return data URLs and absolute URLs as-is
        return src;
    }
    
    // 2. Try to get from image cache using hash
    if (this.properties.hash && window.imageCache) {
        const cached = window.imageCache.get(this.properties.hash);
        if (cached) {
            console.log(`✅ Resolved image from cache: ${this.properties.hash.substring(0, 8)}...`);
            return cached;
        }
    }
    
    // 3. Try server URL
    if (this.properties.serverUrl) {
        // Convert relative URL to absolute if needed
        const url = this.properties.serverUrl.startsWith('http') 
            ? this.properties.serverUrl 
            : CONFIG.SERVER.API_BASE + this.properties.serverUrl;
        console.log(`🌐 Using server URL: ${url}`);
        return url;
    }
    
    // ... rest of the method remains the same
}
```

**Why this approach is better:**
- More specific path checking (`/uploads/`, `/thumbnails/`) instead of generic "not http and not data:"
- Prevents accidentally converting other types of relative URLs
- Clear logging for debugging

### Phase 2: Verify CORS Configuration (If Phase 1 doesn't fully resolve)

Check if CORS is properly configured by testing in browser console:
```javascript
fetch('http://localhost:3000/uploads/test-image.png', { mode: 'cors' })
```

If CORS errors occur, implement the server fix:

```javascript
// server/index.js - around line 91
// Add CORS headers to static file serving
this.app.use('/uploads', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static(path.join(__dirname, 'uploads')));

// Remove duplicate route handler around line 254
```

### Phase 3: Enhanced Error Handling (Optional but recommended)

Add better error logging to help debug future issues:

```javascript
loadImageAsyncOptimized(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            if (img.decode) {
                img.decode()
                    .then(() => resolve(img))
                    .catch(() => resolve(img));
            } else {
                resolve(img);
            }
        };
        
        img.onerror = (error) => {
            console.error(`❌ Failed to load image from: ${src}`, {
                error,
                node: this.id,
                hash: this.properties.hash?.substring(0, 8),
                crossOrigin: img.crossOrigin
            });
            reject(error);
        };
        
        img.crossOrigin = 'anonymous';
        img.loading = 'eager';
        img.src = src;
    });
}
```

## Implementation Steps

1. **Start with Phase 1** - This is the confirmed issue and will likely solve the problem
2. **Test thoroughly** - Create image, refresh browser, verify it loads
3. **If issues persist**, check browser console for CORS errors and implement Phase 2
4. **Add Phase 3** for better debugging capabilities

## Testing Protocol

1. Clear browser cache and cookies
2. Create a new image node (drag & drop or paste)
3. Wait for upload completion (check Network tab)
4. Verify `serverUrl` is set in node properties
5. Refresh browser (Cmd+R)
6. Verify image loads successfully
7. Check console for any errors or warnings
8. Test with multiple images and different file types

## Success Criteria

- Images load successfully after browser refresh
- No "Error" state for nodes with valid serverUrls  
- Console shows: "🔗 Converting relative URL: /uploads/1234.png → http://localhost:3000/uploads/1234.png"
- No CORS errors in browser console
- All image operations (resize, move, etc.) work after refresh

## File Locations

- **Client fix**: `/js/nodes/image-node.js` - `resolveImageSource()` method (line ~139)
- **Server fix** (if needed): `/server/index.js` - static middleware setup (line ~91)