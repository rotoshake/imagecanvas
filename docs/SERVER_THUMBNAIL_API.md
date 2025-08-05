# Server Thumbnail API

## Overview

The server provides a smart thumbnail API that generates and serves optimized image thumbnails at various resolutions. This enables efficient lazy loading and reduces client-side memory usage.

## Endpoints

### Get Thumbnail
```
GET /api/thumbnails/:hash/:size
```

**Parameters:**
- `hash` - The SHA-256 hash of the original image
- `size` - Requested thumbnail size (64, 256, or 512)

**Response:**
- Returns the thumbnail image (WebP format)
- Status 404 if thumbnail not found
- Status 400 if invalid size requested

**Example:**
```
GET /api/thumbnails/abc123def456/256
```

### Generate Thumbnails
```
POST /api/thumbnails/generate
```

**Body:**
```json
{
  "hash": "abc123def456",
  "sizes": [64, 256, 512]
}
```

**Response:**
```json
{
  "success": true,
  "generated": [64, 256, 512],
  "urls": {
    "64": "/api/thumbnails/abc123def456/64",
    "256": "/api/thumbnails/abc123def456/256",
    "512": "/api/thumbnails/abc123def456/512"
  }
}
```

## Implementation Notes

### Server-Side Requirements

1. **Thumbnail Generation**
   - Generate thumbnails during image upload
   - Use high-quality resampling (Lanczos or similar)
   - Save as WebP for smaller file sizes
   - Maintain aspect ratio with smart cropping

2. **Storage Structure**
   ```
   uploads/
   ├── thumbnails/
   │   ├── {hash}/
   │   │   ├── 64.webp
   │   │   ├── 256.webp
   │   │   └── 512.webp
   │   └── ...
   └── originals/
       └── {hash}.{ext}
   ```

3. **Caching Headers**
   ```
   Cache-Control: public, max-age=31536000, immutable
   ETag: "{hash}-{size}"
   ```

4. **Performance Optimizations**
   - Generate thumbnails asynchronously after upload
   - Use a job queue for thumbnail generation
   - Cache thumbnails on CDN if available
   - Support conditional requests (If-None-Match)

### Client-Side Integration

The `ResolutionManager` automatically requests thumbnails based on:
- Current viewport scale
- Node size on screen
- Available memory
- Network conditions

**Usage Example:**
```javascript
// ResolutionManager handles this automatically
const thumbnailUrl = `/api/thumbnails/${hash}/256`;

// Direct usage (not recommended)
const img = new Image();
img.src = thumbnailUrl;
```

## Migration Path

1. **Phase 1 - Basic Support**
   - Add thumbnail generation to upload endpoint
   - Serve thumbnails from simple file storage

2. **Phase 2 - Optimization**
   - Implement background job queue
   - Add CDN support
   - Optimize format (WebP, AVIF)

3. **Phase 3 - Advanced Features**
   - Smart cropping for better thumbnails
   - Progressive loading (blur-up effect)
   - Adaptive quality based on client capabilities

## Benefits

1. **Performance**
   - 90% reduction in initial load size
   - Faster time to first paint
   - Smoother scrolling and zooming

2. **Scalability**
   - Handle thousands of images
   - Reduced client memory usage
   - Better mobile device support

3. **User Experience**
   - Instant preview while loading
   - No blank placeholders
   - Seamless quality transitions