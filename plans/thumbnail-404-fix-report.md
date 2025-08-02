# Thumbnail 404 Error Fix Report

## Issue Summary

The ImageCanvas application was experiencing 404 errors when trying to load thumbnails. The client was requesting thumbnails using original filenames (e.g., `IMG_7256.webp`) instead of server-generated filenames (e.g., `1754070377244-1fyn9s.webp`).

**Error Pattern in Logs:**
```
GET /thumbnails/512/IMG_9462.webp 404 (Not Found)
Error: ENOENT: no such file or directory, stat '/server/thumbnails/512/IMG_9462.webp'
```

**Correct Pattern Should Be:**
```
GET /thumbnails/512/1754070377244-1fyn9s.webp 200 (OK)
```

## Root Cause Analysis

1. **Server Response Structure**: The server correctly returns both filenames in upload responses:
   - `filename`: Original filename (e.g., "IMG_7256.jpeg")  
   - `serverFilename`: Server-generated filename (e.g., "1754070377244-1fyn9s.jpeg")

2. **Client Bug**: Multiple client-side files were incorrectly using `uploadResult.filename` (original) instead of `uploadResult.serverFilename` (server-generated) when setting the `serverFilename` property on image nodes.

3. **Thumbnail URL Construction**: The thumbnail cache system relies on the `serverFilename` property to construct correct thumbnail URLs, so incorrect values caused 404 errors.

## Files Fixed

### 1. `/js/core/ImageUploadCoordinator.js`
**Changes Made:**
- Line 195: `uploadResult.filename` → `uploadResult.serverFilename`
- Line 213: `uploadResult.filename` → `uploadResult.serverFilename` 
- Line 227: `uploadResult.filename` → `uploadResult.serverFilename`
- Line 246: `uploadResult.filename` → `uploadResult.serverFilename`
- Line 270: `uploadResult.filename` → `uploadResult.serverFilename`

### 2. `/js/commands/NodeCommands.js`
**Changes Made:**
- Line 407: `uploadResult.filename` → `uploadResult.serverFilename`
- Line 478: `uploadResult.filename` → `uploadResult.serverFilename`

### 3. `/js/dragdrop.js`
**Changes Made:**
- Line 1056: `uploadResult.filename` → `uploadResult.serverFilename`

### 4. `/js/utils/cache.js` - Enhanced Logic
**Improvements Made:**
- Added validation to ensure serverFilename looks like a server-generated filename (pattern: `^\d{13}-[a-z0-9]+\.\w+$`)
- Enhanced serverFilename extraction to prioritize serverUrl parsing over serverFilename property
- Added warning logging when encountering serverFilename that looks like original filename
- Added validation in `loadServerThumbnails()` method to reject invalid serverFilenames

**New Logic:**
```javascript
// Priority 1: Extract from serverUrl (most reliable)
if (imageNode.properties?.serverUrl) {
    const urlParts = imageNode.properties.serverUrl.split('/');
    const filenameFromUrl = urlParts[urlParts.length - 1];
    // Only use if it looks like server-generated filename
    if (filenameFromUrl && filenameFromUrl.match(/^\d{13}-[a-z0-9]+\./i)) {
        serverFilename = filenameFromUrl;
    }
}
// Priority 2: Check serverFilename property (with validation)
if (!serverFilename && imageNode.properties?.serverFilename) {
    if (imageNode.properties.serverFilename.match(/^\d{13}-[a-z0-9]+\./i)) {
        serverFilename = imageNode.properties.serverFilename;
    } else {
        console.warn(`Ignoring serverFilename that looks like original filename`);
    }
}
```

## Debug Utility Added

Created `/scratch/debug_thumbnail_404.js` - A browser console utility to identify thumbnail-related issues:
- Analyzes all image nodes for potential problems
- Validates serverFilename patterns
- Checks for serverUrl/serverFilename mismatches
- Reports thumbnail cache statistics

**Usage:**
```javascript
// Run in browser console
debugThumbnail404Issues();
```

## Impact and Benefits

1. **404 Errors Eliminated**: Thumbnail requests now use correct server-generated filenames
2. **Improved Performance**: Reduces failed network requests and improves thumbnail loading speed
3. **Better Error Handling**: Added validation prevents similar issues in the future
4. **Debugging Support**: Debug utility helps identify and resolve thumbnail-related issues

## Testing Recommendations

1. **New Uploads**: Upload new images and verify thumbnails load correctly
2. **Existing Nodes**: Test existing image nodes to ensure they work with enhanced logic
3. **Mixed Scenarios**: Test canvases with both old and new image nodes
4. **Error Scenarios**: Test with intentionally corrupted serverFilename values

## Prevention Measures

1. **Validation**: Added pattern matching to reject invalid serverFilenames
2. **Logging**: Enhanced logging to warn about potential issues
3. **Fallback Logic**: Improved serverFilename extraction with multiple sources
4. **Debug Tools**: Created utility to identify and troubleshoot issues

## Server-Side Files (Unchanged)

The server-side code was already correct:
- Upload endpoint returns proper `serverFilename` values
- Thumbnail generation uses correct server filenames
- Thumbnail serving endpoint works correctly

The issue was purely client-side filename handling.

---

## Summary

This fix addresses the thumbnail 404 errors by ensuring the client consistently uses server-generated filenames for thumbnail requests instead of original filenames. The enhanced validation and error handling should prevent similar issues in the future.