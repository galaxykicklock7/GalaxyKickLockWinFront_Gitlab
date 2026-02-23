const fs = require('fs');
const path = require('path');

// Path to memory file
const MEMORY_FILE = path.join(__dirname, '../../founder-memory.json');

// PERFORMANCE FIX: In-memory cache to avoid disk I/O on every call
let memoryCache = null;
let cacheLoaded = false;

/**
 * Load founder memory from file (with caching)
 * @returns {Object} - { planetName: founderId }
 */
function loadFounderMemory() {
    // Return cached version if already loaded
    if (cacheLoaded && memoryCache !== null) {
        return memoryCache;
    }
    
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const data = fs.readFileSync(MEMORY_FILE, 'utf8');
            memoryCache = JSON.parse(data);
            cacheLoaded = true;
            return memoryCache;
        }
    } catch (error) {
        console.error('[FounderMemory] Error loading:', error.message);
    }
    
    memoryCache = {};
    cacheLoaded = true;
    return memoryCache;
}

/**
 * Save founder memory to file (async to avoid blocking)
 * @param {Object} memory - { planetName: founderId }
 */
function saveFounderMemory(memory) {
    try {
        // Update cache immediately
        memoryCache = memory;
        
        // Write to disk asynchronously (non-blocking)
        fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8', (error) => {
            if (error) {
                console.error('[FounderMemory] Error saving:', error.message);
            } else {
                console.log('[FounderMemory] Saved to file');
            }
        });
    } catch (error) {
        console.error('[FounderMemory] Error saving:', error.message);
    }
}

/**
 * Get founder ID for a planet (uses cache)
 * @param {string} planetName - Planet name
 * @returns {string|null} - Founder ID or null
 */
function getFounderId(planetName) {
    if (!planetName) return null;
    const memory = loadFounderMemory(); // Now uses cache
    return memory[planetName] || null;
}

/**
 * Set founder ID for a planet (updates cache + saves async)
 * @param {string} planetName - Planet name
 * @param {string} founderId - Founder user ID
 */
function setFounderId(planetName, founderId) {
    if (!planetName || !founderId) return;
    const memory = loadFounderMemory(); // Uses cache
    memory[planetName] = founderId;
    saveFounderMemory(memory); // Async write
    console.log(`[FounderMemory] Stored ${planetName} → ${founderId}`);
}

/**
 * Clear all founder memory (clears cache + deletes file)
 */
function clearFounderMemory() {
    try {
        // Clear cache immediately
        memoryCache = {};
        cacheLoaded = true;
        
        // Delete file asynchronously
        if (fs.existsSync(MEMORY_FILE)) {
            fs.unlink(MEMORY_FILE, (error) => {
                if (error) {
                    console.error('[FounderMemory] Error clearing:', error.message);
                } else {
                    console.log('[FounderMemory] Cleared all memory');
                }
            });
        }
    } catch (error) {
        console.error('[FounderMemory] Error clearing:', error.message);
    }
}

module.exports = {
    getFounderId,
    setFounderId,
    clearFounderMemory
};
