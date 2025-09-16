// GBFS Loader Module
// Handles loading and parsing GBFS discovery files and their associated feeds

class GBFSLoader {
    constructor() {
        this.baseUrl = '';
        this.gbfsData = null;
        this.loadedFeeds = {};
        this.systemInfo = null;
        this.localFiles = {}; // Store local files by name
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 500; // 500ms = 2 requests per second
    }

    // Rate-limited fetch function
    async rateLimitedFetch(url) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ url, resolve, reject });
            this.processQueue();
        });
    }

    // Process the request queue with rate limiting
    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const { url, resolve, reject } = this.requestQueue.shift();

            // Calculate time to wait based on last request
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            const waitTime = Math.max(0, this.minRequestInterval - timeSinceLastRequest);

            if (waitTime > 0) {
                console.log(`Rate limiting: waiting ${waitTime}ms before next request`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            try {
                this.lastRequestTime = Date.now();
                const response = await fetch(url, {
                    headers: {
                        'Et-Client-Name': 'entur-gbfs-visualizer'
                    }
                });
                resolve(response);
            } catch (error) {
                reject(error);
            }
        }

        this.isProcessingQueue = false;
    }

    // Parse base URL from file path or URL
    getBaseUrl(path) {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            const url = new URL(path);
            return path.substring(0, path.lastIndexOf('/') + 1);
        }
        // For local files, mark as local
        return 'LOCAL_FILE';
    }

    // Load GBFS discovery file
    async loadGBFS(data, sourcePath = '') {
        try {
            // Parse if string
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            // Validate GBFS structure
            if (!data.data || !data.data.feeds) {
                throw new Error('Invalid GBFS discovery file format');
            }

            this.gbfsData = data;
            this.baseUrl = this.getBaseUrl(sourcePath);

            // Clear previous data
            this.loadedFeeds = {};
            this.systemInfo = null;

            // Return list of available feeds
            return {
                version: data.version,
                lastUpdated: data.last_updated,
                feeds: data.data.feeds.map(feed => ({
                    name: feed.name,
                    url: feed.url,
                    loaded: false
                }))
            };
        } catch (error) {
            console.error('Error loading GBFS discovery file:', error);
            throw error;
        }
    }

    // Load a specific feed
    async loadFeed(feedName) {
        if (!this.gbfsData) {
            throw new Error('No GBFS discovery file loaded');
        }

        const feed = this.gbfsData.data.feeds.find(f => f.name === feedName);
        if (!feed) {
            throw new Error(`Feed "${feedName}" not found in GBFS discovery file`);
        }

        try {
            let feedData;

            // Check if this is a local file setup
            if (this.baseUrl === 'LOCAL_FILE') {
                // Look for the feed in local files
                const fileName = feed.url;
                if (this.localFiles[fileName]) {
                    feedData = this.localFiles[fileName];
                } else {
                    // Try to find by feed name
                    const feedFileName = `${feedName}.json`;
                    if (this.localFiles[feedFileName]) {
                        feedData = this.localFiles[feedFileName];
                    } else {
                        throw new Error(`Local file not found: ${feedName}. Please select the ${feed.url} file.`);
                    }
                }
            } else {
                // Remote URL loading with rate limiting
                let feedUrl = feed.url;
                if (!feedUrl.startsWith('http://') && !feedUrl.startsWith('https://')) {
                    feedUrl = this.baseUrl + feed.url;
                }

                // Use rate-limited fetch
                const response = await this.rateLimitedFetch(feedUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${feedName}: ${response.statusText}`);
                }

                feedData = await response.json();
            }

            // Store the loaded feed
            this.loadedFeeds[feedName] = feedData;

            // Special handling for system_information
            if (feedName === 'system_information' && feedData.data) {
                this.systemInfo = feedData.data;
            }

            return feedData;
        } catch (error) {
            console.error(`Error loading feed ${feedName}:`, error);
            throw error;
        }
    }

    // Load multiple feeds
    async loadFeeds(feedNames) {
        const results = {};
        const errors = [];

        for (const feedName of feedNames) {
            try {
                results[feedName] = await this.loadFeed(feedName);
            } catch (error) {
                errors.push({ feed: feedName, error: error.message });
            }
        }

        return { results, errors };
    }

    // Get loaded feed data
    getFeed(feedName) {
        return this.loadedFeeds[feedName] || null;
    }

    // Get system information
    getSystemInfo() {
        return this.systemInfo;
    }

    // Check if a feed is available
    hasFeed(feedName) {
        return this.gbfsData &&
               this.gbfsData.data.feeds.some(f => f.name === feedName);
    }

    // Get all available feed names
    getAvailableFeeds() {
        if (!this.gbfsData) return [];
        return this.gbfsData.data.feeds.map(f => f.name);
    }

    // Load from local file path (for default data)
    async loadFromPath(path) {
        try {
            let response;
            if (path.startsWith('http://') || path.startsWith('https://')) {
                // Use rate-limited fetch for remote URLs
                response = await this.rateLimitedFetch(path);
            } else {
                // Direct fetch for local files
                response = await fetch(path, {
                    headers: {
                        'Et-Client-Name': 'entur-gbfs-visualizer'
                    }
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
            }
            const data = await response.json();
            return await this.loadGBFS(data, path);
        } catch (error) {
            console.error('Error loading GBFS from path:', error);
            throw error;
        }
    }

    // Load from multiple local files
    async loadFromFiles(files) {
        try {
            // Clear previous local files
            this.localFiles = {};

            // Find the gbfs.json file
            let gbfsFile = null;
            for (const file of files) {
                if (file.name === 'gbfs.json' || file.name.includes('gbfs')) {
                    gbfsFile = file;
                    break;
                }
            }

            if (!gbfsFile) {
                throw new Error('No gbfs.json file found in selection. Please include the main discovery file.');
            }

            // Load all files into memory
            const filePromises = Array.from(files).map(file => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const data = JSON.parse(e.target.result);
                            this.localFiles[file.name] = data;
                            resolve({ name: file.name, data });
                        } catch (error) {
                            reject(new Error(`Failed to parse ${file.name}: ${error.message}`));
                        }
                    };
                    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
                    reader.readAsText(file);
                });
            });

            const loadedFiles = await Promise.all(filePromises);
            console.log(`Loaded ${loadedFiles.length} local files:`, loadedFiles.map(f => f.name));

            // Load the GBFS discovery file
            const gbfsData = this.localFiles[gbfsFile.name];
            return await this.loadGBFS(gbfsData, gbfsFile.name);

        } catch (error) {
            console.error('Error loading GBFS from files:', error);
            throw error;
        }
    }
}

// Export for use in other modules
window.GBFSLoader = GBFSLoader;