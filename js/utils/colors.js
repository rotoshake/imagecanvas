// ===================================
// CENTRALIZED COLOR MANAGEMENT
// ===================================

/**
 * Centralized color configuration for ImageCanvas
 * All colors should be referenced from this file to maintain consistency
 * and enable easy theming/customization
 */

const COLORS = {
    // Background colors
    backgrounds: {
        canvas_primary: '#222222',
        canvas_gallery: '#111111',
        panel_primary: 'rgba(30, 30, 30, 0.75)',
        panel_secondary: '#222222',
        overlay_dark: 'rgba(0, 0, 0, 0.8)',
        overlay_darker: 'rgba(0, 0, 0, 0.9)',
        overlay_darkest: 'rgba(0, 0, 0, 0.95)',
        node_default: 'rgba(0, 0, 0, 0.7)',
        node_selected: 'rgba(255, 255, 255, 0.1)',
        node_title: 'rgba(0, 0, 0, 0.2)',
        input_readonly: '#f5f5f5',
        notification_base: 'rgba(0, 0, 0, 0.85)'
    },

    // Text colors
    text: {
        base: '#e0e0e0',
        emphasized: '#f0f0f0',
        minimal: '#999',
        disabled: '#666',
        muted: '#888',
        bright: '#fff',
        canvas_primary: '#999',
        canvas_secondary: '#ccc',
        canvas_emphasized: '#eee',
        canvas_bright: '#dde',
        canvas_error: '#B99'
    },

    // Accent and selection colors
    accents: {
        primary: '#4af',           // Main accent color used throughout app
        selection_border: '#CCC',
        selection_highlight: '#4af',
        navigator_accent: '#4CAF50',
        drag_highlight: 'rgba(68, 170, 255, 0.1)'
    },

    // Status and notification colors
    status: {
        success: '#4CAF50',
        success_secondary: 'rgba(76, 175, 80, 0.9)',
        success_border: 'rgba(76, 175, 80, 0.2)',
        success_glow: 'rgba(76, 175, 80, 0.6)',
        
        error: '#F44336',
        error_secondary: 'rgba(244, 67, 54, 0.9)',
        error_border: 'rgba(244, 67, 54, 0.2)',
        error_glow: 'rgba(244, 67, 54, 0.6)',
        
        warning: '#FF9800',
        warning_secondary: 'rgba(255, 152, 0, 0.9)',
        warning_border: 'rgba(255, 152, 0, 0.2)',
        warning_glow: 'rgba(255, 152, 0, 0.6)',
        
        info: '#2196F3',
        info_secondary: 'rgba(33, 150, 243, 0.9)',
        info_border: 'rgba(33, 150, 243, 0.2)',
        info_glow: 'rgba(33, 150, 243, 0.6)',
        
        connecting: '#FF9800',
        connected: '#4CAF50',
        disconnected: '#F44336',
        connection_error: '#E91E63'
    },

    // Border colors
    borders: {
        default: '#555',
        subtle: '#333',
        emphasis: '#666',
        focus: '#4af',
        selection: '#4af',
        panel: '#333',
        input: '#444',
        notification: 'rgba(255, 255, 255, 0.08)',
        notification_emphasis: 'rgba(255, 255, 255, 0.3)'
    },

    // Interactive states
    interactions: {
        hover_overlay: 'rgba(255, 255, 255, 0.2)',
        hover_emphasis: 'rgba(255, 255, 255, 0.3)',
        hover_strong: 'rgba(255, 255, 255, 0.4)',
        active_overlay: 'rgba(255, 255, 255, 0.4)',
        button_primary: '#4CAF50',
        button_primary_hover: '#45a049',
        button_secondary: '#333',
        button_secondary_hover: '#444',
        scrollbar_track: '#2a2a2a',
        scrollbar_thumb: '#444'
    },

    // Canvas and rendering colors
    canvas: {
        background_normal: '#222',
        background_gallery: '#111',
        grid_lines: '#333',
        selection_stroke: '#4af',
        selection_fill: '#4af',
        handle_fill: '#fff',
        handle_stroke: '#666',
        shadow_default: 'rgba(0, 0, 0, 0.3)',
        shadow_strong: 'rgba(0, 0, 0, 0.8)'
    },

    // LiteGraph specific colors
    litegraph: {
        background: '#2e2e2e',
        background_dark: '#000',
        text_primary: '#aaf',
        text_secondary: '#999',
        text_bright: '#eee',
        text_muted: '#aaa',
        button_bg: '#777',
        button_bg_active: '#444',
        border_light: '#666',
        border_dark: '#333',
        border_darker: '#161616',
        border_darkest: '#1a1a1a',
        panel_bg: '#2A2A2A',
        shadow: '#111'
    },

    // Collaboration user colors (from config.js)
    collaboration: [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
        '#F8B739', '#6C5CE7', '#A29BFE', '#FD79A8', '#FDCB6E'
    ]
};

/**
 * Utility functions for color access and manipulation
 */
const ColorUtils = {
    /**
     * Get a color value by category and name
     * @param {string} category - Color category (e.g., 'backgrounds', 'text')
     * @param {string} name - Color name within category
     * @returns {string} Color value or fallback
     */
    get(category, name) {
        const color = COLORS[category]?.[name];
        if (!color) {
            
            return '#ff00ff'; // Magenta as error indicator
        }
        return color;
    },

    /**
     * Get collaboration user color by index
     * @param {number} index - User index
     * @returns {string} Color value
     */
    getUserColor(index) {
        return COLORS.collaboration[index % COLORS.collaboration.length];
    },

    /**
     * Generate CSS custom properties from color configuration
     * @returns {string} CSS custom properties string
     */
    generateCSSProperties() {
        let css = ':root {\n';
        
        // Flatten the color object and create CSS custom properties
        Object.entries(COLORS).forEach(([category, colors]) => {
            if (Array.isArray(colors)) {
                // Handle collaboration colors array
                colors.forEach((color, index) => {
                    css += `  --color-${category}-${index}: ${color};\n`;
                });
            } else if (typeof colors === 'object') {
                Object.entries(colors).forEach(([name, value]) => {
                    const cssName = `--color-${category}-${name}`.replace(/_/g, '-');
                    css += `  ${cssName}: ${value};\n`;
                });
            }
        });
        
        css += '}\n';
        return css;
    },

    /**
     * Inject CSS custom properties into the document
     */
    injectCSSProperties() {
        // Check if already injected
        if (document.getElementById('color-properties')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'color-properties';
        style.textContent = this.generateCSSProperties();
        document.head.insertBefore(style, document.head.firstChild);
    },

    /**
     * Get a CSS custom property reference
     * @param {string} category - Color category
     * @param {string} name - Color name
     * @returns {string} CSS var() reference
     */
    cssVar(category, name) {
        const cssName = `--color-${category}-${name}`.replace(/_/g, '-');
        return `var(${cssName})`;
    }
};

// Auto-inject CSS properties when this module loads
if (typeof document !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ColorUtils.injectCSSProperties();
        });
    } else {
        ColorUtils.injectCSSProperties();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { COLORS, ColorUtils };
} else if (typeof window !== 'undefined') {
    window.COLORS = COLORS;
    window.ColorUtils = ColorUtils;
}