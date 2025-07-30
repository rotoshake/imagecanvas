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
        MAX_SCALE: 20.0,
        GRID_SIZE: 20,
        MIN_GRID_SCALE: 0.5,
        AUTO_SAVE_INTERVAL: 5000, // 5 seconds backup save
        ZOOM_FACTOR: 1.2 // How much to zoom per scroll step (was 1.1, now 1.2 for faster zoom)
    },
    
    PERFORMANCE: {
        MAX_FPS: 120,
        THUMBNAIL_THRESHOLD: 50, // pixels - use thumbnail when video node is smaller than this on screen
        VISIBILITY_MARGIN: 200,
        BATCH_SIZE: 100
    },
    
    ALIGNMENT: {
        DEFAULT_MARGIN: 20,
        SPRING_K: 1550,  // Spring constant (stiffness) - frame-rate independent
        SPRING_D: 44.0,   // Damping coefficient - frame-rate independent  
        TOLERANCE: 10,
        ANIMATION_THRESHOLD: 2.0,  // Higher = tighter/faster finish, lower = smoother/longer tail
        ANIMATION_DURATION: 150,   // Duration in milliseconds for ease animations
        
        // Performance optimizations for large node counts
        LARGE_SCALE_THRESHOLD: 100,  // Switch to optimized mode above this many nodes
        LARGE_SCALE_SPRING_K: 2500,  // Higher stiffness for faster convergence with many nodes
        LARGE_SCALE_SPRING_D: 70.0,  // Higher damping to prevent oscillation
        LARGE_SCALE_THRESHOLD_MULTIPLIER: 5.0,  // Looser threshold for large scales
        MAX_ANIMATION_BATCH_SIZE: 100,  // Process this many nodes per frame maximum
        FRAME_BUDGET_MS: 4  // Maximum milliseconds to spend on alignment animation per frame
    },
    
    NAVIGATION: {
        ANIMATION_DURATION: 240, // milliseconds
        ENABLE_ANIMATION: true,
        ARROW_KEY_ENABLED: true,
        DIRECTION_ANGLE_TOLERANCE: 45 // degrees for direction quadrants
    },
    
    HANDLES: {
        SIZE: 16,                    // Hitbox radius in pixels for resize handles (corner dots)
        MIN_NODE_SIZE: 50,           // Minimum node size in pixels before handles are shown
        ROTATION_DISTANCE: 20,       // Maximum distance in pixels from corner where rotation handle is active
        MIN_ROTATION_DISTANCE: 8,    // Minimum distance in pixels from corner to avoid overlap with resize handle
        ROTATION_SNAP_ANGLE: 45      // Angle in degrees for rotation snapping when holding shift
    },
    
    STORAGE: {
        STATE_KEY: 'litegraph_state',
        UNDO_STACK_KEY: 'litegraph_undo_stack',
        MAX_STATE_SIZE: 5 * 1024 * 1024,
        MAX_UNDO_STATES: 20
    },
    
    THUMBNAILS: {
        SIZES: [64, 256, 512],  // Reduced from 4 to 3 sizes
        QUALITY: 'high'
    },
    
    IMPORT: {
        IMAGE_IMPORT_MODE: 'fit', // 'native' or 'fit'
        FIT_SIZE: 200 // Height in pixels when using 'fit' mode
    },
    // Rendering
    RENDERER: {
        DEFAULT: 'webgl' // 'canvas2d' or 'webgl'
    }
};

// Logging configuration
CONFIG.LOGGING = {
    // Global logging level: 'error', 'warn', 'info', 'debug', 'verbose'
    LEVEL: 'warn',
    
    // System-specific logging levels (overrides global)
    SYSTEMS: {
        // Image upload and processing
        UPLOAD: 'warn',           // 'error', 'warn', 'info', 'debug', 'verbose'
        THUMBNAIL: 'warn',        // 'error', 'warn', 'info', 'debug', 'verbose'
        IMAGE_NODE: 'warn',       // 'error', 'warn', 'info', 'debug', 'verbose'
        
        // State synchronization
        STATE_SYNC: 'warn',       // 'error', 'warn', 'info', 'debug', 'verbose'
        OPERATION_PIPELINE: 'warn', // 'error', 'warn', 'info', 'debug', 'verbose'
        
        // Drag and drop
        DRAGDROP: 'warn',         // 'error', 'warn', 'info', 'debug', 'verbose'
        
        // Cache and performance
        CACHE: 'warn',            // 'error', 'warn', 'info', 'debug', 'verbose'
        PERFORMANCE: 'warn',      // 'error', 'warn', 'info', 'debug', 'verbose'
    },
    
    // Enable/disable specific log types
    ENABLED: {
        THUMBNAIL_GENERATION: false,    // Disable thumbnail generation logs
        UPLOAD_PROGRESS: false,         // Disable upload progress logs
        STATE_SYNC_DETAILS: false,      // Disable detailed state sync logs
        OPERATION_ACK: false,           // Disable operation acknowledgment logs
        CACHE_OPERATIONS: false,        // Disable cache operation logs
        DRAGDROP_DETAILS: false,        // Disable dragdrop detailed logs
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

// Global logging control function
window.setLogLevel = function(level = 'warn', system = null) {
    if (system) {
        CONFIG.LOGGING.SYSTEMS[system] = level;
        
    } else {
        CONFIG.LOGGING.LEVEL = level;
        
    }
};

window.enableLogType = function(logType, enabled = true) {
    CONFIG.LOGGING.ENABLED[logType] = enabled;
    
};

// Quick presets for common scenarios
window.setLoggingPreset = function(preset) {
    switch (preset) {
        case 'quiet':
            CONFIG.LOGGING.LEVEL = 'error';
            Object.keys(CONFIG.LOGGING.ENABLED).forEach(key => {
                CONFIG.LOGGING.ENABLED[key] = false;
            });
            console.log('🔇 Set logging to quiet mode (errors only)');
            break;
        case 'normal':
            CONFIG.LOGGING.LEVEL = 'warn';
            Object.keys(CONFIG.LOGGING.ENABLED).forEach(key => {
                CONFIG.LOGGING.ENABLED[key] = false;
            });
            console.log('🔊 Set logging to normal mode (warnings and errors)');
            break;
        case 'debug':
            CONFIG.LOGGING.LEVEL = 'info';
            CONFIG.LOGGING.ENABLED.THUMBNAIL_GENERATION = true;
            CONFIG.LOGGING.ENABLED.UPLOAD_PROGRESS = true;
            console.log('🐛 Set logging to debug mode (info level with key systems enabled)');
            break;
        case 'verbose':
            CONFIG.LOGGING.LEVEL = 'debug';
            Object.keys(CONFIG.LOGGING.ENABLED).forEach(key => {
                CONFIG.LOGGING.ENABLED[key] = true;
            });
            console.log('🔊 Set logging to verbose mode (all systems enabled)');
            break;
        default:
            
    }
};