// ===================================
// GLOBAL CONFIGURATION
// ===================================

const CONFIG = {
    CANVAS: {
        DEFAULT_SCALE: 1.0,
        MIN_SCALE: 0.05,
        MAX_SCALE: 10.0,
        GRID_SIZE: 20,
        MIN_GRID_SCALE: 0.5
    },
    
    PERFORMANCE: {
        MAX_FPS: 60,
        THUMBNAIL_THRESHOLD: 50, // pixels
        VISIBILITY_MARGIN: 200,
        BATCH_SIZE: 100
    },
    
    ALIGNMENT: {
        DEFAULT_MARGIN: 20,
        SPRING_K: 180.0,
        SPRING_D: 16.0,
        ANIMATION_DT: 1/40,
        TOLERANCE: 10,
        ANIMATION_THRESHOLD: 2.0  // Higher = tighter/faster finish, lower = smoother/longer tail
    },
    
    HANDLES: {
        SIZE: 16,
        MIN_NODE_SIZE: 24,
        ROTATION_DISTANCE: 25,
        MIN_ROTATION_DISTANCE: 8,
        ROTATION_SNAP_ANGLE: 45  // degrees
    },
    
    STORAGE: {
        STATE_KEY: 'litegraph_state',
        UNDO_STACK_KEY: 'litegraph_undo_stack',
        MAX_STATE_SIZE: 5 * 1024 * 1024,
        MAX_UNDO_STATES: 20
    },
    
    THUMBNAILS: {
        SIZES: [64, 128, 256, 512],
        QUALITY: 'high'
    }
};