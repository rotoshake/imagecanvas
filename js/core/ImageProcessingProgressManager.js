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
        this.stuckCheckTimeouts = new Map(); // batchId -> timeout for checking stuck files
        this.STUCK_TIMEOUT = 30000; // 30 seconds before considering a file stuck
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
                // File type tracking
                imageCount: 0,
                videoCount: 0,
                // Progress tracking
                analyzed: 0,      // NEW: track dimension analysis
                loaded: 0,
                uploaded: 0,
                thumbnailed: 0,
                failed: 0
            });
            
        } else {
            
        }
        
        const batch = this.batches.get(this.currentBatchId);
        
        // Add files to batch with placeholder hashes
        files.forEach(file => {
            const hash = file.hash || this.generateFileHash(file);
            // Check if file already exists in batch to avoid duplicates
            if (!batch.files.has(hash)) {
                // Determine file type
                const isVideo = file.type?.startsWith('video/') || file.type === 'image/gif';
                const fileType = isVideo ? 'video' : 'image';
                
                batch.files.set(hash, {
                    filename: file.name,
                    hash: hash,
                    size: file.size,
                    type: fileType,
                    analysisProgress: 0,   // NEW: dimension analysis progress
                    loadProgress: 0,
                    uploadProgress: 0,
                    thumbnailProgress: 0,
                    status: 'pending',
                    isPlaceholder: !file.hash // Track if this is a placeholder
                });
                this.fileToBatchMap.set(hash, this.currentBatchId);
                batch.totalFiles++;
                
                // Update type counters
                if (fileType === 'video') {
                    batch.videoCount++;
                } else {
                    batch.imageCount++;
                }
            }
        });
        
        // Show initial notification
        this.updateBatchNotification(this.currentBatchId);
        
        // Set timeout to close batch after 2 seconds of inactivity
        this.batchTimeout = setTimeout(() => {
            
            this.currentBatchId = null;
            this.batchTimeout = null;
        }, 2000);
        
        // Start stuck file checker for this batch
        this.startStuckChecker(this.currentBatchId);
        
        return this.currentBatchId;
    }
    
    /**
     * Register a file hash after it has been calculated
     */
    registerFileHash(batchId, filename, hash) {
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        // Find the file by name and update its hash
        for (const [fileKey, fileData] of batch.files) {
            if (fileData.filename === filename && !fileData.hash) {
                // Update the file's hash
                fileData.hash = hash;
                // Move the file entry to use hash as the key
                batch.files.delete(fileKey);
                batch.files.set(hash, fileData);
                // Update the mapping
                this.fileToBatchMap.set(hash, batchId);
                console.log(`📝 Registered hash ${hash.substring(0, 8)}... for file ${filename}`);
                break;
            }
        }
    }
    
    /**
     * Update analysis progress (dimension reading)
     */
    updateAnalysisProgress(hash, progress) {
        const batchId = this.fileToBatchMap.get(hash);
        if (!batchId) return;
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        const wasComplete = file.analysisProgress >= 1;
        file.analysisProgress = progress;
        
        // Update analyzed count
        if (!wasComplete && progress >= 1) {
            batch.analyzed++;
        }
        
        this.updateBatchNotification(batchId);
    }
    
    /**
     * Update loading progress
     */
    updateLoadProgress(hash, progress) {
        const batchId = this.fileToBatchMap.get(hash);
        if (!batchId) {
            // This is normal for background loading after batch completion
            // Only warn if this seems like it should be tracked
            if (progress < 1) {
                console.log(`📡 Background loading started for ${hash.substring(0, 8)}... (no active batch)`);
            }
            return;
        }
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) {
            console.warn(`⚠️ updateLoadProgress: No file found for hash ${hash.substring(0, 8)}... in batch ${batchId}`);
            return;
        }
        
        const wasComplete = file.loadProgress >= 1;
        file.loadProgress = progress;
        file.lastLoadUpdate = Date.now();
        
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
        if (!batchId) {
            // Normal for background uploads after batch completion
            return;
        }
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        const wasComplete = file.uploadProgress >= 1;
        file.uploadProgress = progress;
        file.lastUploadUpdate = Date.now();
        
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
        if (!batchId) {
            // Normal for background thumbnail generation after batch completion
            return;
        }
        
        const batch = this.batches.get(batchId);
        if (!batch) return;
        
        const file = batch.files.get(hash);
        if (!file) return;
        
        // Skip thumbnail progress tracking for bulk operations (>20 files) to prevent stuck files
        if (batch.totalFiles > 20) {
            // Immediately mark as complete for bulk operations
            if (file.thumbnailProgress < 1) {
                file.thumbnailProgress = 1;
                batch.thumbnailed++;
                this.updateBatchNotification(batchId);
            }
            return;
        }
        
        const wasComplete = file.thumbnailProgress >= 1;
        file.thumbnailProgress = progress;
        file.lastThumbnailUpdate = Date.now();
        
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
     * Generate appropriate message based on file types in batch
     */
    _getBatchMessage(batch) {
        // Determine current stage for more descriptive message
        let action = 'Processing';
        if (batch.analyzed < batch.totalFiles) {
            action = 'Analyzing';
        } else if (batch.loaded < batch.totalFiles) {
            action = 'Loading';
        } else if (batch.uploaded < batch.totalFiles) {
            action = 'Uploading';
        } else if (batch.thumbnailed < batch.totalFiles) {
            action = 'Generating thumbnails for';
        }
        
        if (batch.imageCount > 0 && batch.videoCount > 0) {
            // Mixed files
            return `${action} ${batch.totalFiles} files`;
        } else if (batch.videoCount > 0) {
            // Only videos
            return batch.videoCount === 1 ? `${action} 1 video` : `${action} ${batch.videoCount} videos`;
        } else {
            // Only images (default)
            return batch.imageCount === 1 ? `${action} 1 image` : `${action} ${batch.imageCount} images`;
        }
    }

    /**
     * Perform the actual batch notification update
     */
    _performBatchNotificationUpdate(batchId) {
        const batch = this.batches.get(batchId);
        if (!batch || !window.unifiedNotifications) return;
        
        // Calculate overall progress with new stage weights
        let totalProgress = 0;
        let analysisWeight = 0.15;  // 15% for analyzing dimensions
        let loadWeight = 0.25;      // 25% for loading (reduced from 30%)
        let uploadWeight = 0.45;    // 45% for uploading (reduced from 50%)
        let thumbWeight = 0.15;     // 15% for thumbnails (reduced from 20%)
        
        // Calculate weighted progress including analysis stage
        batch.files.forEach(file => {
            const fileProgress = 
                (file.analysisProgress * analysisWeight) +
                (file.loadProgress * loadWeight) +
                (file.uploadProgress * uploadWeight) +
                (file.thumbnailProgress * thumbWeight);
            totalProgress += fileProgress;
        });
        
        const overallProgress = batch.totalFiles > 0 
            ? Math.round((totalProgress / batch.totalFiles) * 100)
            : 0;
        
        // Create detail text with stage indicators
        const details = [];
        
        // Determine current primary stage based on progress
        let currentStage = 'analyzing';
        if (batch.analyzed >= batch.totalFiles) currentStage = 'loading';
        if (batch.loaded >= batch.totalFiles) currentStage = 'uploading';
        if (batch.uploaded >= batch.totalFiles) currentStage = 'thumbnails';
        
        // Build detail text with current stage emphasis
        if (batch.analyzed < batch.totalFiles) {
            const icon = currentStage === 'analyzing' ? '▶' : '✓';
            details.push(`${icon} Analyzing: ${batch.analyzed}/${batch.totalFiles}`);
        }
        if (batch.loaded < batch.totalFiles) {
            const icon = currentStage === 'loading' ? '▶' : (batch.loaded === batch.totalFiles ? '✓' : '○');
            details.push(`${icon} Loading: ${batch.loaded}/${batch.totalFiles}`);
        }
        if (batch.uploaded < batch.totalFiles) {
            const icon = currentStage === 'uploading' ? '▶' : (batch.uploaded === batch.totalFiles ? '✓' : '○');
            details.push(`${icon} Uploading: ${batch.uploaded}/${batch.totalFiles}`);
        }
        if (batch.thumbnailed < batch.totalFiles) {
            const icon = currentStage === 'thumbnails' ? '▶' : (batch.thumbnailed === batch.totalFiles ? '✓' : '○');
            details.push(`${icon} Thumbnails: ${batch.thumbnailed}/${batch.totalFiles}`);
        }
        if (batch.failed > 0) {
            details.push(`⚠️ Failed: ${batch.failed}`);
        }
        
        // Create notification once, then update it
        if (!batch.notificationCreated) {
            // Create the notification for the first time
            window.unifiedNotifications.show({
                id: batch.notificationId,
                type: batch.failed > 0 ? 'warning' : 'info',
                message: this._getBatchMessage(batch),
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
                message: this._getBatchMessage(batch),
                detail: details.join(' • '),
                progress: {
                    current: overallProgress,
                    total: 100,
                    showBar: true,
                    label: `${overallProgress}%`
                }
            });
        }
        
        // Check if batch is complete (including analysis stage)
        // For bulk operations, skip thumbnail completion requirement
        const isBulkOperation = batch.totalFiles > 20;
        const thumbnailComplete = isBulkOperation || (batch.thumbnailed + batch.failed >= batch.totalFiles);
        
        const allComplete = batch.analyzed + batch.failed >= batch.totalFiles &&
                           batch.loaded + batch.failed >= batch.totalFiles &&
                           batch.uploaded + batch.failed >= batch.totalFiles &&
                           thumbnailComplete;
        
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
        
        // Clean up stuck checker
        if (this.stuckCheckTimeouts.has(batchId)) {
            clearTimeout(this.stuckCheckTimeouts.get(batchId));
            this.stuckCheckTimeouts.delete(batchId);
        }
    }
    
    /**
     * Generate a simple hash for file identification
     */
    generateFileHash(file) {
        return `${file.name}-${file.size}-${file.lastModified}`;
    }
    
    /**
     * Update file hash (DEPRECATED - no longer needed with real hashes)
     */
    updateFileHash(placeholderHash, actualHash) {
        
        console.warn(`   Old: ${placeholderHash?.substring(0, 20)}...`);
        console.warn(`   New: ${actualHash?.substring(0, 8)}...`);
        // This method is now deprecated since we use real hashes from the start
    }
    
    /**
     * Get batch for a file hash
     */
    getBatchForFile(hash) {
        const batchId = this.fileToBatchMap.get(hash);
        return batchId ? this.batches.get(batchId) : null;
    }
    
    /**
     * Start checking for stuck files in a batch
     */
    startStuckChecker(batchId) {
        // Clear any existing checker
        if (this.stuckCheckTimeouts.has(batchId)) {
            clearTimeout(this.stuckCheckTimeouts.get(batchId));
        }
        
        // Set up periodic check
        const checkStuck = () => {
            const batch = this.batches.get(batchId);
            if (!batch) {
                // Batch was cleaned up
                this.stuckCheckTimeouts.delete(batchId);
                return;
            }
            
            // Force batch completion if it's been running too long (2 minutes)
            const batchAge = Date.now() - batch.startTime;
            if (batchAge > 120000) { // 2 minutes
                console.warn(`⏰ Force completing batch ${batchId} after ${Math.round(batchAge/1000)}s`);
                
                // Mark all incomplete files as completed to force batch finalization
                batch.files.forEach((file, hash) => {
                    if (file.analysisProgress < 1) {
                        this.updateAnalysisProgress(hash, 1);
                    }
                    if (file.loadProgress < 1) {
                        this.updateLoadProgress(hash, 1);
                    }
                    if (file.uploadProgress < 1) {
                        this.updateUploadProgress(hash, 1);
                    }
                    if (file.thumbnailProgress < 1) {
                        this.updateThumbnailProgress(hash, 1);
                    }
                });
                
                // Force finalization
                setTimeout(() => this.finalizeBatch(batchId), 100);
                this.stuckCheckTimeouts.delete(batchId);
                return;
            }
            
            const now = Date.now();
            let hasStuckFiles = false;
            
            // Check each file for being stuck
            batch.files.forEach((file, hash) => {
                // Skip failed files
                if (file.status === 'failed') return;
                
                // Skip files with temp hashes - they're in transition
                if (hash.startsWith('temp-')) {
                    return;
                }
                
                // For bulk operations, don't check thumbnail progress since it's disabled
                const isBulkOperation = batch.totalFiles > 20;
                const hasIncompletePhases = (
                    (file.analysisProgress < 1) ||
                    (file.loadProgress < 1) ||
                    (file.uploadProgress < 1) ||
                    (!isBulkOperation && file.thumbnailProgress < 1) // Skip thumbnail check for bulk
                );
                
                if (hasIncompletePhases) {
                    // Use file start time or batch start time
                    const fileStartTime = file.startTime || batch.startTime;
                    
                    if (now - fileStartTime > this.STUCK_TIMEOUT) {
                        console.warn(`⚠️ File ${file.filename} appears to be stuck (${hash.substring(0, 8)}...)`);
                        console.warn(`  Progress - Analysis: ${Math.round(file.analysisProgress * 100)}%, Load: ${Math.round(file.loadProgress * 100)}%, Upload: ${Math.round(file.uploadProgress * 100)}%, Thumbnail: ${Math.round(file.thumbnailProgress * 100)}%`);
                        console.warn(`  Is placeholder: ${file.isPlaceholder}, Hash: ${file.hash?.substring(0, 8) || 'none'}`);
                        
                        // Mark as failed due to timeout
                        this.markFailed(hash, 'timeout');
                        hasStuckFiles = true;
                    }
                }
            });
            
            // Force update if we marked any files as failed
            if (hasStuckFiles) {
                this.updateBatchNotification(batchId);
            }
            
            // Schedule next check
            this.stuckCheckTimeouts.set(batchId, setTimeout(checkStuck, 5000));
        };
        
        // Start checking after initial delay
        this.stuckCheckTimeouts.set(batchId, setTimeout(checkStuck, 10000));
    }
}

// Create global instance
window.imageProcessingProgress = new ImageProcessingProgressManager();