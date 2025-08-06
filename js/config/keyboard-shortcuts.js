// ===================================
// KEYBOARD SHORTCUTS CONFIGURATION
// ===================================

const KEYBOARD_SHORTCUTS = {
    // Canvas Navigation
    NAVIGATION: {
        PAN: {
            keys: ['Space'], // Hold space and drag to pan
            modifiers: [],
            description: 'Pan canvas (hold and drag)'
        },
        // PAN_ALT: {
        //     keys: ['Cmd', 'Click'], // Cmd+drag on Mac, Ctrl+drag on PC
        //     modifiers: ['ctrlKey'],
        //     description: 'Pan canvas (alternative)'
        // },
        ZOOM_IN: {
            keys: ['=', '+'],
            modifiers: [],
            description: 'Zoom in'
        },
        ZOOM_OUT: {
            keys: ['-'],
            modifiers: [],
            description: 'Zoom out'
        },
        FIT_VIEW: {
            keys: ['f'],
            modifiers: [],
            description: 'Fit all nodes in view'
        },
        RESET_VIEW: {
            keys: ['h'],
            modifiers: [],
            description: 'Reset view to home'
        }
    },

    // Selection
    SELECTION: {
        SELECT_ALL: {
            keys: ['a'],
            modifiers: ['ctrlKey'],
            description: 'Select all nodes'
        },
        TOGGLE_SELECT: {
            keys: ['Shift', 'Click'],
            modifiers: ['shiftKey'],
            description: 'Toggle node selection'
        },
        AUTO_ALIGN: {
            keys: ['Cmd', 'Click'],
            modifiers: ['ctrlKey'],
            description: 'Auto-align while dragging'
        },
        GRID_ALIGN: {
            keys: ['Cmd', 'Shift', 'Click'],
            modifiers: ['ctrlKey', 'shiftKey'],
            description: 'Grid align nodes (Ctrl+Shift+click/drag)'
        },
        ROTATION_SNAP: {
            keys: ['Shift', 'Drag'],
            modifiers: ['shiftKey'],
            description: 'Snap rotation to increments while dragging'
        },
        RESIZE_ASPECT_LOCK: {
            keys: ['Shift', 'Resize'],
            modifiers: ['shiftKey'],
            description: 'Lock aspect ratio while resizing'
        },
        RESIZE_FROM_CENTER: {
            keys: ['Cmd', 'Resize'],
            modifiers: ['ctrlKey'],
            description: 'Resize from center (Alt/Option on Mac)'
        }
    },

    // Node Operations
    NODE_OPERATIONS: {
        DUPLICATE_DRAG: {
            keys: ['Option', 'Drag'], // Alt on PC
            modifiers: ['altKey'],
            description: 'Duplicate node by dragging'
        },
        DUPLICATE: {
            keys: ['d'],
            modifiers: ['ctrlKey'],
            description: 'Duplicate selected nodes'
        },
        DELETE: {
            keys: ['Delete', 'Backspace'],
            modifiers: [],
            description: 'Delete selected nodes'
        },
        GROUP_CREATE: {
            keys: ['g'],
            modifiers: [],
            description: 'Create group from selected nodes'
        },
        TEXT_NODE: {
            keys: ['t'],
            modifiers: [],
            description: 'Create text node'
        },
        SHAPE_NODE: {
            keys: ['s'],
            modifiers: [],
            description: 'Create shape node'
        }
    },

    // Clipboard
    CLIPBOARD: {
        COPY: {
            keys: ['c'],
            modifiers: ['ctrlKey'],
            description: 'Copy selected nodes'
        },
        CUT: {
            keys: ['x'],
            modifiers: ['ctrlKey'],
            description: 'Cut selected nodes'
        },
        PASTE: {
            keys: ['v'],
            modifiers: ['ctrlKey'],
            description: 'Paste nodes'
        }
    },

    // Layer Control
    LAYERS: {
        MOVE_UP: {
            keys: [']'],
            modifiers: [],
            description: 'Move selected nodes up one layer'
        },
        MOVE_DOWN: {
            keys: ['['],
            modifiers: [],
            description: 'Move selected nodes down one layer'
        },
        BRING_TO_FRONT: {
            keys: [']'],
            modifiers: ['shiftKey'],
            description: 'Bring selected nodes to front'
        },
        SEND_TO_BACK: {
            keys: ['['],
            modifiers: ['shiftKey'],
            description: 'Send selected nodes to back'
        }
    },

    // File Operations
    FILE: {
        SAVE: {
            keys: ['s'],
            modifiers: ['ctrlKey'],
            description: 'Save canvas'
        },
        SYNC: {
            keys: ['r'],
            modifiers: [],
            description: 'Sync with server'
        },
        OPEN_NAVIGATOR: {
            keys: ['o'],
            modifiers: ['ctrlKey'],
            description: 'Open canvas navigator'
        }
    },

    // Undo/Redo
    HISTORY: {
        UNDO: {
            keys: ['z'],
            modifiers: ['ctrlKey'],
            description: 'Undo last action'
        },
        REDO: {
            keys: ['z'],
            modifiers: ['ctrlKey', 'shiftKey'],
            description: 'Redo last action'
        },
        REDO_ALT: {
            keys: ['y'],
            modifiers: ['ctrlKey'],
            description: 'Redo last action (Windows style)'
        }
    },

    // UI Panels
    PANELS: {
        PROPERTIES: {
            keys: ['p'],
            modifiers: [],
            description: 'Toggle properties panel'
        },
        COLOR_CORRECTION: {
            keys: ['c'],
            modifiers: [],
            description: 'Toggle color correction panel'
        },
        USER_PROFILE: {
            keys: ['u'],
            modifiers: [],
            description: 'Toggle user profile panel'
        },
        TOGGLE_TITLES: {
            keys: ['t'],
            modifiers: ['shiftKey'],
            description: 'Toggle title visibility'
        },
        CHAT: {
            keys: ['`'],
            modifiers: [],
            description: 'Toggle chat panel'
        }
    },

    // Alignment
    ALIGNMENT: {
        ALIGN_HORIZONTAL: {
            keys: ['1'],
            modifiers: [],
            description: 'Align selected nodes horizontally'
        },
        ALIGN_VERTICAL: {
            keys: ['2'],
            modifiers: [],
            description: 'Align selected nodes vertically'
        }
    },

    // Gallery Mode
    GALLERY: {
        NEXT: {
            keys: ['ArrowRight'],
            modifiers: [],
            description: 'Next image in gallery'
        },
        PREVIOUS: {
            keys: ['ArrowLeft'],
            modifiers: [],
            description: 'Previous image in gallery'
        },
        EXIT: {
            keys: ['Escape'],
            modifiers: [],
            description: 'Exit gallery mode'
        }
    },

    // Arrow Navigation (when enabled)
    ARROW_NAV: {
        UP: {
            keys: ['ArrowUp'],
            modifiers: [],
            description: 'Navigate to node above'
        },
        DOWN: {
            keys: ['ArrowDown'],
            modifiers: [],
            description: 'Navigate to node below'
        },
        LEFT: {
            keys: ['ArrowLeft'],
            modifiers: [],
            description: 'Navigate to node on left'
        },
        RIGHT: {
            keys: ['ArrowRight'],
            modifiers: [],
            description: 'Navigate to node on right'
        }
    },

    // Text Editing
    TEXT_EDITING: {
        FINISH_EDIT: {
            keys: ['Enter'],
            modifiers: ['ctrlKey'],
            description: 'Finish editing text'
        },
        CANCEL_EDIT: {
            keys: ['Escape'],
            modifiers: [],
            description: 'Cancel text editing'
        }
    },

    // Developer/Debug
    DEBUG: {
        FPS_TEST: {
            keys: ['f'],
            modifiers: ['ctrlKey', 'shiftKey'],
            description: 'Open FPS test menu'
        },
        DATABASE_WIPE: {
            keys: ['Delete'],
            modifiers: ['ctrlKey', 'shiftKey'],
            description: 'Wipe database (debug only)'
        }
    }
};

// Helper function to check if a keyboard event matches a shortcut
function matchesShortcut(event, shortcut) {
    // For mouse events (drag operations), event.key might be undefined
    const key = event.key ? event.key.toLowerCase() : '';
    const isMouseEvent = event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'mousemove' || event.type === 'click';
    
    // Check if any of the keys match
    const keyMatches = shortcut.keys.some(k => {
        if (k === 'Space' && (event.key === ' ' || event.code === 'Space')) return true;
        if (k === 'Click' && isMouseEvent) return true; // Only match Click for mouse events
        if (k === 'Drag' && isMouseEvent) return true; // Only match Drag for mouse events
        if (k === 'Option' && event.altKey) return true; // Mac Option key
        if (k === 'Cmd' && isMouseEvent && (event.metaKey || event.ctrlKey)) return true; // Cmd only for mouse events
        if (k === 'Shift' && event.shiftKey) return true; // Shift key
        // Handle special keys that might be capitalized in config
        if ((k === 'Delete' || k === 'delete') && (event.key === 'Delete' || event.key === 'delete')) return true;
        if ((k === 'Backspace' || k === 'backspace') && (event.key === 'Backspace' || event.key === 'backspace')) return true;
        return event.key && k.toLowerCase() === key;
    });
    
    if (!keyMatches) return false;
    
    // Check modifiers
    const modifiers = shortcut.modifiers || [];
    
    // For shortcuts with modifiers, check that all required modifiers are pressed
    // On Mac, Cmd key (metaKey) is used instead of Ctrl
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (modifiers.includes('ctrlKey')) {
        if (isMac && !event.metaKey) return false;
        if (!isMac && !event.ctrlKey) return false;
    }
    if (modifiers.includes('shiftKey') && !event.shiftKey) return false;
    if (modifiers.includes('altKey') && !event.altKey) return false;
    
    // For shortcuts without modifiers, ensure no modifiers are pressed (unless it's a modifier-only shortcut)
    if (modifiers.length === 0 && !['Space', 'Shift', 'Alt', 'Control', 'Meta'].includes(event.key)) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
    }
    
    return true;
}

// Helper function to get a human-readable string for a shortcut
function getShortcutString(shortcut) {
    const parts = [];
    
    if (shortcut.modifiers) {
        if (shortcut.modifiers.includes('ctrlKey')) {
            parts.push(navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');
        }
        if (shortcut.modifiers.includes('shiftKey')) parts.push('Shift');
        if (shortcut.modifiers.includes('altKey')) {
            parts.push(navigator.platform.includes('Mac') ? 'Option' : 'Alt');
        }
    }
    
    // Add the main key(s)
    const mainKey = shortcut.keys[0];
    if (mainKey === 'Space') parts.push('Space');
    else if (mainKey === 'Delete') parts.push('Delete');
    else if (mainKey === 'Backspace') parts.push('Backspace');
    else if (mainKey === 'ArrowUp') parts.push('↑');
    else if (mainKey === 'ArrowDown') parts.push('↓');
    else if (mainKey === 'ArrowLeft') parts.push('←');
    else if (mainKey === 'ArrowRight') parts.push('→');
    else if (mainKey === 'Enter') parts.push('Enter');
    else if (mainKey === 'Escape') parts.push('Esc');
    else parts.push(mainKey.toUpperCase());
    
    return parts.join('+');
}

// Helper function to find which shortcut an event matches
function findMatchingShortcut(event) {
    for (const category of Object.values(KEYBOARD_SHORTCUTS)) {
        for (const [name, shortcut] of Object.entries(category)) {
            if (matchesShortcut(event, shortcut)) {
                return { name, shortcut, category };
            }
        }
    }
    return null;
}

// Export for use in other modules
window.KEYBOARD_SHORTCUTS = KEYBOARD_SHORTCUTS;
window.matchesShortcut = matchesShortcut;
window.getShortcutString = getShortcutString;
window.findMatchingShortcut = findMatchingShortcut;

// Also export as ES6 module if supported
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        KEYBOARD_SHORTCUTS,
        matchesShortcut,
        getShortcutString,
        findMatchingShortcut
    };
}