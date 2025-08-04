# Keyboard Shortcuts Configuration

This document explains the keyboard shortcuts system in ImageCanvas and how to customize it.

## Overview

The keyboard shortcuts are defined in `/js/config/keyboard-shortcuts.js` and can be customized programmatically or through user preferences.

## Default Shortcuts

### Canvas Navigation
- **Space + Drag** - Pan canvas
- **Cmd/Ctrl + Drag** - Pan canvas (alternative)
- **= or +** - Zoom in
- **-** - Zoom out
- **F** - Fit all nodes in view
- **H** - Reset view to home

### Selection
- **Cmd/Ctrl + A** - Select all nodes
- **Shift + Click** - Toggle node selection
- **Shift + Drag** - Auto-align while dragging
- **Cmd/Ctrl + Shift + Click/Drag** - Grid align nodes

### Node Operations
- **Option/Alt + Drag** - Duplicate node by dragging
- **Cmd/Ctrl + D** - Duplicate selected nodes
- **Delete/Backspace** - Delete selected nodes
- **G** - Create group from selected nodes
- **T** - Create text node
- **S** - Create shape node

### Clipboard
- **Cmd/Ctrl + C** - Copy selected nodes
- **Cmd/Ctrl + X** - Cut selected nodes
- **Cmd/Ctrl + V** - Paste nodes

### Layer Control
- **]** - Move selected nodes up one layer
- **[** - Move selected nodes down one layer
- **Shift + ]** - Bring selected nodes to front
- **Shift + [** - Send selected nodes to back

### File Operations
- **Cmd/Ctrl + S** - Save canvas
- **R** - Sync with server
- **Cmd/Ctrl + O** - Open canvas navigator

### History
- **Cmd/Ctrl + Z** - Undo
- **Cmd/Ctrl + Shift + Z** - Redo
- **Cmd/Ctrl + Y** - Redo (Windows style)

### UI Panels
- **P** - Toggle properties panel
- **C** - Toggle color correction panel
- **U** - Toggle user profile panel
- **Shift + T** - Toggle title visibility

### Alignment
- **1** - Align selected nodes horizontally
- **2** - Align selected nodes vertically

### Gallery Mode
- **Arrow Right** - Next image
- **Arrow Left** - Previous image
- **Escape** - Exit gallery mode

### Arrow Navigation (when enabled)
- **Arrow Keys** - Navigate between nodes

### Text Editing
- **Cmd/Ctrl + Enter** - Finish editing text
- **Escape** - Cancel text editing

## Customizing Shortcuts

### Using the Configuration File

The shortcuts are defined in a structured format:

```javascript
KEYBOARD_SHORTCUTS = {
    CATEGORY: {
        ACTION: {
            keys: ['key1', 'key2'],      // Primary keys
            modifiers: ['ctrlKey'],      // Required modifiers
            description: 'What it does'   // Human-readable description
        }
    }
}
```

### Programmatic Customization

You can customize shortcuts using the `KeyboardShortcutManager`:

```javascript
// Create manager instance
const shortcutManager = new KeyboardShortcutManager(canvas);

// Override a shortcut
shortcutManager.setCustomShortcut('NODE_OPERATIONS', 'GROUP_CREATE', ['q'], []);

// Reset to default
shortcutManager.resetShortcut('NODE_OPERATIONS', 'GROUP_CREATE');

// Get current shortcut (custom or default)
const shortcut = shortcutManager.getShortcut('NODE_OPERATIONS', 'GROUP_CREATE');
```

### Integration with Canvas

To integrate the keyboard shortcut system with your canvas:

1. Include the configuration files:
```html
<script src="js/config/keyboard-shortcuts.js"></script>
<script src="js/config/keyboard-shortcuts-integration.js"></script>
```

2. Create a shortcut manager:
```javascript
const shortcutManager = new KeyboardShortcutManager(imageCanvas);
```

3. Replace the existing keyboard handler:
```javascript
onKeyDown(e) {
    if (this.shortcutManager.handleKeyEvent(e)) {
        e.preventDefault();
    }
}
```

## Testing Shortcuts

A test page is available at `/.scratch/test-keyboard-shortcuts.html` that allows you to:
- View all current shortcuts
- Test key detection
- Set custom shortcuts
- Reset shortcuts to defaults

## Storage

Custom shortcuts are saved to localStorage under the key `imagecanvas_custom_shortcuts` and persist across sessions.

## Helper Functions

Several helper functions are available:

- `matchesShortcut(event, shortcut)` - Check if a keyboard event matches a shortcut
- `getShortcutString(shortcut)` - Get human-readable string (e.g., "Cmd+S")
- `findMatchingShortcut(event)` - Find which shortcut matches an event

## Platform Differences

The system automatically handles platform differences:
- **Mac**: Cmd key, Option key
- **Windows/Linux**: Ctrl key, Alt key

## Adding New Shortcuts

To add a new shortcut:

1. Add it to the appropriate category in `keyboard-shortcuts.js`
2. Implement the action in the corresponding execute method in `keyboard-shortcuts-integration.js`
3. Update this documentation

## Future Enhancements

Potential improvements:
- Visual shortcut editor UI
- Import/export shortcut configurations
- Shortcut conflict detection
- Context-sensitive shortcuts
- Shortcut cheat sheet overlay (? key)