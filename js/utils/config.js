// ===================================
// GLOBAL CONFIGURATION
// ===================================

// Determine environment
const isDevelopment = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1';

// Dynamic server configuration
const serverHost = isDevelopment ? 'localhost' : window.location.hostname;
const serverPort = 3000;
const serverProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

const CONFIG = {
    // Server configuration
    SERVER: {
        HOST: serverHost,
        PORT: serverPort,
        PROTOCOL: serverProtocol,
        WS_PROTOCOL: wsProtocol,
        API_BASE: `${serverProtocol}://${serverHost}:${serverPort}`,
        WS_URL: `${wsProtocol}://${serverHost}:${serverPort}`
    },
    
    // Collaboration settings
    COLLABORATION: {
        ENABLED: true,
        SYNC_INTERVAL: 30000, // 30 seconds
        HEARTBEAT_INTERVAL: 5000, // 5 seconds
        CURSOR_THROTTLE: 50, // ms
        OPERATION_TIMEOUT: 5000, // 5 seconds
        MAX_RECONNECT_ATTEMPTS: 5,
        RECONNECT_DELAY: 1000, // 1 second, doubles each attempt
        USER_COLORS: [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
            '#F8B739', '#6C5CE7', '#A29BFE', '#FD79A8', '#FDCB6E'
        ]
    },
    
    CANVAS: {
        DEFAULT_SCALE: 1.0,
        MIN_SCALE: 0.05,
        MAX_SCALE: 10.0,
        GRID_SIZE: 20,
        MIN_GRID_SCALE: 0.5,
        AUTO_SAVE_INTERVAL: 5000 // 5 seconds backup save
    },
    
    PERFORMANCE: {
        MAX_FPS: 120,
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
    
    NAVIGATION: {
        ANIMATION_DURATION: 240, // milliseconds
        ENABLE_ANIMATION: true,
        ARROW_KEY_ENABLED: true,
        DIRECTION_ANGLE_TOLERANCE: 45 // degrees for direction quadrants
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

// API endpoint helpers
CONFIG.ENDPOINTS = {
    // Projects
    PROJECTS: `${CONFIG.SERVER.API_BASE}/projects`,
    PROJECT: (id) => `${CONFIG.SERVER.API_BASE}/projects/${id}`,
    PROJECT_CANVAS: (id) => `${CONFIG.SERVER.API_BASE}/projects/${id}/canvas`,
    USER_PROJECTS: (userId) => `${CONFIG.SERVER.API_BASE}/projects/user/${userId}`,
    
    // Media
    UPLOAD: `${CONFIG.SERVER.API_BASE}/upload`,
    UPLOADS: `${CONFIG.SERVER.API_BASE}/uploads`,
    
    // Health
    HEALTH: `${CONFIG.SERVER.API_BASE}/health`,
    WS_TEST: `${CONFIG.SERVER.API_BASE}/test-websocket`,
    
    // Database maintenance
    DATABASE_SIZE: `${CONFIG.SERVER.API_BASE}/database/size`,
    DATABASE_CLEANUP: `${CONFIG.SERVER.API_BASE}/database/cleanup`
};

// Helper to get user color
CONFIG.getUserColor = function(index) {
    return CONFIG.COLLABORATION.USER_COLORS[index % CONFIG.COLLABORATION.USER_COLORS.length];
};

// Make CONFIG globally available
window.CONFIG = CONFIG;