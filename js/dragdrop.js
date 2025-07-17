// ===================================
// DRAG AND DROP SYSTEM
// ===================================

class DragDropManager {
    constructor(canvas, graph) {
        this.canvas = canvas;
        this.graph = graph;
        this.acceptedTypes = new Set([
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp',
            'video/mp4', 'video/webm', 'video/ogg',
            'image/gif' // Treat GIF as video
        ]);
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Prevent default behavior for all drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.canvas.addEventListener(eventName, this.preventDefaults.bind(this), false);
        });
        
        // Add specific handlers
        this.canvas.addEventListener('dragenter', this.onDragEnter.bind(this));
        this.canvas.addEventListener('dragover', this.onDragOver.bind(this));
        this.canvas.addEventListener('dragleave', this.onDragLeave.bind(this));
        this.canvas.addEventListener('drop', this.onDrop.bind(this));
    }
    
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    onDragEnter(e) {
        this.preventDefaults(e);
        
        // Check if we have valid files
        if (this.hasValidFiles(e.dataTransfer)) {
            this.showDropIndicator();
        }
    }
    
    onDragOver(e) {
        this.preventDefaults(e);
        
        // Set the drop effect
        if (this.hasValidFiles(e.dataTransfer)) {
            e.dataTransfer.dropEffect = 'copy';
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    }
    
    onDragLeave(e) {
        this.preventDefaults(e);
        
        // Only hide indicator if we're leaving the canvas entirely
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            this.hideDropIndicator();
        }
    }
    
    async onDrop(e) {
        this.preventDefaults(e);
        this.hideDropIndicator();
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        
        // Filter valid files
        const validFiles = files.filter(file => this.isValidFile(file));
        if (validFiles.length === 0) {
            this.showErrorMessage('No supported files found. Supported formats: Images (JPG, PNG, WebP, BMP) and Videos (MP4, WebM, OGG, GIF)');
            return;
        }
        
        // Get drop position
        const dropPos = this.getDropPosition(e);
        
        try {
            await this.processFiles(validFiles, dropPos);
        } catch (error) {
            console.error('Failed to process dropped files:', error);
            this.showErrorMessage('Failed to process some files');
        }
    }
    
    hasValidFiles(dataTransfer) {
        if (!dataTransfer.types) return false;
        
        // Check if we have files
        return dataTransfer.types.includes('Files');
    }
    
    isValidFile(file) {
        return this.acceptedTypes.has(file.type);
    }
    
    getDropPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasPos = [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
        
        // Convert to graph coordinates
        return this.graph.canvas.viewport.convertOffsetToGraph(...canvasPos);
    }
    
    async processFiles(files, dropPos) {
        const newNodes = [];
        const cascadeOffset = 40; // Offset for multiple files
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            try {
                const node = await this.createNodeFromFile(file, dropPos, i * cascadeOffset);
                if (node) {
                    this.graph.add(node);
                    newNodes.push(node);
                }
            } catch (error) {
                console.error('Failed to create node from file:', file.name, error);
            }
        }
        
        // Select all new nodes
        if (newNodes.length > 0) {
            this.selectNewNodes(newNodes);
            
            // Save state and add to undo stack
            if (this.graph.canvas.stateManager) {
                this.graph.canvas.stateManager.pushUndoState(this.graph, this.graph.canvas);
            }
        }
        
        this.showSuccessMessage(`Added ${newNodes.length} of ${files.length} files`);
    }
    
    async createNodeFromFile(file, basePos, offset) {
        // Determine node type
        const isVideo = file.type.startsWith('video/') || file.type === 'image/gif';
        const nodeType = isVideo ? 'media/video' : 'media/image';
        
        // Create node
        const node = NodeFactory.createNode(nodeType);
        if (!node) {
            throw new Error(`Failed to create ${nodeType} node`);
        }
        
        // Set position with cascade offset
        node.pos = [
            basePos[0] - node.size[0] / 2 + offset,
            basePos[1] - node.size[1] / 2 + offset
        ];
        
        // Process file
        const dataURL = await this.fileToDataURL(file);
        const hash = await HashUtils.hashImageData(dataURL);
        
        // Cache the media
        window.imageCache.set(hash, dataURL);
        
        // Set node properties
        node.properties.hash = hash;
        node.properties.filename = file.name;
        
        // Load the media
        if (isVideo) {
            await node.setVideo(dataURL, file.name, hash);
        } else {
            await node.setImage(dataURL, file.name, hash);
        }
        
        return node;
    }
    
    fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }
    
    selectNewNodes(nodes) {
        if (this.graph.canvas.selection) {
            this.graph.canvas.selection.clear();
            nodes.forEach(node => this.graph.canvas.selection.selectNode(node, true));
        }
        
        if (this.graph.canvas) {
            this.graph.canvas.dirty_canvas = true;
        }
    }
    
    showDropIndicator() {
        // Add visual drop indicator
        this.canvas.classList.add('drop-active');
        
        // Create overlay if it doesn't exist
        if (!this.dropOverlay) {
            this.createDropOverlay();
        }
        
        this.dropOverlay.style.display = 'block';
    }
    
    hideDropIndicator() {
        this.canvas.classList.remove('drop-active');
        
        if (this.dropOverlay) {
            this.dropOverlay.style.display = 'none';
        }
    }
    
    createDropOverlay() {
        this.dropOverlay = document.createElement('div');
        this.dropOverlay.className = 'drop-overlay';
        this.dropOverlay.innerHTML = `
            <div class="drop-indicator">
                <div class="drop-icon">📁</div>
                <div class="drop-text">Drop images or videos here</div>
                <div class="drop-subtext">Supported: JPG, PNG, WebP, BMP, MP4, WebM, GIF</div>
            </div>
        `;
        
        // Style the overlay
        Object.assign(this.dropOverlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'none',
            zIndex: '1000',
            pointerEvents: 'none'
        });
        
        // Style the indicator
        const indicator = this.dropOverlay.querySelector('.drop-indicator');
        Object.assign(indicator.style, {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: 'white',
            fontSize: '18px',
            fontFamily: 'Arial, sans-serif'
        });
        
        const icon = this.dropOverlay.querySelector('.drop-icon');
        Object.assign(icon.style, {
            fontSize: '48px',
            marginBottom: '16px'
        });
        
        const subtext = this.dropOverlay.querySelector('.drop-subtext');
        Object.assign(subtext.style, {
            fontSize: '14px',
            opacity: '0.8',
            marginTop: '8px'
        });
        
        // Add to canvas container
        const canvasContainer = this.canvas.parentElement || document.body;
        canvasContainer.style.position = 'relative';
        canvasContainer.appendChild(this.dropOverlay);
    }
    
    showErrorMessage(message) {
        this.showMessage(message, 'error');
    }
    
    showSuccessMessage(message) {
        this.showMessage(message, 'success');
    }
    
    showMessage(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `drag-drop-notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '6px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            zIndex: '10000',
            opacity: '0',
            transform: 'translateY(-20px)',
            transition: 'all 0.3s ease',
            maxWidth: '300px',
            wordWrap: 'break-word'
        });
        
        // Set background color based on type
        switch (type) {
            case 'error':
                notification.style.backgroundColor = '#ff6b6b';
                break;
            case 'success':
                notification.style.backgroundColor = '#51cf66';
                break;
            default:
                notification.style.backgroundColor = '#339af0';
        }
        
        document.body.appendChild(notification);
        
        // Animate in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });
        
        // Remove after delay
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
    
    // Utility methods
    getFileInfo(file) {
        return {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            isValid: this.isValidFile(file),
            category: this.getFileCategory(file)
        };
    }
    
    getFileCategory(file) {
        if (file.type.startsWith('image/') && file.type !== 'image/gif') {
            return 'image';
        } else if (file.type.startsWith('video/') || file.type === 'image/gif') {
            return 'video';
        }
        return 'unknown';
    }
    
    // Validation
    validateFileSize(file, maxSizeMB = 100) {
        const maxBytes = maxSizeMB * 1024 * 1024;
        return file.size <= maxBytes;
    }
    
    // Cleanup
    cleanup() {
        if (this.dropOverlay && this.dropOverlay.parentNode) {
            this.dropOverlay.parentNode.removeChild(this.dropOverlay);
        }
        
        // Remove event listeners
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.canvas.removeEventListener(eventName, this.preventDefaults);
        });
    }
    
    // Debug information
    getDebugInfo() {
        return {
            acceptedTypes: Array.from(this.acceptedTypes),
            hasDropOverlay: !!this.dropOverlay,
            canvasHasDropClass: this.canvas.classList.contains('drop-active')
        };
    }
}