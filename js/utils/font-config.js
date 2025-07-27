/**
 * Font Configuration
 * 
 * CHANGE FONTS HERE - This is the single source of truth for all fonts in the application.
 * Updates here will automatically apply throughout the entire codebase.
 */

// Get CSS custom property value or use fallback
function getCSSVariable(name, fallback) {
    if (typeof window !== 'undefined' && window.getComputedStyle) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    }
    return fallback;
}

// Font configuration object
const FONT_CONFIG = {
    // Main application font family
    get APP_FONT() {
        return getCSSVariable('--app-font-family', "'Roboto', sans-serif");
    },
    
    // Monospace font for code/debug displays
    get MONO_FONT() {
        return getCSSVariable('--app-font-mono', "'Roboto Mono', monospace");
    },
    
    // Helper method to get clean font name without quotes for canvas
    get APP_FONT_CANVAS() {
        return this.APP_FONT.replace(/['"]/g, '');
    },
    
    get MONO_FONT_CANVAS() {
        return this.MONO_FONT.replace(/['"]/g, '');
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.FONT_CONFIG = FONT_CONFIG;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FONT_CONFIG;
}