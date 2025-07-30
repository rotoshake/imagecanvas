// ===================================
// NODE CREATION MENU
// ===================================

/**
 * NodeCreationMenu - UI component for creating new nodes
 * Uses the NodePluginSystem to show available node types
 */
class NodeCreationMenu {
    constructor(canvas) {
        this.canvas = canvas;
        this.menu = null;
        this.isVisible = false;
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Right-click to show menu
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showMenu(e.clientX, e.clientY);
        });
        
        // Click outside to hide
        document.addEventListener('click', (e) => {
            if (this.isVisible && !this.menu?.contains(e.target)) {
                this.hideMenu();
            }
        });
        
        // Escape key to hide
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.hideMenu();
            }
        });
    }
    
    showMenu(x, y) {
        this.hideMenu();
        
        // Get node creation menu data
        const menuData = window.app?.nodePluginSystem?.getNodeCreationMenu();
        if (!menuData) {
            
            return;
        }
        
        // Create menu element
        this.menu = document.createElement('div');
        this.menu.className = 'node-creation-menu';
        this.menu.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            min-width: 200px;
            max-height: 400px;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        // Create menu content
        let menuHTML = '<div style="padding: 8px 0;">';
        
        for (const [category, nodes] of Object.entries(menuData)) {
            if (nodes.length === 0) continue;
            
            // Category header
            menuHTML += `
                <div style="
                    padding: 8px 16px;
                    font-weight: 600;
                    color: #666;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    border-bottom: 1px solid #eee;
                ">${category}</div>
            `;
            
            // Node options
            for (const node of nodes) {
                menuHTML += `
                    <div class="menu-item" data-type="${node.type}" style="
                        padding: 8px 16px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        transition: background-color 0.2s;
                    " onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='transparent'">
                        <span style="font-size: 16px;">${node.icon}</span>
                        <div>
                            <div style="font-weight: 500; font-size: 14px;">${node.name}</div>
                            ${node.description ? `<div style="font-size: 12px; color: #666; margin-top: 2px;">${node.description}</div>` : ''}
                        </div>
                    </div>
                `;
            }
        }
        
        menuHTML += '</div>';
        this.menu.innerHTML = menuHTML;
        
        // Add click handlers
        this.menu.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.menu-item');
            if (menuItem) {
                const nodeType = menuItem.dataset.type;
                this.createNode(nodeType, x, y);
                this.hideMenu();
            }
        });
        
        // Add to document
        document.body.appendChild(this.menu);
        this.isVisible = true;
        
        // Adjust position if menu goes off screen
        const rect = this.menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }
    
    hideMenu() {
        if (this.menu) {
            this.menu.remove();
            this.menu = null;
        }
        this.isVisible = false;
    }
    
    createNode(nodeType, screenX, screenY) {
        if (!window.app?.nodePluginSystem) {
            
            return;
        }
        
        try {
            // Convert screen coordinates to graph coordinates
            const graphPos = window.app.graphCanvas.viewport.convertCanvasToGraph(screenX, screenY);
            
            // Create node
            const node = window.app.nodePluginSystem.createNode(nodeType, {
                pos: graphPos,
                properties: {}
            });
            
            // Add to graph
            window.app.graph.add(node);
            
            // Select the new node
            window.app.graphCanvas.selection.clear();
            window.app.graphCanvas.selection.selectNode(node, true);
            
            // Trigger redraw
            window.app.graphCanvas.dirty_canvas = true;

        } catch (error) {
            
            // Show user-friendly error
            if (window.unifiedNotifications) {
                window.unifiedNotifications.error('Failed to create node', {
                    detail: error.message
                });
            }
        }
    }
    
    /**
     * Programmatically create a node (for keyboard shortcuts, etc.)
     */
    createNodeAtCenter(nodeType) {
        const canvas = window.app?.graphCanvas?.canvas;
        if (!canvas) return;
        
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        this.createNode(nodeType, centerX, centerY);
    }
}

// Make globally available
window.NodeCreationMenu = NodeCreationMenu; 