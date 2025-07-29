// ===================================
// PERFORMANCE MONITOR
// Real-time frame rate and performance tracking
// ===================================

class PerformanceMonitor {
    constructor() {
        this.enabled = true;
        this.showHUD = false; // Can be toggled for debugging
        
        // Frame timing
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.fps = 0;
        this.frameTimeHistory = [];
        this.maxHistorySize = 60; // Last 60 frames
        
        // Performance metrics
        this.metrics = {
            avgFrameTime: 0,
            maxFrameTime: 0,
            droppedFrames: 0,
            renderTime: 0,
            cullTime: 0,
            drawTime: 0
        };
        
        // Adaptive quality
        this.qualityLevel = 'high'; // high, medium, low
        this.consecutiveBadFrames = 0;
        this.qualityThresholds = {
            high: { target: 16.67, tolerance: 3 }, // 60fps with 3 bad frames tolerance
            medium: { target: 33.33, tolerance: 5 }, // 30fps with 5 bad frames tolerance
            low: { target: 50, tolerance: 10 } // 20fps with 10 bad frames tolerance
        };
        
        // Update interval
        this.updateInterval = 500; // Update stats every 500ms
        this.lastUpdate = performance.now();
        
        console.log('📊 PerformanceMonitor initialized');
    }
    
    /**
     * Start frame measurement
     */
    startFrame() {
        if (!this.enabled) return;
        this.frameStartTime = performance.now();
    }
    
    /**
     * End frame measurement and update metrics
     */
    endFrame() {
        if (!this.enabled) return;
        
        const now = performance.now();
        const frameTime = now - this.lastFrameTime;
        this.lastFrameTime = now;
        
        // Track frame time
        this.frameTimeHistory.push(frameTime);
        if (this.frameTimeHistory.length > this.maxHistorySize) {
            this.frameTimeHistory.shift();
        }
        
        // Update metrics
        this.frameCount++;
        
        // Check for dropped frames (> 16.67ms for 60fps)
        if (frameTime > 16.67) {
            this.metrics.droppedFrames++;
        }
        
        // Update adaptive quality
        this.updateQualityLevel(frameTime);
        
        // Periodic metric updates
        if (now - this.lastUpdate > this.updateInterval) {
            this.updateMetrics();
            this.lastUpdate = now;
        }
    }
    
    /**
     * Mark a specific operation's timing
     */
    mark(operation, duration) {
        if (!this.enabled) return;
        this.metrics[operation + 'Time'] = duration;
    }
    
    /**
     * Update computed metrics
     */
    updateMetrics() {
        if (this.frameTimeHistory.length === 0) return;
        
        // Calculate average frame time
        const sum = this.frameTimeHistory.reduce((a, b) => a + b, 0);
        this.metrics.avgFrameTime = sum / this.frameTimeHistory.length;
        
        // Calculate max frame time
        this.metrics.maxFrameTime = Math.max(...this.frameTimeHistory);
        
        // Calculate FPS
        this.fps = Math.round(1000 / this.metrics.avgFrameTime);
        
        // Log if performance is poor
        // if (this.fps < 30) {
        //     console.warn(`⚠️ Low FPS detected: ${this.fps}fps (avg frame time: ${this.metrics.avgFrameTime.toFixed(1)}ms)`);
        // }
    }
    
    /**
     * Update quality level based on performance
     */
    updateQualityLevel(frameTime) {
        const currentThreshold = this.qualityThresholds[this.qualityLevel];
        
        if (frameTime > currentThreshold.target) {
            this.consecutiveBadFrames++;
            
            if (this.consecutiveBadFrames > currentThreshold.tolerance) {
                // Downgrade quality
                if (this.qualityLevel === 'high') {
                    this.qualityLevel = 'medium';
                    // console.log('📉 Reducing quality to medium for better performance');
                } else if (this.qualityLevel === 'medium') {
                    this.qualityLevel = 'low';
                    // console.log('📉 Reducing quality to low for better performance');
                }
                this.consecutiveBadFrames = 0;
            }
        } else {
            // Good frame, slowly recover
            if (this.consecutiveBadFrames > 0) {
                this.consecutiveBadFrames--;
            }
            
            // Try to upgrade quality after sustained good performance
            if (this.consecutiveBadFrames === 0 && this.frameCount % 120 === 0) {
                if (this.qualityLevel === 'low' && this.metrics.avgFrameTime < 20) {
                    this.qualityLevel = 'medium';
                    // console.log('📈 Increasing quality to medium');
                } else if (this.qualityLevel === 'medium' && this.metrics.avgFrameTime < 12) {
                    this.qualityLevel = 'high';
                    // console.log('📈 Increasing quality to high');
                }
            }
        }
    }
    
    /**
     * Get current quality settings
     */
    getQualitySettings() {
        switch (this.qualityLevel) {
            case 'low':
                return {
                    thumbnailOnly: true,
                    maxRenderDistance: 1, // Only render visible nodes
                    disableAnimations: true,
                    disableShadows: true
                };
            case 'medium':
                return {
                    thumbnailOnly: false,
                    maxRenderDistance: 1.5, // Render slightly beyond viewport
                    disableAnimations: false,
                    disableShadows: true
                };
            case 'high':
            default:
                return {
                    thumbnailOnly: false,
                    maxRenderDistance: 2, // Render well beyond viewport
                    disableAnimations: false,
                    disableShadows: false
                };
        }
    }
    
    /**
     * Get performance stats
     */
    getStats() {
        return {
            fps: this.fps,
            avgFrameTime: this.metrics.avgFrameTime.toFixed(1),
            maxFrameTime: this.metrics.maxFrameTime.toFixed(1),
            droppedFrames: this.metrics.droppedFrames,
            qualityLevel: this.qualityLevel,
            frameCount: this.frameCount
        };
    }
    
    /**
     * Reset all metrics
     */
    reset() {
        this.frameCount = 0;
        this.frameTimeHistory = [];
        this.metrics.droppedFrames = 0;
        this.consecutiveBadFrames = 0;
        this.qualityLevel = 'high';
    }
    
    /**
     * Draw performance HUD (for debugging)
     */
    drawHUD(ctx) {
        if (!this.showHUD || !this.enabled) return;
        
        const stats = this.getStats();
        const x = 10;
        let y = 70; // Start below other HUD elements
        
        ctx.save();
        ctx.font = '12px monospace';
        ctx.fillStyle = this.fps < 30 ? '#ff4444' : this.fps < 50 ? '#ffaa44' : '#44ff44';
        
        ctx.fillText(`FPS: ${stats.fps}`, x, y);
        y += 15;
        ctx.fillText(`Frame: ${stats.avgFrameTime}ms (max: ${stats.maxFrameTime}ms)`, x, y);
        y += 15;
        ctx.fillText(`Dropped: ${stats.droppedFrames}`, x, y);
        y += 15;
        ctx.fillText(`Quality: ${stats.qualityLevel}`, x, y);
        
        ctx.restore();
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.PerformanceMonitor = PerformanceMonitor;
}