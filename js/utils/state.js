// State management utilities
const StateManager = {
    STATE_KEY: 'litegraph_state',
    
    saveState: function(graph, canvas) {
        const state = {
            nodes: graph.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: node.pos,
                size: node.size,
                properties: node.properties,
                title: node.title
            })),
            offset: canvas.offset,
            scale: canvas.scale
        };
        
        try {
            localStorage.setItem(this.STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save state:', e);
        }
    },
    
    loadState: function(graph, canvas, LiteGraph) {
        const saved = localStorage.getItem(this.STATE_KEY);
        if (!saved) return;
        
        try {
            const state = JSON.parse(saved);
            
            // Restore canvas state
            if (state.offset) canvas.offset = state.offset;
            if (state.scale) canvas.scale = state.scale;
            
            // Restore nodes
            state.nodes.forEach(nodeData => {
                const node = LiteGraph.createNode(nodeData.type);
                if (node) {
                    node.id = nodeData.id;
                    node.pos = nodeData.pos;
                    node.size = nodeData.size;
                    node.properties = nodeData.properties;
                    node.title = nodeData.title;
                    
                    // Restore image if it's an image node
                    if (nodeData.type === "media/image" && nodeData.properties.src) {
                        node.setImage(nodeData.properties.src, nodeData.properties.filename);
                    }
                    
                    graph.add(node);
                }
            });
            
            graph.last_node_id = Math.max(...state.nodes.map(n => n.id), 0);
            
        } catch (e) {
            console.error('Failed to load state:', e);
        }
    }
};