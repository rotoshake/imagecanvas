# Navigation State Persistence

## Overview

The Navigation State Persistence system automatically saves and restores the viewport position (pan and zoom) for each canvas. This ensures users return to their exact working position when reopening a project, improving workflow continuity in the collaborative canvas environment.

## Architecture

### Components

**NavigationStateManager** (`/js/core/NavigationStateManager.js`)
- Manages save/restore of viewport state
- Debounces rapid navigation changes
- Integrates with project system
- Handles cross-tab synchronization

**Server Storage**
- Navigation state stored in `canvas_states` table
- Per-project, per-user state (future: user-specific views)
- Includes scale, offset, and timestamp

## How It Works

### State Structure

```javascript
{
    scale: 1.5,           // Zoom level (1.0 = 100%)
    offset: [200, -150],  // Pan offset [x, y]
    timestamp: 1234567890 // Last update time
}
```

### Save Flow

1. **User navigates** (pan/zoom)
2. **Canvas triggers event** with new viewport state
3. **Manager debounces** (500ms) to avoid excessive saves
4. **State sent to server** via HTTP PATCH
5. **Server updates** database record

### Restore Flow

1. **Project loads** from server
2. **Canvas data includes** navigation state
3. **Manager applies** saved viewport
4. **Canvas renders** at saved position

## Implementation

### Client-Side Integration

```javascript
// Initialize with canvas
const navManager = new NavigationStateManager(canvas, projectId);

// Automatic save on navigation
canvas.on('viewportChanged', (state) => {
    navManager.saveState(state);
});

// Manual save
navManager.saveState({
    scale: canvas.scale,
    offset: [canvas.offset[0], canvas.offset[1]]
});

// Restore on load
const savedState = await navManager.loadState();
if (savedState) {
    canvas.setScale(savedState.scale);
    canvas.setOffset(savedState.offset);
}
```

### Server Endpoints

#### GET /projects/:id/canvas

Returns canvas data with navigation state:

```json
{
    "canvas_data": {
        "nodes": [...],
        "navigation_state": {
            "scale": 1.5,
            "offset": [200, -150],
            "timestamp": 1234567890
        }
    }
}
```

#### PATCH /projects/:id/canvas

Updates only navigation state:

```json
{
    "navigation_state": {
        "scale": 2.0,
        "offset": [100, -50],
        "timestamp": 1234567890
    }
}
```

## Features

### Debounced Saving

Prevents excessive server requests during continuous navigation:

```javascript
class NavigationStateManager {
    constructor(canvas, projectId, debounceDelay = 500) {
        this.saveState = this.debounce(
            this._saveState.bind(this), 
            debounceDelay
        );
    }
}
```

### Cross-Tab Behavior

- Each tab maintains independent viewport
- Navigation state is per-session, not synchronized
- Future: User preference for sync behavior

### Fallback Handling

```javascript
// Default state if none saved
const DEFAULT_STATE = {
    scale: 1.0,
    offset: [0, 0]
};

// Apply with fallback
const state = savedState || DEFAULT_STATE;
canvas.setScale(state.scale);
canvas.setOffset(state.offset);
```

## Configuration

### Client Configuration

```javascript
const NAV_CONFIG = {
    DEBOUNCE_DELAY: 500,        // ms to wait before saving
    MIN_SCALE: 0.1,             // Minimum zoom (10%)
    MAX_SCALE: 10,              // Maximum zoom (1000%)
    SAVE_ENABLED: true,         // Toggle persistence
    RESTORE_ON_LOAD: true       // Auto-restore on project open
};
```

### Server Configuration

```javascript
const SERVER_CONFIG = {
    NAV_STATE_EXPIRY: null,     // No expiry (permanent)
    MAX_STATES_PER_PROJECT: 1,  // One state per project
    COMPRESS_STATE: false       // State is small, no compression
};
```

## User Experience

### Visual Feedback

```javascript
// Show brief indicator when restoring
if (restoredState) {
    window.unifiedNotifications.show({
        type: 'info',
        message: 'Restored to previous view',
        duration: 2000,
        subtle: true
    });
}
```

### Reset Options

```javascript
// Reset to default view
function resetView() {
    canvas.setScale(1.0);
    canvas.centerContent();
    navManager.saveState({
        scale: 1.0,
        offset: [0, 0]
    });
}
```

## Database Schema

```sql
-- Part of canvas_states table
CREATE TABLE canvas_states (
    project_id INTEGER,
    canvas_data TEXT,
    navigation_state TEXT, -- JSON state
    updated_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

## Best Practices

### 1. Respect User Intent

```javascript
// Don't auto-restore if user explicitly resets
if (!userRequestedReset) {
    restoreNavigationState();
}
```

### 2. Handle Edge Cases

```javascript
// Validate state before applying
function isValidState(state) {
    return state 
        && typeof state.scale === 'number'
        && Array.isArray(state.offset)
        && state.offset.length === 2
        && state.scale > 0
        && state.scale <= MAX_SCALE;
}
```

### 3. Performance Considerations

- Debounce saves during active navigation
- Use PATCH to update only navigation state
- Cache state client-side to reduce requests

## Future Enhancements

### User-Specific Views

```javascript
// Future: Per-user navigation state
{
    userId: 123,
    projectId: 456,
    navigationState: {...},
    isDefault: false
}
```

### View Bookmarks

```javascript
// Save named views
const bookmarks = [
    { name: "Overview", scale: 0.5, offset: [0, 0] },
    { name: "Detail Work", scale: 2.0, offset: [500, 300] }
];
```

### Collaborative Focus

```javascript
// "Follow user" feature
function followUser(userId) {
    const userState = getUserNavigationState(userId);
    animateToState(userState);
}
```

## Troubleshooting

### State Not Saving

1. Check network requests for errors
2. Verify debounce isn't too long
3. Ensure project ID is correct
4. Check server logs for save failures

### State Not Restoring

1. Verify state exists in response
2. Check for validation errors
3. Ensure canvas is ready before applying
4. Look for JavaScript errors

### Performance Issues

1. Increase debounce delay
2. Batch multiple state changes
3. Use requestAnimationFrame for smooth updates
4. Profile navigation event handlers