# ImageCanvas Image Upload System

## Overview

The ImageCanvas image upload system uses HTTP-based uploads to handle large files efficiently, preventing WebSocket timeouts and providing robust progress tracking. It features hash-based deduplication, server-side thumbnail generation, and unified progress notifications.

## Architecture

### Core Components

#### Client-Side

**ImageUploadManager** (`/js/core/ImageUploadManager.js`)
- Manages the upload queue and concurrency
- Handles retry logic for failed uploads
- Coordinates with progress tracking
- Integrates with notification system

**ImageUploadCoordinator** (`/js/core/ImageUploadCoordinator.js`)
- Orchestrates upload → node creation flow
- Manages temporary placeholder nodes
- Handles upload completion callbacks
- Ensures proper state synchronization

**ImageProcessingProgressManager** (`/js/core/ImageProcessingProgressManager.js`)
- Tracks progress across multiple operations
- Provides unified progress notifications
- Manages batch progress calculation
- Integrates with UI notifications

#### Server-Side

**Upload Handler** (`/server/index.js`)
- Processes multipart file uploads
- Implements hash-based deduplication
- Generates multiple thumbnail sizes
- Returns upload metadata

**Thumbnail Generator**
- Creates 6 sizes: 64px, 128px, 256px, 512px, 1024px, 2048px
- Uses WebP format for efficiency
- Implements progressive generation
- Caches generated thumbnails

## Upload Flow

### 1. File Selection
```javascript
// User drops files or selects via dialog
handleFileDrop(files) {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    uploadImages(imageFiles);
}
```

### 2. Hash Calculation
```javascript
// Calculate SHA-256 hash for deduplication
const hash = await ImageUploadManager.calculateHash(file);
```

### 3. HTTP Upload
```javascript
// Upload via HTTP with progress tracking
const result = await ImageUploadManager.uploadImage(file, {
    onProgress: (progress) => {
        progressManager.updateProgress('upload', file.name, progress);
    }
});
```

### 4. Server Processing
```
POST /api/upload
→ Check hash for existing file
→ Save file if new
→ Generate thumbnails
→ Return metadata
```

### 5. Node Creation
```javascript
// Create node with server URL reference
const node = await createImageNode({
    serverUrl: result.url,
    filename: result.filename,
    hash: result.hash
});
```

## Key Features

### Hash-Based Deduplication

- **Client-side hashing**: SHA-256 hash calculated before upload
- **Server verification**: Server checks if file already exists
- **Instant response**: Duplicate files return immediately
- **Storage efficiency**: Same image used by multiple nodes

### Progressive Thumbnail Loading

```javascript
// Thumbnail sizes loaded based on zoom level
const sizes = [64, 128, 256, 512, 1024, 2048];

// Client selects optimal size
const optimalSize = getOptimalLOD(screenWidth, screenHeight);
const thumbnail = thumbnailCache.getBestThumbnail(hash, optimalSize);
```

### Batch Upload Support

```javascript
// Upload multiple files with concurrency control
const BATCH_SIZE = 5;

for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(file => uploadImage(file)));
}
```

### Unified Progress Tracking

```javascript
// Single progress notification for multiple uploads
progressManager.beginBatch('upload_images', files.length);

files.forEach(file => {
    uploadImage(file, {
        onProgress: (p) => progressManager.updateItem(file.name, p)
    });
});

progressManager.endBatch();
```

## API Reference

### HTTP Endpoints

#### POST /api/upload

Upload an image file.

**Request:**
```
Content-Type: multipart/form-data

file: [binary data]
hash: [optional SHA-256 hash]
```

**Response:**
```json
{
    "success": true,
    "url": "/uploads/1234567890-abc123.jpg",
    "hash": "sha256:abcdef...",
    "filename": "image.jpg",
    "size": 2048576,
    "thumbnails": {
        "64": "/thumbnails/64/1234567890-abc123.webp",
        "128": "/thumbnails/128/1234567890-abc123.webp",
        // ... other sizes
    }
}
```

### Client API

```javascript
// Upload single image
const result = await window.imageUploadManager.uploadImage(file, {
    onProgress: (progress) => console.log(`${progress}% complete`)
});

// Upload multiple images
const results = await window.imageUploadManager.uploadImages(files, {
    onBatchProgress: (completed, total) => {
        console.log(`${completed}/${total} files uploaded`);
    }
});

// Check if image exists (by hash)
const exists = await window.imageUploadManager.checkExists(hash);
```

## Progress Notifications

### Visual Design

```
┌─────────────────────────────────────┐
│ Uploading 5 images...               │
│ ████████████░░░░░░░░░  60%         │
│                                     │
│ ✓ image1.jpg                        │
│ ✓ image2.jpg                        │
│ ↻ image3.jpg (45%)                  │
│ ○ image4.jpg                        │
│ ○ image5.jpg                        │
└─────────────────────────────────────┘
```

### Progress Calculation

```javascript
// Weighted progress for multi-stage operations
const stages = {
    upload: 0.6,      // 60% weight
    thumbnail: 0.3,   // 30% weight
    finalize: 0.1     // 10% weight
};

const totalProgress = 
    (uploadProgress * stages.upload) +
    (thumbnailProgress * stages.thumbnail) +
    (finalizeProgress * stages.finalize);
```

## Configuration

### Client Configuration

```javascript
// config.js
const CONFIG = {
    UPLOAD: {
        MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
        ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        BATCH_SIZE: 5,
        RETRY_ATTEMPTS: 3,
        TIMEOUT: 30000 // 30 seconds
    }
};
```

### Server Configuration

```javascript
// server/config.js
const UPLOAD_CONFIG = {
    MAX_SIZE: 50 * 1024 * 1024,
    UPLOAD_DIR: './uploads',
    THUMBNAIL_DIR: './thumbnails',
    THUMBNAIL_SIZES: [64, 128, 256, 512, 1024, 2048],
    THUMBNAIL_FORMAT: 'webp',
    THUMBNAIL_QUALITY: 85
};
```

## Error Handling

### Upload Failures

```javascript
try {
    const result = await uploadImage(file);
} catch (error) {
    if (error.code === 'FILE_TOO_LARGE') {
        showNotification('File exceeds 50MB limit');
    } else if (error.code === 'NETWORK_ERROR') {
        // Retry with exponential backoff
        await retryWithBackoff(() => uploadImage(file));
    }
}
```

### Thumbnail Generation Failures

- Server falls back to original image
- Client shows degraded quality warning
- Background retry for thumbnail generation

## Performance Optimizations

### 1. Chunked Uploads

For very large files (>10MB), uploads are chunked:

```javascript
// Client chunks large files
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const chunks = splitFileIntoChunks(file, CHUNK_SIZE);

for (const chunk of chunks) {
    await uploadChunk(chunk);
}
```

### 2. Connection Pooling

- Reuse HTTP connections
- Limit concurrent uploads
- Queue management for large batches

### 3. Cache Headers

```javascript
// Server sets appropriate cache headers
res.set({
    'Cache-Control': 'public, max-age=31536000',
    'ETag': hash,
    'Last-Modified': uploadDate
});
```

## Security Considerations

### File Validation

- **Type checking**: Verify MIME types
- **Size limits**: Enforce maximum file size
- **Content scanning**: Check file headers
- **Filename sanitization**: Remove path traversal attempts

### Access Control

- **CORS configuration**: Restrict origins
- **Rate limiting**: Prevent abuse
- **Authentication**: Future implementation
- **Virus scanning**: Optional integration

## Troubleshooting

### Common Issues

1. **"File too large" error**
   - Check MAX_FILE_SIZE configuration
   - Verify server upload limits
   - Consider chunked upload

2. **"Network timeout" during upload**
   - Increase timeout settings
   - Check network conditions
   - Enable retry logic

3. **Thumbnails not loading**
   - Verify thumbnail generation
   - Check file permissions
   - Review server logs

4. **Duplicate detection not working**
   - Ensure hash calculation matches
   - Check server-side hash validation
   - Verify file storage

## Best Practices

1. **Always calculate hash client-side** to enable deduplication
2. **Use progress callbacks** for user feedback
3. **Implement retry logic** for network failures
4. **Batch uploads** when handling multiple files
5. **Monitor upload metrics** for performance tuning