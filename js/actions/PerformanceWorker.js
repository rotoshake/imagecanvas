// js/actions/PerformanceWorker.js - Web Worker for heavy operations

// Check if we're running in a Web Worker
const isWorker = typeof importScripts !== 'undefined';

if (isWorker) {
    // Web Worker code
    console.log('🔧 Performance Worker initialized');
    
    // Import any necessary libraries for the worker
    // Note: In a real implementation, you might want to import compression libraries here
    
    // Worker message handler
    self.onmessage = function(e) {
        const { taskId, type, data } = e.data;
        
        try {
            let result;
            
            switch (type) {
                case 'compress':
                    result = compressData(data);
                    break;
                    
                case 'decompress':
                    result = decompressData(data);
                    break;
                    
                case 'calculateStateDiff':
                    result = calculateStateDiff(data.oldState, data.newState);
                    break;
                    
                case 'processImageData':
                    result = processImageData(data);
                    break;
                    
                case 'generateThumbnail':
                    result = generateThumbnail(data);
                    break;
                    
                case 'serialializeGraph':
                    result = serializeGraph(data);
                    break;
                    
                case 'deserializeGraph':
                    result = deserializeGraph(data);
                    break;
                    
                default:
                    throw new Error('Unknown task type: ' + type);
            }
            
            // Send result back to main thread
            self.postMessage({
                taskId: taskId,
                success: true,
                result: result
            });
            
        } catch (error) {
            // Send error back to main thread
            self.postMessage({
                taskId: taskId,
                success: false,
                error: error.message,
                stack: error.stack
            });
        }
    };
    
    // Worker functions
    function compressData(data) {
        // Simple compression using run-length encoding
        const jsonString = JSON.stringify(data);
        return runLengthEncode(jsonString);
    }
    
    function decompressData(compressedData) {
        const decompressed = runLengthDecode(compressedData);
        return JSON.parse(decompressed);
    }
    
    function runLengthEncode(text) {
        let encoded = '';
        let i = 0;
        
        while (i < text.length) {
            let count = 1;
            const char = text[i];
            
            while (i + count < text.length && text[i + count] === char && count < 255) {
                count++;
            }
            
            if (count > 3) {
                encoded += `~${count}${char}`;
            } else {
                encoded += char.repeat(count);
            }
            
            i += count;
        }
        
        return encoded;
    }
    
    function runLengthDecode(encoded) {
        let decoded = '';
        let i = 0;
        
        while (i < encoded.length) {
            if (encoded[i] === '~') {
                // Find the end of the count
                let countEnd = i + 1;
                while (countEnd < encoded.length && /\d/.test(encoded[countEnd])) {
                    countEnd++;
                }
                
                const count = parseInt(encoded.substring(i + 1, countEnd));
                const char = encoded[countEnd];
                decoded += char.repeat(count);
                i = countEnd + 1;
            } else {
                decoded += encoded[i];
                i++;
            }
        }
        
        return decoded;
    }
    
    function calculateStateDiff(oldState, newState) {
        const diff = {
            added: [],
            removed: [],
            modified: []
        };
        
        const oldNodes = new Map(oldState.nodes.map(n => [n.id, n]));
        const newNodes = new Map(newState.nodes.map(n => [n.id, n]));
        
        // Find added nodes
        for (const [id, node] of newNodes) {
            if (!oldNodes.has(id)) {
                diff.added.push(node);
            }
        }
        
        // Find removed nodes
        for (const [id, node] of oldNodes) {
            if (!newNodes.has(id)) {
                diff.removed.push(id);
            }
        }
        
        // Find modified nodes
        for (const [id, newNode] of newNodes) {
            const oldNode = oldNodes.get(id);
            if (oldNode && !deepEqual(oldNode, newNode)) {
                diff.modified.push({
                    id: id,
                    oldNode: oldNode,
                    newNode: newNode,
                    changes: getNodeChanges(oldNode, newNode)
                });
            }
        }
        
        return diff;
    }
    
    function getNodeChanges(oldNode, newNode) {
        const changes = {};
        
        if (oldNode.pos[0] !== newNode.pos[0] || oldNode.pos[1] !== newNode.pos[1]) {
            changes.pos = { old: oldNode.pos, new: newNode.pos };
        }
        
        if (oldNode.size[0] !== newNode.size[0] || oldNode.size[1] !== newNode.size[1]) {
            changes.size = { old: oldNode.size, new: newNode.size };
        }
        
        if (oldNode.rotation !== newNode.rotation) {
            changes.rotation = { old: oldNode.rotation, new: newNode.rotation };
        }
        
        if (oldNode.title !== newNode.title) {
            changes.title = { old: oldNode.title, new: newNode.title };
        }
        
        // Check properties
        if (!deepEqual(oldNode.properties, newNode.properties)) {
            changes.properties = { old: oldNode.properties, new: newNode.properties };
        }
        
        return changes;
    }
    
    function processImageData(data) {
        // Process image data (placeholder for actual image processing)
        // This could include resizing, format conversion, etc.
        return {
            processed: true,
            originalSize: data.size || 0,
            processedSize: Math.floor((data.size || 0) * 0.8), // Simulate compression
            metadata: {
                width: data.width || 0,
                height: data.height || 0,
                format: data.format || 'unknown'
            }
        };
    }
    
    function generateThumbnail(data) {
        // Generate thumbnail (placeholder)
        return {
            thumbnail: `data:image/svg+xml;base64,${btoa('<svg width="64" height="64"><rect width="64" height="64" fill="#ccc"/></svg>')}`,
            width: 64,
            height: 64
        };
    }
    
    function serializeGraph(graphData) {
        // Optimize graph serialization
        const optimized = {
            nodes: graphData.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: node.pos,
                size: node.size,
                title: node.title,
                properties: node.properties,
                flags: node.flags,
                aspectRatio: node.aspectRatio,
                rotation: node.rotation
            })),
            timestamp: Date.now()
        };
        
        return JSON.stringify(optimized);
    }
    
    function deserializeGraph(serializedData) {
        return JSON.parse(serializedData);
    }
    
    function deepEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== typeof b) return false;
        
        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) return false;
            return a.every((val, i) => deepEqual(val, b[i]));
        }
        
        if (typeof a === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(key => deepEqual(a[key], b[key]));
        }
        
        return false;
    }
    
} else {
    // Main thread code - Worker Manager
    class PerformanceWorkerManager {
        constructor() {
            this.workers = [];
            this.workerCount = Math.min(4, navigator.hardwareConcurrency || 2);
            this.currentWorker = 0;
            this.pendingTasks = new Map();
            this.taskCounter = 0;
            
            // Initialize workers
            this.initializeWorkers();
            
            console.log(`🔧 PerformanceWorkerManager initialized with ${this.workerCount} workers`);
        }
        
        /**
         * Initialize web workers
         */
        initializeWorkers() {
            try {
                // Create worker from current script
                const workerScript = this.getWorkerScript();
                const blob = new Blob([workerScript], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                
                for (let i = 0; i < this.workerCount; i++) {
                    const worker = new Worker(workerUrl);
                    
                    worker.onmessage = (e) => {
                        this.handleWorkerMessage(e);
                    };
                    
                    worker.onerror = (error) => {
                        console.error('Worker error:', error);
                    };
                    
                    this.workers.push({
                        worker: worker,
                        busy: false,
                        taskCount: 0
                    });
                }
                
                // Clean up the blob URL
                URL.revokeObjectURL(workerUrl);
                
            } catch (error) {
                console.warn('Failed to initialize workers:', error);
                this.workers = []; // Fallback to main thread processing
            }
        }
        
        /**
         * Get the worker script content
         */
        getWorkerScript() {
            // Return the worker code as a string
            // In a real implementation, you might load this from a separate file
            return `
                // Web Worker code (embedded version of the worker functions above)
                console.log('🔧 Performance Worker initialized');
                
                self.onmessage = function(e) {
                    const { taskId, type, data } = e.data;
                    
                    try {
                        let result;
                        
                        switch (type) {
                            case 'compress':
                                result = compressData(data);
                                break;
                            case 'decompress':
                                result = decompressData(data);
                                break;
                            case 'calculateStateDiff':
                                result = calculateStateDiff(data.oldState, data.newState);
                                break;
                            default:
                                throw new Error('Unknown task type: ' + type);
                        }
                        
                        self.postMessage({
                            taskId: taskId,
                            success: true,
                            result: result
                        });
                        
                    } catch (error) {
                        self.postMessage({
                            taskId: taskId,
                            success: false,
                            error: error.message
                        });
                    }
                };
                
                function compressData(data) {
                    const jsonString = JSON.stringify(data);
                    return runLengthEncode(jsonString);
                }
                
                function decompressData(compressedData) {
                    const decompressed = runLengthDecode(compressedData);
                    return JSON.parse(decompressed);
                }
                
                function runLengthEncode(text) {
                    let encoded = '';
                    let i = 0;
                    
                    while (i < text.length) {
                        let count = 1;
                        const char = text[i];
                        
                        while (i + count < text.length && text[i + count] === char && count < 255) {
                            count++;
                        }
                        
                        if (count > 3) {
                            encoded += '~' + count + char;
                        } else {
                            encoded += char.repeat(count);
                        }
                        
                        i += count;
                    }
                    
                    return encoded;
                }
                
                function runLengthDecode(encoded) {
                    let decoded = '';
                    let i = 0;
                    
                    while (i < encoded.length) {
                        if (encoded[i] === '~') {
                            let countEnd = i + 1;
                            while (countEnd < encoded.length && /\\d/.test(encoded[countEnd])) {
                                countEnd++;
                            }
                            
                            const count = parseInt(encoded.substring(i + 1, countEnd));
                            const char = encoded[countEnd];
                            decoded += char.repeat(count);
                            i = countEnd + 1;
                        } else {
                            decoded += encoded[i];
                            i++;
                        }
                    }
                    
                    return decoded;
                }
                
                function calculateStateDiff(oldState, newState) {
                    // Simplified diff calculation
                    return {
                        hasChanges: JSON.stringify(oldState) !== JSON.stringify(newState),
                        timestamp: Date.now()
                    };
                }
            `;
        }
        
        /**
         * Execute a task in a worker
         */
        async executeTask(type, data) {
            const taskId = ++this.taskCounter;
            
            return new Promise((resolve, reject) => {
                // Store the promise callbacks
                this.pendingTasks.set(taskId, { resolve, reject });
                
                // Get the least busy worker
                const workerInfo = this.getLeastBusyWorker();
                
                if (!workerInfo) {
                    // No workers available, execute on main thread
                    this.executeOnMainThread(type, data)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                
                // Send task to worker
                workerInfo.worker.postMessage({
                    taskId: taskId,
                    type: type,
                    data: data
                });
                
                workerInfo.busy = true;
                workerInfo.taskCount++;
            });
        }
        
        /**
         * Get the least busy worker
         */
        getLeastBusyWorker() {
            if (this.workers.length === 0) return null;
            
            // Find a free worker
            let freeWorker = this.workers.find(w => !w.busy);
            if (freeWorker) return freeWorker;
            
            // All workers are busy, return the one with least tasks
            return this.workers.reduce((least, current) => 
                current.taskCount < least.taskCount ? current : least
            );
        }
        
        /**
         * Handle worker message
         */
        handleWorkerMessage(e) {
            const { taskId, success, result, error } = e.data;
            const pendingTask = this.pendingTasks.get(taskId);
            
            if (!pendingTask) {
                console.warn('Received result for unknown task:', taskId);
                return;
            }
            
            // Remove from pending tasks
            this.pendingTasks.delete(taskId);
            
            // Find the worker and mark it as free
            const workerInfo = this.workers.find(w => w.worker === e.target);
            if (workerInfo) {
                workerInfo.busy = false;
            }
            
            // Resolve or reject the promise
            if (success) {
                pendingTask.resolve(result);
            } else {
                pendingTask.reject(new Error(error));
            }
        }
        
        /**
         * Execute task on main thread as fallback
         */
        async executeOnMainThread(type, data) {
            switch (type) {
                case 'compress':
                    return this.compressOnMainThread(data);
                case 'decompress':
                    return this.decompressOnMainThread(data);
                default:
                    throw new Error('Unsupported task type for main thread: ' + type);
            }
        }
        
        compressOnMainThread(data) {
            // Simple main thread compression
            return JSON.stringify(data);
        }
        
        decompressOnMainThread(data) {
            return JSON.parse(data);
        }
        
        /**
         * Cleanup workers
         */
        cleanup() {
            for (const workerInfo of this.workers) {
                workerInfo.worker.terminate();
            }
            this.workers = [];
            this.pendingTasks.clear();
            console.log('🔧 PerformanceWorkerManager cleaned up');
        }
        
        /**
         * Get worker statistics
         */
        getStats() {
            return {
                workerCount: this.workers.length,
                pendingTasks: this.pendingTasks.size,
                busyWorkers: this.workers.filter(w => w.busy).length,
                totalTasksProcessed: this.workers.reduce((sum, w) => sum + w.taskCount, 0)
            };
        }
    }
    
    // Make the manager globally available
    window.PerformanceWorkerManager = PerformanceWorkerManager;
}