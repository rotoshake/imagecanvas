// ===================================
// UTILITY FUNCTIONS
// ===================================

const Utils = {
    // Math utilities
    clamp: (value, min, max) => Math.min(Math.max(value, min), max),
    
    lerp: (a, b, t) => a + (b - a) * t,
    
    distance: (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),
    
    // Animation easing functions
    easeInOutCubic: (t) => {
        return t < 0.5 
            ? 4 * t * t * t 
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    
    // Angle utilities
    angleFromTo: (x1, y1, x2, y2) => {
        return Math.atan2(y2 - y1, x2 - x1);
    },
    
    radToDeg: (rad) => rad * (180 / Math.PI),
    
    degToRad: (deg) => deg * (Math.PI / 180),
    
    normalizeAngle: (angle) => {
        // Normalize angle to -180 to 180 degrees
        angle = angle % 360;
        if (angle > 180) angle -= 360;
        if (angle < -180) angle += 360;
        return angle;
    },
    
    // Validation utilities
    isValidArray: (arr, length) => Array.isArray(arr) && arr.length === length && arr.every(Number.isFinite),
    
    isValidNumber: (num) => Number.isFinite(num) && !Number.isNaN(num),
    
    // DOM utilities
    createCanvas: (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    },
    
    // Performance utilities
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    throttle: (func, limit) => {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },
    
    // String utilities
    truncateText: (ctx, text, maxWidth) => {
        const ellipsis = '...';
        let textWidth = ctx.measureText(text).width;
        
        if (textWidth <= maxWidth) return text;
        
        const ellipsisWidth = ctx.measureText(ellipsis).width;
        const availableWidth = maxWidth - ellipsisWidth;
        
        // Binary search for optimal length
        let left = 0;
        let right = text.length;
        let bestLength = 0;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const testText = text.substring(0, mid);
            const testWidth = ctx.measureText(testText).width;
            
            if (testWidth <= availableWidth) {
                bestLength = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return text.substring(0, bestLength) + ellipsis;
    }
};

/**
 * Logging utility with verbosity control
 */
const Logger = {
    // Log levels in order of verbosity
    LEVELS: {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3,
        verbose: 4
    },
    
    /**
     * Check if a log level should be displayed
     */
    shouldLog(system, level) {
        const globalLevel = CONFIG.LOGGING?.LEVEL || 'warn';
        const systemLevel = CONFIG.LOGGING?.SYSTEMS?.[system] || globalLevel;
        
        const globalThreshold = this.LEVELS[globalLevel] || 1;
        const systemThreshold = this.LEVELS[systemLevel] || 1;
        
        // Use the more restrictive threshold
        const threshold = Math.min(globalThreshold, systemThreshold);
        const messageLevel = this.LEVELS[level] || 1;
        
        return messageLevel <= threshold;
    },
    
    /**
     * Check if a specific log type is enabled
     */
    isEnabled(logType) {
        return CONFIG.LOGGING?.ENABLED?.[logType] !== false;
    },
    
    /**
     * Log with system and level control
     */
    log(system, level, message, ...args) {
        if (this.shouldLog(system, level)) {
            const logMethod = console[level] || console.log;
            logMethod(message, ...args);
        }
    },
    
    /**
     * Convenience methods for different systems
     */
    upload(level, message, ...args) {
        this.log('UPLOAD', level, message, ...args);
    },
    
    thumbnail(level, message, ...args) {
        this.log('THUMBNAIL', level, message, ...args);
    },
    
    imageNode(level, message, ...args) {
        this.log('IMAGE_NODE', level, message, ...args);
    },
    
    stateSync(level, message, ...args) {
        this.log('STATE_SYNC', level, message, ...args);
    },
    
    operationPipeline(level, message, ...args) {
        this.log('OPERATION_PIPELINE', level, message, ...args);
    },
    
    dragdrop(level, message, ...args) {
        this.log('DRAGDROP', level, message, ...args);
    },
    
    cache(level, message, ...args) {
        this.log('CACHE', level, message, ...args);
    },
    
    performance(level, message, ...args) {
        this.log('PERFORMANCE', level, message, ...args);
    }
};

// ===================================
// HASH UTILITIES
// ===================================

class HashUtils {
    static async hashImageData(dataURL) {
        const base64 = dataURL.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

// Make Utils and HashUtils available globally
if (typeof window !== 'undefined') {
    window.Utils = Utils;
    window.HashUtils = HashUtils;
    window.Logger = Logger;
}