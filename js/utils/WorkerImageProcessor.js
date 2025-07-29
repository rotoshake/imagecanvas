/**
 * WorkerImageProcessor - Main thread interface for the Image Preview Worker
 * Manages Web Worker for heavy image processing operations
 */
class WorkerImageProcessor {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.requestId = 0;
        this.isAvailable = false;
        
        this.init();
    }
    
    async init() {
        try {
            // Check if Web Workers are supported
            if (typeof Worker === 'undefined') {
                console.warn('Web Workers not supported, falling back to main thread processing');
                return;
            }
            
            // Create the worker
            this.worker = new Worker('/js/workers/image-preview-worker.js');
            
            // Set up message handler
            this.worker.onmessage = (e) => {
                this.handleWorkerMessage(e.data);
            };
            
            // Set up error handler
            this.worker.onerror = (error) => {
                console.error('Image Preview Worker Error:', error);
                this.isAvailable = false;
            };
            
            this.isAvailable = true;
            console.log('📊 Image Preview Worker initialized successfully');
            
        } catch (error) {
            console.warn('Failed to initialize Image Preview Worker:', error);
            this.isAvailable = false;
        }
    }
    
    handleWorkerMessage(message) {
        const { id, type, result, error, progress, completed, total } = message;
        const request = this.pendingRequests.get(id);
        
        if (!request) {
            console.warn('Received message for unknown request ID:', id);
            return;
        }
        
        switch (type) {
            case 'success':
                request.resolve(result);
                this.pendingRequests.delete(id);
                break;
                
            case 'error':
                request.reject(new Error(error));
                this.pendingRequests.delete(id);
                break;
                
            case 'progress':
                if (request.onProgress) {
                    request.onProgress(progress, completed, total);
                }
                break;
        }
    }
    
    /**
     * Process a single image file
     * @param {File} file - The image file
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Processing result
     */
    async processImage(file, options = {}) {
        if (!this.isAvailable) {
            throw new Error('Worker not available');
        }
        
        // Convert file to ArrayBuffer
        const fileBuffer = await file.arrayBuffer();
        
        return this.sendRequest('processImage', {
            fileBuffer,
            fileName: file.name,
            mimeType: file.type,
            options
        });
    }
    
    /**
     * Get dimensions only (faster than full processing)
     * @param {File} file - The image file
     * @returns {Promise<Object>} Dimensions result
     */
    async getDimensionsOnly(file) {
        if (!this.isAvailable) {
            throw new Error('Worker not available');
        }
        
        // For dimensions only, we can read just the beginning of the file
        const headerSize = Math.min(65536, file.size); // Read first 64KB max
        const fileBuffer = await file.slice(0, headerSize).arrayBuffer();
        
        return this.sendRequest('getDimensionsOnly', {
            fileBuffer,
            fileName: file.name,
            mimeType: file.type
        });
    }
    
    /**
     * Process multiple images in batch
     * @param {Array<File>} files - Array of image files
     * @param {Object} options - Processing options
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Array>} Array of processing results
     */
    async processBatch(files, options = {}, onProgress = null) {
        if (!this.isAvailable) {
            throw new Error('Worker not available');
        }
        
        // Convert all files to ArrayBuffers
        const items = await Promise.all(
            files.map(async (file) => ({
                fileBuffer: await file.arrayBuffer(),
                fileName: file.name,
                mimeType: file.type
            }))
        );
        
        return this.sendRequest('processBatch', {
            items,
            options
        }, onProgress);
    }
    
    /**
     * Send a request to the worker
     * @param {string} command - Command to execute
     * @param {Object} data - Data to send
     * @param {Function} onProgress - Progress callback
     * @returns {Promise} Promise that resolves with the result
     */
    sendRequest(command, data, onProgress = null) {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            
            this.pendingRequests.set(id, {
                resolve,
                reject,
                onProgress
            });
            
            // Send message to worker
            this.worker.postMessage({
                id,
                command,
                data
            });
            
            // Set up timeout (30 seconds for heavy operations)
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Worker request ${id} timed out`));
                }
            }, 30000);
        });
    }
    
    /**
     * Check if worker processing is available
     */
    isWorkerAvailable() {
        return this.isAvailable;
    }
    
    /**
     * Terminate the worker and clean up
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        
        // Reject all pending requests
        for (const [id, request] of this.pendingRequests) {
            request.reject(new Error('Worker terminated'));
        }
        this.pendingRequests.clear();
        
        this.isAvailable = false;
        console.log('📊 Image Preview Worker terminated');
    }
    
    /**
     * Get worker statistics
     */
    getStats() {
        return {
            isAvailable: this.isAvailable,
            pendingRequests: this.pendingRequests.size
        };
    }
}

// Create singleton instance
window.workerImageProcessor = new WorkerImageProcessor();