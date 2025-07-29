// ===================================
// SHAPE NODE PLUGIN EXAMPLE
// ===================================

/**
 * ShapeNode - Example plugin node demonstrating the plugin system
 * Shows how to create custom node types without modifying core code
 */
class ShapeNode extends BaseNode {
    constructor() {
        super();
        
        this.type = 'shape';
        this.category = 'shapes';
        
        // Default properties
        this.properties = {
            shapeType: 'rectangle', // rectangle, circle, triangle
            fillColor: '#ff6b6b',
            strokeColor: '#333333',
            strokeWidth: 2,
            opacity: 1.0
        };
        
        // Default size
        this.size = [100, 100];
        
        // Initialize
        this.init();
    }
    
    init() {
        // Set up any initialization logic
        this.flags = {
            ...this.flags,
            selectable: true,
            resizable: true,
            rotatable: true
        };
    }
    
    /**
     * Draw the shape node
     */
    onDraw(ctx) {
        const { shapeType, fillColor, strokeColor, strokeWidth, opacity } = this.properties;
        
        // Set opacity
        ctx.globalAlpha = opacity;
        
        // Set stroke
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        
        // Set fill
        ctx.fillStyle = fillColor;
        
        // Draw based on shape type
        switch (shapeType) {
            case 'circle':
                this.drawCircle(ctx);
                break;
            case 'triangle':
                this.drawTriangle(ctx);
                break;
            case 'rectangle':
            default:
                this.drawRectangle(ctx);
                break;
        }
        
        // Reset opacity
        ctx.globalAlpha = 1.0;
    }
    
    drawRectangle(ctx) {
        const [x, y] = this.pos;
        const [width, height] = this.size;
        
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
    }
    
    drawCircle(ctx) {
        const [x, y] = this.pos;
        const [width, height] = this.size;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radius = Math.min(width, height) / 2;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    }
    
    drawTriangle(ctx) {
        const [x, y] = this.pos;
        const [width, height] = this.size;
        
        ctx.beginPath();
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x, y + height);
        ctx.lineTo(x + width, y + height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    
    /**
     * Get properties for the properties inspector
     */
    getProperties() {
        return {
            shapeType: {
                type: 'select',
                label: 'Shape Type',
                options: [
                    { value: 'rectangle', label: 'Rectangle' },
                    { value: 'circle', label: 'Circle' },
                    { value: 'triangle', label: 'Triangle' }
                ],
                value: this.properties.shapeType
            },
            fillColor: {
                type: 'color',
                label: 'Fill Color',
                value: this.properties.fillColor
            },
            strokeColor: {
                type: 'color',
                label: 'Stroke Color',
                value: this.properties.strokeColor
            },
            strokeWidth: {
                type: 'range',
                label: 'Stroke Width',
                min: 0,
                max: 10,
                step: 1,
                value: this.properties.strokeWidth
            },
            opacity: {
                type: 'range',
                label: 'Opacity',
                min: 0,
                max: 1,
                step: 0.1,
                value: this.properties.opacity
            }
        };
    }
    
    /**
     * Update properties from inspector
     */
    updateProperties(newProperties) {
        Object.assign(this.properties, newProperties);
        
        // Trigger redraw
        if (this.graph?.canvas) {
            this.graph.canvas.dirty_canvas = true;
        }
    }
}

// Register the plugin with the NodePluginSystem
if (window.app?.nodePluginSystem) {
    window.app.nodePluginSystem.registerCustomNode('shape', {
        factory: (properties) => {
            const node = new ShapeNode();
            if (properties) {
                Object.assign(node.properties, properties);
            }
            return node;
        },
        validator: (node) => node instanceof ShapeNode,
        commands: ['node_move', 'node_resize', 'node_delete', 'node_duplicate', 'node_property_update'],
        properties: {
            name: 'Shape',
            description: 'A customizable shape node',
            icon: '🔷'
        },
        category: 'shapes'
    });
}

// Make globally available
window.ShapeNode = ShapeNode; 