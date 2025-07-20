# Network Broadcast Fix - "Cannot broadcast: not connected"

## Problem
When moving nodes, the console showed "Cannot broadcast: not connected or not in project" even though:
- NetworkLayer was connected to the server (✅)
- UI showed "Connected" status (✅)
- But `currentProject` was `null` (❌)

## Root Cause
Two issues were preventing the NetworkLayer from joining projects:

1. **Missing Parameters**: The NetworkLayer's `joinProject` method was sending incomplete data:
   - NetworkLayer sent: `{ projectId, canvasId, tabId, userId }`
   - Server expected: `{ projectId, username, displayName, tabId }`

2. **Wrong Property Access**: When receiving the `project_joined` event:
   - Server sent: `{ project: { id: 1, name: "..." }, session: {...} }`
   - NetworkLayer expected: `{ projectId: 1 }`
   - Result: `currentProject` was set to `{ id: undefined }`

## Solution
1. **Added missing parameters** to the join request:
```javascript
const data = {
    projectId,
    canvasId,
    tabId: this.tabId,
    userId: this.currentUser?.id,
    // Server expects username and displayName
    username: this.currentUser?.username || `user-${this.tabId.substr(-8)}`,
    displayName: this.currentUser?.displayName || `User ${this.tabId.substr(-8)}`
};
```

2. **Fixed property access** in the project_joined handler:
```javascript
this.socket.on('project_joined', (data) => {
    // Server sends data.project object, not data.projectId
    if (data.project && data.project.id) {
        this.currentProject = { id: data.project.id };
        console.log('✅ Current project set to:', this.currentProject);
    }
});
```

## Testing
1. Clear browser cache (Cmd+Shift+R)
2. Reload the page
3. Load a canvas - you should see in console:
   - `📁 NetworkLayer.joinProject called: projectId=1`
   - `📤 Emitting join_project: {...}`
   - `📁 Received project_joined event: {...}`
   - `✅ Current project set to: {id: 1}`
4. Move a node - broadcasts should now work without errors

## Status
✅ NetworkLayer connects to server
✅ NetworkLayer joins projects correctly
✅ Operations can be broadcast without "not in project" error
✅ The circular reference issue remains fixed with GraphCircularReferenceResolver

## Debug Tools Created
All diagnostic tools are in `/tests/debug/`:
- `check-html-source.html` - Verifies script tags in HTML
- `error-catcher.html` - Catches all JS errors
- `loaded-scripts.html` - Shows which scripts are loaded
- `test-join-project.html` - Tests project joining
- `network-diagnostic.html` - Comprehensive network testing