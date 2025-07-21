# ShowStatus Method Fix

## Issue
The CanvasNavigator was trying to call `this.networkLayer.showStatus()` which doesn't exist in the NetworkLayer class, causing a TypeError when loading canvases.

## Root Cause
The code was attempting to show status messages through the NetworkLayer, but this functionality is actually provided by the app's `showNotification` method.

## Solution
Replaced all calls to `networkLayer.showStatus()` and `collaborativeManager.showStatus()` with calls to `app.showNotification()`.

### Changes Made

1. **js/ui/canvas-navigator.js**
   - Replaced 5 instances of `this.networkLayer.showStatus()` with `this.app.showNotification()`
   - Updated to use the proper notification format with type and message properties

2. **js/canvas.js**
   - Replaced `this.collaborativeManager.showStatus()` with `this.showNotification()`

### Example Change
```javascript
// Before:
if (this.networkLayer) {
    this.networkLayer.showStatus('Canvas loaded', 'success');
}

// After:
if (this.app.showNotification) {
    this.app.showNotification({
        type: 'success',
        message: 'Canvas loaded'
    });
}
```

## Benefits
- Fixes TypeError when loading canvases
- Uses the correct notification system
- Maintains consistent status messaging across the application
- Properly checks for method existence before calling