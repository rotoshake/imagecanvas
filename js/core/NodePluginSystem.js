// ===================================
// NODE PLUGIN SYSTEM
// ===================================

/**
 * NodePluginSystem - Manages registration and instantiation of node types
 * Allows adding new node types without modifying core code
 */
class NodePluginSystem {
    constructor() {
        this.registeredNodes = new Map();
        this.nodeFactories = new Map();
        this.nodeValidators = new Map();
        this.nodeRenderers = new Map();
        this.nodeCommands = new Map();
        
        // Built-in node types
        this.registerBuiltinNodes();

    }
    
    /**
     * Register a new node type
     */
    registerNodeType(typeName, config) {
        const {
            factory,           // Function to create node instance
            validator,         // Function to validate node data
            renderer,          // Optional custom renderer
            commands,          // Array of command types this node supports
            properties = {},   // Default properties
            category = 'other' // Node category for UI
        } = config;
        
        if (!factory || typeof factory !== 'function') {
            throw new Error(`Invalid factory for node type: ${typeName}`);
        }
        
        this.registeredNodes.set(typeName, {
            typeName,
            factory,
            validator: validator || this.defaultValidator,
            renderer,
            commands: commands || [],
            properties,
            category
        });
        
        // Register factory
        this.nodeFactories.set(typeName, factory);
        
        // Register validator
        this.nodeValidators.set(typeName, validator || this.defaultValidator);
        
        // Register renderer if provided
        if (renderer) {
            this.nodeRenderers.set(typeName, renderer);
        }
        
        // Register commands
        if (commands && Array.isArray(commands)) {
            commands.forEach(cmdType => {
                if (!this.nodeCommands.has(cmdType)) {
                    this.nodeCommands.set(cmdType, new Set());
                }
                this.nodeCommands.get(cmdType).add(typeName);
            });
        }
        
        console.log(`✅ Registered node type: ${typeName} (category: ${category})`);
    }
    
    /**
     * Create a node instance
     */
    createNode(typeName, properties = {}) {
        const nodeConfig = this.registeredNodes.get(typeName);
        if (!nodeConfig) {
            throw new Error(`Unknown node type: ${typeName}`);
        }
        
        // Merge default properties with provided properties
        const finalProperties = { ...nodeConfig.properties, ...properties };
        
        // Create node instance
        const node = nodeConfig.factory(finalProperties);
        
        // Set type metadata
        node.type = typeName;
        node.category = nodeConfig.category;
        
        // Validate the created node
        if (!nodeConfig.validator(node)) {
            throw new Error(`Invalid node created for type: ${typeName}`);
        }
        
        return node;
    }
    
    /**
     * Get all registered node types
     */
    getRegisteredTypes() {
        return Array.from(this.registeredNodes.keys());
    }
    
    /**
     * Get node types by category
     */
    getNodeTypesByCategory(category) {
        const types = [];
        for (const [typeName, config] of this.registeredNodes) {
            if (config.category === category) {
                types.push(typeName);
            }
        }
        return types;
    }
    
    /**
     * Get node types that support a specific command
     */
    getNodeTypesForCommand(commandType) {
        return Array.from(this.nodeCommands.get(commandType) || []);
    }
    
    /**
     * Get custom renderer for node type
     */
    getRenderer(typeName) {
        return this.nodeRenderers.get(typeName);
    }
    
    /**
     * Validate node data
     */
    validateNode(node) {
        const config = this.registeredNodes.get(node.type);
        if (!config) {
            return false;
        }
        return config.validator(node);
    }
    
    /**
     * Default validator
     */
    defaultValidator(node) {
        return node && 
               typeof node === 'object' && 
               node.type && 
               node.pos && 
               node.size;
    }
    
    /**
     * Register built-in node types
     */
    registerBuiltinNodes() {
        // Image nodes
        this.registerNodeType('media/image', {
            factory: (properties) => {
                const node = new ImageNode();
                if (properties) {
                    Object.assign(node.properties, properties);
                }
                return node;
            },
            validator: (node) => {
                return node instanceof ImageNode;
            },
            commands: ['node_move', 'node_resize', 'node_delete', 'node_duplicate', 'node_property_update'],
            properties: {
                brightness: 0,
                contrast: 0,
                saturation: 0,
                hue: 0
            },
            category: 'media'
        });
        
        // Video nodes
        this.registerNodeType('media/video', {
            factory: (properties) => {
                const node = new VideoNode();
                if (properties) {
                    Object.assign(node.properties, properties);
                }
                return node;
            },
            validator: (node) => {
                return node instanceof VideoNode;
            },
            commands: ['node_move', 'node_resize', 'node_delete', 'node_duplicate', 'node_property_update', 'video_toggle'],
            properties: {
                playing: false,
                loop: true,
                muted: true
            },
            category: 'media'
        });
        
        // Text nodes
        this.registerNodeType('text', {
            factory: (properties) => {
                const node = new TextNode();
                if (properties) {
                    Object.assign(node.properties, properties);
                }
                return node;
            },
            validator: (node) => {
                return node instanceof TextNode;
            },
            commands: ['node_move', 'node_resize', 'node_delete', 'node_duplicate', 'node_property_update'],
            properties: {
                text: 'New Text',
                fontSize: 16,
                fontFamily: 'Arial',
                color: '#000000',
                backgroundColor: 'transparent',
                padding: 8
            },
            category: 'text'
        });

    }
    
    /**
     * Register a custom node type (for external plugins)
     */
    registerCustomNode(typeName, config) {
        // Validate custom node configuration
        if (!config.factory || typeof config.factory !== 'function') {
            throw new Error(`Custom node ${typeName} must provide a factory function`);
        }
        
        // Ensure custom nodes extend BaseNode
        const testNode = config.factory({});
        if (!(testNode instanceof BaseNode)) {
            throw new Error(`Custom node ${typeName} must extend BaseNode`);
        }
        
        this.registerNodeType(typeName, config);
        
    }
    
    /**
     * Get node creation menu data
     */
    getNodeCreationMenu() {
        const menu = {};
        
        for (const [typeName, config] of this.registeredNodes) {
            if (!menu[config.category]) {
                menu[config.category] = [];
            }
            menu[config.category].push({
                type: typeName,
                name: config.properties.name || typeName.split('/').pop(),
                description: config.properties.description || '',
                icon: config.properties.icon || '📄'
            });
        }
        
        return menu;
    }
    
    /**
     * Create node from serialized data
     */
    createNodeFromData(nodeData) {
        const { type, properties = {} } = nodeData;
        
        if (!type) {
            throw new Error('Node data must include type');
        }
        
        const node = this.createNode(type, properties);
        
        // Set additional properties from serialized data
        if (nodeData.pos) node.pos = nodeData.pos;
        if (nodeData.size) node.size = nodeData.size;
        if (nodeData.id) node.id = nodeData.id;
        if (nodeData.properties) {
            Object.assign(node.properties, nodeData.properties);
        }
        
        return node;
    }
}

// Make globally available
window.NodePluginSystem = NodePluginSystem; 