/**
 * MemoryManager - Tracks and manages memory usage for loaded images
 * Implements graceful degradation to prevent browser crashes
 */
class MemoryManager {
    constructor() {
        // Memory limits and thresholds - more generous for modern systems
        this.memoryLimit = 4 * 1024 * 1024 * 1024; // 4GB default (modern browsers can handle much more)
        this.warningThreshold = 0.85; // 85% - start degrading distant images
        this.criticalThreshold = 0.92; // 92% - more aggressive degradation
        this.emergencyThreshold = 0.96; // 96% - show notification
        
        // Memory tracking
        this.totalMemory = 0;
        this.nodeMemoryMap = new Map(); // nodeId -> estimated memory usage
        
        // Cleanup management
        this.lastCleanup = 0;
        this.cleanupInterval = 300000; // 5 minutes - much less frequent cleanup to avoid stutters
        this.notificationShown = false;
        this.cleanupScheduled = false; // Track if cleanup is already scheduled
        
        // Performance tracking
        this.lastCheck = Date.now();
        
        // Disable aggressive unloading for bulk operations
        this.bulkOperationInProgress = false;

    }
    
    /**
     * Register an image and track its memory usage
     */
    registerImage(nodeId, img) {
        if (!img) return;
        
        const memory = this.calculateImageMemory(img);
        const previousMemory = this.nodeMemoryMap.get(nodeId) || 0;
        
        this.nodeMemoryMap.set(nodeId, memory);
        this.totalMemory = this.totalMemory - previousMemory + memory;
        
        // Check memory status
        this.checkMemoryUsage();
    }
    
    /**
     * Unregister an image and free its tracked memory
     */
    unregisterImage(nodeId) {
        const memory = this.nodeMemoryMap.get(nodeId);
        if (memory) {
            this.totalMemory -= memory;
            this.nodeMemoryMap.delete(nodeId);
        }
    }
    
    /**
     * Calculate estimated memory usage for an image
     * Formula: width * height * 4 bytes (RGBA) * 1.5 (overhead)
     */
    calculateImageMemory(img) {
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        // 4 bytes per pixel (RGBA) + 50% overhead for browser internals
        return Math.round(width * height * 4 * 1.5);
    }
    
    /**
     * Get current memory usage as percentage
     */
    getMemoryUsagePercent() {
        return (this.totalMemory / this.memoryLimit) * 100;
    }
    
    /**
     * Get memory usage stats for display
     */
    getMemoryStats() {
        const usage = this.totalMemory;
        const percent = Math.round(this.getMemoryUsagePercent());
        
        // Format memory size
        const formatBytes = (bytes) => {
            if (bytes < 1024) return bytes + 'B';
            if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
            return Math.round(bytes / (1024 * 1024)) + 'MB';
        };
        
        return {
            used: usage,
            limit: this.memoryLimit,
            percent: percent,
            formatted: `${formatBytes(usage)} (${percent}%)`,
            color: this.getMemoryColor(percent)
        };
    }
    
    /**
     * Get color based on memory usage
     */
    getMemoryColor(percent) {
        if (percent >= 95) return '#f44336'; // Red
        if (percent >= 75) return '#ff9800'; // Yellow/Orange
        return '#4caf50'; // Green
    }
    
    /**
     * Check memory usage and log/notify as needed
     */
    checkMemoryUsage() {
        const usage = this.totalMemory / this.memoryLimit;
        const percentage = Math.round(usage * 100);
        
        if (usage > this.emergencyThreshold && !this.notificationShown) {
            // Single notification at 95%
            if (window.unifiedNotifications) {
                window.unifiedNotifications.warning('High memory usage', {
                    duration: 5000
                });
            }
            this.notificationShown = true;
            
        } else if (usage > this.criticalThreshold) {
            
        } else if (usage > this.warningThreshold) {
            
        } else if (usage < 0.7 && this.notificationShown) {
            // Reset notification flag when memory recovers
            this.notificationShown = false;
        }
    }
    
    /**
     * Get the current memory management strategy
     */
    getMemoryStrategy() {
        const usage = this.totalMemory / this.memoryLimit;
        
        if (usage > this.emergencyThreshold) return 'emergency';
        if (usage > this.criticalThreshold) return 'critical';
        if (usage > this.warningThreshold) return 'warning';
        return 'normal';
    }
    
    /**
     * Check if cleanup is needed
     */
    shouldCleanup() {
        // Don't cleanup during bulk operations
        if (this.bulkOperationInProgress || window.app?.bulkOperationInProgress) {
            return false;
        }
        
        const now = Date.now();
        const timeSinceLastCleanup = now - this.lastCleanup;
        const usage = this.totalMemory / this.memoryLimit;
        
        // Cleanup if:
        // 1. Regular interval passed and we're over warning threshold
        // 2. We're in critical/emergency state
        return (timeSinceLastCleanup > this.cleanupInterval && usage > this.warningThreshold) ||
               usage > this.criticalThreshold;
    }
    
    /**
     * Get nodes that should be degraded based on distance from viewport
     */
    getUnloadCandidates(visibleNodes, allNodes, viewport) {
        const strategy = this.getMemoryStrategy();
        const candidates = [];
        
        if (strategy === 'normal') return candidates;
        
        // Create a set of visible node IDs for fast lookup
        const visibleIds = new Set(visibleNodes.map(n => n.id));
        
        // Determine distance threshold based on strategy
        let distanceMultiplier;
        switch (strategy) {
            case 'emergency':
                distanceMultiplier = 1; // Only visible nodes keep full res
                break;
            case 'critical':
                distanceMultiplier = 2; // 2x viewport distance
                break;
            case 'warning':
                distanceMultiplier = 3; // 3x viewport distance
                break;
            default:
                return candidates;
        }
        
        // Find nodes outside the threshold
        for (const node of allNodes) {
            // Skip if not an image node or not loaded
            if (node.type !== 'media/image' || !node.img) continue;
            
            // Skip if in visible set
            if (visibleIds.has(node.id)) continue;
            
            // Check if node is far enough to degrade
            const margin = CONFIG.PERFORMANCE.VISIBILITY_MARGIN * distanceMultiplier;
            if (!viewport.isNodeVisible(node, margin)) {
                candidates.push({
                    node: node,
                    strategy: strategy === 'emergency' ? 'minimal' : 'thumbnail-only'
                });
            }
        }
        
        // Sort by distance from viewport center (furthest first)
        if (viewport) {
            const centerX = -viewport.offset[0] + (viewport.canvas.width / 2) / viewport.scale;
            const centerY = -viewport.offset[1] + (viewport.canvas.height / 2) / viewport.scale;
            
            candidates.sort((a, b) => {
                const distA = Math.hypot(a.node.pos[0] - centerX, a.node.pos[1] - centerY);
                const distB = Math.hypot(b.node.pos[0] - centerX, b.node.pos[1] - centerY);
                return distB - distA; // Furthest first
            });
        }
        
        return candidates;
    }
    
    /**
     * Perform memory cleanup
     */
    performCleanup(visibleNodes, allNodes, viewport) {
        // Prevent multiple cleanups from being scheduled
        if (this.cleanupScheduled) return;
        this.cleanupScheduled = true;
        
        // Use requestIdleCallback to perform cleanup during idle time
        const performCleanupWork = (deadline) => {
            // console.log(`🧹 Starting memory cleanup (${Math.round(this.getMemoryUsagePercent())}% used)`);
            
            const candidates = this.getUnloadCandidates(visibleNodes, allNodes, viewport);
            let freedMemory = 0;
            let degradedCount = 0;
            const startTime = performance.now();
            
            for (const { node, strategy } of candidates) {
                // Check if we have time remaining in this idle period
                if (deadline && deadline.timeRemaining() < 2) {
                    // Out of time, schedule continuation
                    if (candidates.indexOf({ node, strategy }) < candidates.length - 1) {
                        requestIdleCallback(() => performCleanupWork(deadline), { timeout: 1000 });
                        return;
                    }
                }
                
                if (node.degradeQuality) {
                    const memoryBefore = this.nodeMemoryMap.get(node.id) || 0;
                    node.degradeQuality(strategy);
                    
                    // Re-calculate memory after degradation
                    if (!node.img) {
                        // Image was fully unloaded
                        this.unregisterImage(node.id);
                        freedMemory += memoryBefore;
                        degradedCount++;
                    }
                }
                
                // Stop if we've freed enough memory
                if (this.getMemoryUsagePercent() < 70) break;
            }
            
            this.lastCleanup = Date.now();
            this.cleanupScheduled = false;
            
            const elapsed = performance.now() - startTime;
            if (degradedCount > 0) {
                console.log(`✅ Degraded ${degradedCount} images, freed ${Math.round(freedMemory / (1024 * 1024))}MB in ${elapsed.toFixed(1)}ms`);
            }
        };
        
        // Schedule cleanup for next idle period
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(performCleanupWork, { timeout: 2000 });
        } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(() => performCleanupWork({ timeRemaining: () => 16 }), 100);
        }
    }
    
    /**
     * Clear all tracked memory (for cleanup)
     */
    clear() {
        this.totalMemory = 0;
        this.nodeMemoryMap.clear();
        this.notificationShown = false;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.MemoryManager = MemoryManager;
}