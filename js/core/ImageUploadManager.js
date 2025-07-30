/**
 * ImageUploadManager - Handles HTTP uploads of images to the server
 * Allows immediate local display while uploading in the background
 */
class ImageUploadManager {
    constructor() {
        this.uploadQueue = new Map(); // hash -> upload promise
        this.pendingUploads = []; // Queue of uploads waiting to start
        this.activeUploads = new Set(); // Currently uploading
        
        // Adaptive concurrent upload limits
        this.baseConcurrentUploads = 4;
        this.maxConcurrentUploads = 12; // Maximum for bulk operations
        this.currentConcurrentLimit = this.baseConcurrentUploads;
        
        // Performance tracking for adaptive scaling
        this.uploadStats = {
            completedUploads: 0,
            totalUploadTime: 0,
            avgUploadSpeed: 0, // bytes per second
            failureRate: 0,
            lastSpeedCheck: Date.now()
        };
        
        // Bulk operation detection
        this.bulkThreshold = 10; // Consider it bulk if more than 10 files
        this.isBulkOperation = false;
        
        // Use the configured server URL, not the current page host
        this.uploadUrl = CONFIG.SERVER.API_BASE + '/api/upload';
        
        // Bundled tracking removed - now handled by unified progress system
        
        // Monitor performance and adjust concurrency
        this.startPerformanceMonitoring();
    }

    /**
     * Upload media (image or video) data to server via HTTP
     * Returns a promise that resolves to the server URL
     */
    async uploadMedia(mediaData, filename, hash, mimeType = 'image/jpeg') {
        return this.uploadImage(mediaData, filename, hash, mimeType);
    }

    /**
     * Upload image data to server via HTTP
     * Returns a promise that resolves to the server URL
     */
    async uploadImage(imageData, filename, hash, mimeType = 'image/jpeg') {
        // Check if already uploading
        if (this.uploadQueue.has(hash)) {
            
            return this.uploadQueue.get(hash);
        }

        console.log(`📤 Queueing upload for ${filename} (hash: ${hash})`);

        // Create a promise that will be resolved when upload completes
        let resolveUpload, rejectUpload;
        const uploadPromise = new Promise((resolve, reject) => {
            resolveUpload = resolve;
            rejectUpload = reject;
        });
        
        // Store the promise immediately
        this.uploadQueue.set(hash, uploadPromise);
        
        // Add to pending queue (without storing large image data)
        this.pendingUploads.push({
            imageData, // Keep reference but will be processed immediately
            filename,
            hash,
            mimeType,
            resolve: resolveUpload,
            reject: rejectUpload,
            timestamp: Date.now() // Track for memory cleanup
        });
        
        // Process queue
        this._processUploadQueue();
        
        try {
            const result = await uploadPromise;
            this.uploadQueue.delete(hash);
            return result;
        } catch (error) {
            this.uploadQueue.delete(hash);
            throw error;
        }
    }

    async _performUpload(mediaData, filename, hash, mimeType = 'image/jpeg') {
        const isVideo = mimeType.startsWith('video/');
        console.log(`📤 Uploading ${isVideo ? 'video' : 'image'} ${filename} (${hash})`);
        
        const startTime = Date.now();
        let blob = null;
        
        try {
            // Handle both File objects and data URLs
            if (mediaData instanceof File) {
                // Direct file upload (hybrid approach)
                blob = mediaData;
                console.log(`📁 Uploading original file: ${filename} (${blob.size} bytes)`);
            } else {
                // Convert base64 to blob (legacy approach)
                blob = await this._dataURLToBlob(mediaData);
                console.log(`🔄 Uploading converted data: ${filename} (${blob.size} bytes)`);
            }
            
            // Create form data
            const formData = new FormData();
            formData.append('file', blob, filename); // Server expects 'file' field
            formData.append('hash', hash);

            // Upload with progress tracking
            const response = await this._uploadWithProgress(formData, filename, hash);

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            
            // Record successful upload performance
            const uploadTime = Date.now() - startTime;
            this._recordUploadCompletion(blob.size, uploadTime, true);
            
            window.Logger.upload('info', `✅ Upload complete for ${filename}: ${blob.size} bytes in ${uploadTime}ms`);
            
            // Notify unified progress system of completion
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateUploadProgress(hash, 1);
            }

            return {
                url: result.url,
                hash: hash,
                size: blob.size,
                filename: result.filename || filename
            };
        } catch (error) {
            // Record failed upload performance
            const uploadTime = Date.now() - startTime;
            if (blob) {
                this._recordUploadCompletion(blob.size, uploadTime, false);
            }
            
            console.error(`❌ Upload failed for ${filename}:`, error);
            
            // Notify unified progress system of failure
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.markFailed(hash, 'upload');
            }
            
            throw error;
        }
    }

    async _uploadWithProgress(formData, filename, hash) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    this._updateProgress(filename, percentComplete, hash);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        ok: true,
                        status: xhr.status,
                        statusText: xhr.statusText,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText))
                    });
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'));
            });

            xhr.addEventListener('abort', () => {
                reject(new Error('Upload aborted'));
            });

            xhr.open('POST', this.uploadUrl);
            xhr.send(formData);
        });
    }

    _updateProgress(filename, percent, hash) {
        // Report progress to unified system
        if (window.imageProcessingProgress) {
            window.imageProcessingProgress.updateUploadProgress(hash, percent / 100);
        }
    }

    async _dataURLToBlob(dataURL) {
        const response = await fetch(dataURL);
        return response.blob();
    }
    
    /**
     * Process the upload queue with adaptive concurrency limiting
     */
    _processUploadQueue() {
        // Don't process if uploads are paused
        if (this.uploadsPaused) {
            return;
        }
        
        // Update bulk operation status
        this.isBulkOperation = this.pendingUploads.length >= this.bulkThreshold;
        
        // Adjust concurrent limit based on conditions
        this._adjustConcurrentLimit();
        
        // Check if we can start more uploads
        while (this.activeUploads.size < this.currentConcurrentLimit && this.pendingUploads.length > 0) {
            const upload = this.pendingUploads.shift();
            this._startUpload(upload);
        }
    }
    
    /**
     * Start an individual upload
     */
    async _startUpload(uploadInfo) {
        const { imageData, filename, hash, mimeType, resolve, reject } = uploadInfo;
        
        // Mark as active
        this.activeUploads.add(hash);
        
        try {
            const result = await this._performUpload(imageData, filename, hash, mimeType);
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            // Remove from active and process next
            this.activeUploads.delete(hash);
            window.Logger.upload('debug', `✅ Upload slot freed. Active: ${this.activeUploads.size}`);
            
            // Clean up any references to help GC
            uploadInfo.imageData = null;
            
            this._processUploadQueue();
        }
    }

    /**
     * Check if an image is already uploaded
     */
    isUploading(hash) {
        return this.uploadQueue.has(hash);
    }

    /**
     * Get upload promise for a hash if it exists
     */
    getUploadPromise(hash) {
        return this.uploadQueue.get(hash);
    }
    
    /**
     * Adjust concurrent upload limit based on performance and conditions
     */
    _adjustConcurrentLimit() {
        if (this.isBulkOperation) {
            // For bulk operations, use higher concurrency
            const networkQuality = this._getNetworkQuality();
            
            if (networkQuality === 'excellent' && this.uploadStats.failureRate < 0.05) {
                this.currentConcurrentLimit = this.maxConcurrentUploads;
            } else if (networkQuality === 'good' && this.uploadStats.failureRate < 0.1) {
                this.currentConcurrentLimit = Math.min(8, this.maxConcurrentUploads);
            } else {
                this.currentConcurrentLimit = Math.min(6, this.maxConcurrentUploads);
            }
        } else {
            // For normal operations, use base limit
            this.currentConcurrentLimit = this.baseConcurrentUploads;
        }
        
        // Don't exceed what the browser can handle
        if (navigator.hardwareConcurrency) {
            this.currentConcurrentLimit = Math.min(
                this.currentConcurrentLimit, 
                Math.max(4, navigator.hardwareConcurrency * 2)
            );
        }
    }
    
    /**
     * Assess network quality based on upload performance
     */
    _getNetworkQuality() {
        const avgSpeed = this.uploadStats.avgUploadSpeed;
        const failureRate = this.uploadStats.failureRate;
        
        // Speed in bytes per second (rough thresholds)
        if (avgSpeed > 500000 && failureRate < 0.02) { // > 500KB/s, <2% failure
            return 'excellent';
        } else if (avgSpeed > 200000 && failureRate < 0.05) { // > 200KB/s, <5% failure
            return 'good';
        } else if (avgSpeed > 50000 && failureRate < 0.1) { // > 50KB/s, <10% failure
            return 'fair';
        } else {
            return 'poor';
        }
    }
    
    /**
     * Start performance monitoring
     */
    startPerformanceMonitoring() {
        // Monitor every 10 seconds during active uploads
        setInterval(() => {
            if (this.activeUploads.size > 0 || this.pendingUploads.length > 0) {
                this._updatePerformanceStats();
            }
        }, 10000);
    }
    
    /**
     * Update performance statistics
     */
    _updatePerformanceStats() {
        // This will be called after each upload completion
        // Stats are updated in _performUpload method
        const now = Date.now();
        const timeSinceLastCheck = now - this.uploadStats.lastSpeedCheck;
        
        // Log performance info for debugging
        if (timeSinceLastCheck > 30000) { // Every 30 seconds
            console.log(`📊 Upload Performance: ${this.uploadStats.avgUploadSpeed.toFixed(0)} bytes/s, ${(this.uploadStats.failureRate * 100).toFixed(1)}% failure rate, concurrency: ${this.currentConcurrentLimit}`);
            this.uploadStats.lastSpeedCheck = now;
        }
    }
    
    /**
     * Record upload completion for performance tracking
     */
    _recordUploadCompletion(fileSize, uploadTime, success) {
        this.uploadStats.completedUploads++;
        this.uploadStats.totalUploadTime += uploadTime;
        
        if (success) {
            // Update average upload speed (bytes per second)
            const speed = fileSize / (uploadTime / 1000);
            this.uploadStats.avgUploadSpeed = (
                (this.uploadStats.avgUploadSpeed * (this.uploadStats.completedUploads - 1) + speed) / 
                this.uploadStats.completedUploads
            );
        }
        
        // Update failure rate
        const successfulUploads = this.uploadStats.completedUploads - (this.uploadStats.failureRate * this.uploadStats.completedUploads);
        const totalFailures = this.uploadStats.completedUploads - successfulUploads + (success ? 0 : 1);
        this.uploadStats.failureRate = totalFailures / this.uploadStats.completedUploads;
    }
    
    // ==========================================
    // BULK OPERATION CONTROLS
    // ==========================================
    
    /**
     * Cancel all pending uploads
     */
    cancelAllUploads() {
        
        // Clear pending queue
        const cancelledCount = this.pendingUploads.length;
        this.pendingUploads.forEach(upload => {
            upload.reject(new Error('Upload cancelled by user'));
        });
        this.pendingUploads = [];
        
        // Cancel active uploads (note: XMLHttpRequest cancellation will be handled in _uploadWithProgress)
        this.activeUploads.forEach(hash => {
            const uploadPromise = this.uploadQueue.get(hash);
            if (uploadPromise) {
                // The actual cancellation will be handled by the XMLHttpRequest abort in _uploadWithProgress
                
            }
        });
        
        // Clear upload queue
        this.uploadQueue.clear();

        // Reset bulk operation flag
        this.isBulkOperation = false;
        this.currentConcurrentLimit = this.baseConcurrentUploads;
        
        return { cancelled: cancelledCount, active: this.activeUploads.size };
    }
    
    /**
     * Pause upload processing (stops starting new uploads)
     */
    pauseUploads() {
        this.uploadsPaused = true;
        
        return {
            paused: true,
            pending: this.pendingUploads.length,
            active: this.activeUploads.size
        };
    }
    
    /**
     * Resume upload processing
     */
    resumeUploads() {
        this.uploadsPaused = false;
        
        // Restart queue processing
        this._processUploadQueue();
        
        return {
            resumed: true,
            pending: this.pendingUploads.length,
            active: this.activeUploads.size
        };
    }
    
    /**
     * Get current upload status
     */
    getUploadStatus() {
        return {
            pending: this.pendingUploads.length,
            active: this.activeUploads.size,
            completed: this.uploadStats.completedUploads,
            paused: this.uploadsPaused || false,
            isBulkOperation: this.isBulkOperation,
            currentConcurrentLimit: this.currentConcurrentLimit,
            performance: {
                avgSpeed: this.uploadStats.avgUploadSpeed,
                failureRate: this.uploadStats.failureRate,
                networkQuality: this._getNetworkQuality()
            }
        };
    }
    
    /**
     * Retry failed uploads (if tracking is implemented)
     */
    retryFailedUploads() {
        // This would require tracking failed uploads, which could be implemented
        // by storing failed upload info instead of just rejecting promises
        
        return { message: 'Retry functionality requires implementation of failed upload tracking' };
    }
    
    // Legacy bundle methods removed - now handled by unified progress system
}

// Create global instance
window.imageUploadManager = new ImageUploadManager();