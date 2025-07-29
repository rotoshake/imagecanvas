class Canvas2DRenderer {
    /**
     * @param {LGraphCanvas} canvasInstance Reference to owning canvas.
     */
    constructor(canvasInstance) {
        this.canvas = canvasInstance;
    }

    /**
     * Attempt to draw the node. Return true if fully handled, false otherwise
     * so the caller can fall back to default logic.
     * @param {CanvasRenderingContext2D} ctx 
     * @param {*} node 
     * @returns {boolean} handled
     */
    drawNode(ctx, node) {
        // For now, we don't do any special handling – just let default canvas path run.
        // Future WebGL or optimised branches can intercept specific node types here.
        return false;
    }
}

// Expose globally for non-module environments
if (typeof window !== 'undefined') {
    window.Canvas2DRenderer = Canvas2DRenderer;
} 