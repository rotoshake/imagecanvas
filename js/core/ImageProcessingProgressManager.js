/**
 * ImageProcessingProgressManager - Unified progress tracking for image processing
 * Tracks loading, uploading, and thumbnail generation in a single notification
 */
class ImageProcessingProgressManager {
    constructor() {
        this.batches = new Map(); // batchId -> batch info
        this.fileToBatchMap = new Map(); // fileHash -> batchId
        this.batchTimeout = null;
        this.currentBatchId = null;
        this.updateTimeouts = new Map(); // batchId -> timeout for throttling updates
    }
    
    /**
     * Start a new batch or add to existing batch
     * @param {Array} files - Array of files being processed
     * @returns {string} batchId
     */
    startBatch(files) {
        // Clear any existing timeout
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
        }
        
        // Create new batch if needed
        if (!this.currentBatchId) {
            this.currentBatchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.batches.set(this.currentBatchId, {
                id: this.currentBatchId,
                totalFiles: 0,
                files: new Map(), // hash -> file info
                startTime: Date.now(),
                notificationId: `image-processing-${this.currentBatchId}`,
                notificationCreated: false, // Track if notification was created
                // Progress tracking
                loaded: 0,
                uploaded: 0,
                thumbnailed: 0,
                failed: 0
            });
            console.log(`🆕 Created new batch: ${this.currentBatchId}`);
        } else {
            console.log(`📦 Adding to existing batch: ${this.currentBatchId}`);
        }
        
        const batch = this.batches.get(this.currentBatchId);
        
        // Add files to batch with placeholder hashes
        files.forEach(file => {
            const hash = file.hash || this.generateFileHash(file);
            // Check if file already exists in batch to avoid duplicates
            if (!batch.files.has(hash)) {
                batch.files.set(hash, {
                    filename: file.name,
                    hash: hash,
                    size: file.size,
                    loadProgress: 0,
                    uploadProgress: 0,
                    thumbnailProgress: 0,
                    status: 'pending',
                    isPlaceholder: !file.hash // Track if this is a placeholder
                });
                this.fileToBatchMap.set(hash, this.currentBatchId);
                batch.totalFiles++;
            }
        });
        
        // Show initial notification
        this.updateBatchNotification(this.currentBatchId);
        
        // Set timeout to close batch after 2 seconds of inactivity
        this.batchTimeout = setTimeout(() => {
            console.log(`⏰ Batch timeout - closing batch: ${this.currentBatchId}`);
            this.currentBatchId = null;
            this.batchTimeout = null;
        }, 2000);
        
        return this.currentBatchId;
    }
    
    /**
     * Update loading progress
     */
    updateLoadProgress(hash, progress) {
        const batchId = this.fileToBatchMap.get(hash);
        if (!batchId) return;
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        const wasComplete = file.loadProgress >= 1;
        file.loadProgress = progress;
        
        // Update loaded count
        if (!wasComplete && progress >= 1) {
            batch.loaded++;
        }
        
        this.updateBatchNotification(batchId);
    }
    
    /**
     * Update upload progress
     */
    updateUploadProgress(hash, progress) {
        const batchId = this.fileToBatchMap.get(hash);
        if (!batchId) return;
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        const wasComplete = file.uploadProgress >= 1;
        file.uploadProgress = progress;
        
        // Update uploaded count
        if (!wasComplete && progress >= 1) {
            batch.uploaded++;
        }
        
        this.updateBatchNotification(batchId);
    }
    
    /**
     * Update thumbnail progress
     */
    updateThumbnailProgress(hash, progress) {
        const batchId = this.fileToBatchMap.get(hash);
        if (!batchId) return;
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        const wasComplete = file.thumbnailProgress >= 1;
        file.thumbnailProgress = progress;
        
        // Update thumbnailed count
        if (!wasComplete && progress >= 1) {
            batch.thumbnailed++;
        }
        
        this.updateBatchNotification(batchId);
    }
    
    /**
     * Mark a file as failed
     */
    markFailed(hash, phase) {
        const batchId = this.fileToBatchMap.get(hash);
        if (!batchId) return;
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        if (file.status !== 'failed') {
            file.status = 'failed';
            file.failedPhase = phase;
            batch.failed++;
        }
        
        this.updateBatchNotification(batchId);
    }
    
    /**
     * Update the batch notification (throttled)
     */
    updateBatchNotification(batchId) {
        const batch = this.batches.get(batchId);
        if (!batch || !window.unifiedNotifications) return;
        
        // Throttle updates to avoid creating multiple notifications
        if (this.updateTimeouts.has(batchId)) {
            clearTimeout(this.updateTimeouts.get(batchId));
        }
        
        this.updateTimeouts.set(batchId, setTimeout(() => {
            this._performBatchNotificationUpdate(batchId);
            this.updateTimeouts.delete(batchId);
        }, 50)); // 50ms throttle
    }
    
    /**
     * Perform the actual batch notification update
     */
    _performBatchNotificationUpdate(batchId) {
        const batch = this.batches.get(batchId);
        if (!batch || !window.unifiedNotifications) return;
        
        // Calculate overall progress
        let totalProgress = 0;
        let loadWeight = 0.3;    // 30% for loading
        let uploadWeight = 0.5;  // 50% for uploading
        let thumbWeight = 0.2;   // 20% for thumbnails
        
        // Calculate weighted progress
        batch.files.forEach(file => {
            const fileProgress = 
                (file.loadProgress * loadWeight) +
                (file.uploadProgress * uploadWeight) +
                (file.thumbnailProgress * thumbWeight);
            totalProgress += fileProgress;
        });
        
        const overallProgress = batch.totalFiles > 0 
            ? Math.round((totalProgress / batch.totalFiles) * 100)
            : 0;
        
        // Create detail text
        const details = [];
        if (batch.loaded < batch.totalFiles) {
            details.push(`Loading: ${batch.loaded}/${batch.totalFiles}`);
        }
        if (batch.uploaded < batch.totalFiles) {
            details.push(`Uploading: ${batch.uploaded}/${batch.totalFiles}`);
        }
        if (batch.thumbnailed < batch.totalFiles) {
            details.push(`Thumbnails: ${batch.thumbnailed}/${batch.totalFiles}`);
        }
        if (batch.failed > 0) {
            details.push(`Failed: ${batch.failed}`);
        }
        
        // Create notification once, then update it
        if (!batch.notificationCreated) {
            // Create the notification for the first time
            window.unifiedNotifications.show({
                id: batch.notificationId,
                type: batch.failed > 0 ? 'warning' : 'info',
                message: `Processing ${batch.totalFiles} images`,
                detail: details.join(' • '),
                progress: {
                    current: overallProgress,
                    total: 100,
                    showBar: true,
                    label: `${overallProgress}%`
                },
                duration: 0,
                persistent: true,
                closeable: false
            });
            batch.notificationCreated = true;
        } else {
            // Update existing notification in place
            window.unifiedNotifications.update(batch.notificationId, {
                type: batch.failed > 0 ? 'warning' : 'info',
                message: `Processing ${batch.totalFiles} images`,
                detail: details.join(' • '),
                progress: {
                    current: overallProgress,
                    total: 100,
                    showBar: true,
                    label: `${overallProgress}%`
                }
            });
        }
        
        // Check if batch is complete
        const allComplete = batch.loaded + batch.failed >= batch.totalFiles &&
                           batch.uploaded + batch.failed >= batch.totalFiles &&
                           batch.thumbnailed + batch.failed >= batch.totalFiles;
        
        if (allComplete) {
            setTimeout(() => {
                this.finalizeBatch(batchId);
            }, 500);
        }
    }
    
    /**
     * Finalize batch and show summary
     */
    finalizeBatch(batchId) {
        const batch = this.batches.get(batchId);
        if (!batch || !window.unifiedNotifications) return;
        
        // Remove progress notification
        window.unifiedNotifications.remove(batch.notificationId);
        
        // Calculate summary
        const duration = ((Date.now() - batch.startTime) / 1000).toFixed(1);
        const successful = batch.totalFiles - batch.failed;
        
        // Show summary notification
        if (batch.failed === 0) {
            window.unifiedNotifications.success(
                `${successful} images processed successfully`,
                { detail: `Completed in ${duration}s` }
            );
        } else if (successful === 0) {
            window.unifiedNotifications.error(
                `Failed to process ${batch.failed} images`
            );
        } else {
            window.unifiedNotifications.warning(
                `Processed ${successful} of ${batch.totalFiles} images`,
                { detail: `${batch.failed} failed • Completed in ${duration}s` }
            );
        }
        
        // Clean up
        batch.files.forEach((file, hash) => {
            this.fileToBatchMap.delete(hash);
        });
        this.batches.delete(batchId);
        
        // Clean up any pending update timeout
        if (this.updateTimeouts.has(batchId)) {
            clearTimeout(this.updateTimeouts.get(batchId));
            this.updateTimeouts.delete(batchId);
        }
    }
    
    /**
     * Generate a simple hash for file identification
     */
    generateFileHash(file) {
        return `${file.name}-${file.size}-${file.lastModified}`;
    }
    
    /**
     * Update file hash (replace placeholder with actual hash)
     */
    updateFileHash(filename, actualHash) {
        // Find the placeholder entry for this filename
        for (const [batchId, batch] of this.batches) {
            for (const [placeholderHash, fileInfo] of batch.files) {
                if (fileInfo.filename === filename && fileInfo.isPlaceholder) {
                    // Remove placeholder entry
                    batch.files.delete(placeholderHash);
                    this.fileToBatchMap.delete(placeholderHash);
                    
                    // Add actual hash entry
                    fileInfo.hash = actualHash;
                    fileInfo.isPlaceholder = false;
                    batch.files.set(actualHash, fileInfo);
                    this.fileToBatchMap.set(actualHash, batchId);
                    
                    console.log(`🔄 Updated hash for ${filename}: ${placeholderHash.substring(0, 8)}... → ${actualHash.substring(0, 8)}...`);
                    return;
                }
            }
        }
    }
    
    /**
     * Get batch for a file hash
     */
    getBatchForFile(hash) {
        const batchId = this.fileToBatchMap.get(hash);
        return batchId ? this.batches.get(batchId) : null;
    }
}

// Create global instance
window.imageProcessingProgress = new ImageProcessingProgressManager();