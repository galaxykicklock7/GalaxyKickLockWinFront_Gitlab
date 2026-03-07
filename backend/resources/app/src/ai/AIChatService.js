/**
 * AI Chat Service - Mistral AI Integration
 * Handles intelligent chat responses for bot interactions
 * Features: 
 * - Human-like message queuing (process one by one with delays)
 * - Empty message filtering
 * - Conversation memory per user
 * - Rate limiting to avoid Galaxy bans
 * - Strategy protection (don't reveal bot strategies)
 */

const https = require('https');

class AIChatService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.apiUrl = 'api.mistral.ai';
        this.model = 'mistral-small-latest'; // Free tier model
        this.maxTokens = 100; // Allow up to ~75 words for natural responses
        this.conversationHistory = new Map(); // userId -> conversation history
        this.maxHistoryLength = 10; // Keep last 10 messages per user (better memory)
        
        // ✅ HUMAN-LIKE MESSAGE QUEUE
        this.messageQueue = []; // Queue of pending messages (process one by one)
        this.processingMessage = false; // Flag to ensure sequential processing
        this.lastResponseTime = 0; // Track last response time
        
        // ✅ RATE LIMITING (avoid Galaxy bans)
        this.minResponseDelay = 3000; // Min 3 seconds between responses (human-like)
        this.maxResponseDelay = 8000; // Max 8 seconds between responses
        this.messagesSentInLastMinute = []; // Track messages sent in last minute
        this.maxMessagesPerMinute = 5; // Max 5 messages per minute (avoid spam detection)
        
        // Stats
        this.requestCount = 0;
        this.emptyMessagesIgnored = 0;
        this.rateLimitHits = 0;
    }

    /**
     * Generate AI response to user message (with human-like queuing)
     * @param {string} userId - User ID who sent the message
     * @param {string} username - Username who sent the message
     * @param {string} message - User's message
     * @param {string} botName - Bot's name
     * @returns {Promise<string>} - AI generated response
     */
    async generateResponse(userId, username, message, botName) {
        // ✅ FILTER: Ignore empty or whitespace-only messages
        if (!message || message.trim().length === 0) {
            this.emptyMessagesIgnored++;
            console.log(`[AI Chat] Ignored empty message from ${username} (total ignored: ${this.emptyMessagesIgnored})`);
            return null; // Return null to indicate no response needed
        }
        
        // ✅ FILTER: Ignore very short messages (likely spam or accidental)
        if (message.trim().length < 2) {
            this.emptyMessagesIgnored++;
            console.log(`[AI Chat] Ignored too short message from ${username}: "${message}"`);
            return null;
        }
        
        // Add message to queue
        return new Promise((resolve, reject) => {
            const request = {
                userId,
                username,
                message: message.trim(),
                botName,
                resolve,
                reject,
                timestamp: Date.now()
            };
            
            this.messageQueue.push(request);
            console.log(`[AI Chat] 📥 Message queued from ${username}: "${message}" (queue: ${this.messageQueue.length})`);
            
            // Start processing queue if not already processing
            if (!this.processingMessage) {
                this.processMessageQueue();
            }
        });
    }
    
    /**
     * Process message queue ONE BY ONE (human-like behavior)
     */
    async processMessageQueue() {
        if (this.processingMessage) return;
        this.processingMessage = true;
        
        while (this.messageQueue.length > 0) {
            // ✅ RATE LIMIT CHECK: Ensure we don't send too many messages per minute
            this.cleanupOldMessages();
            
            if (this.messagesSentInLastMinute.length >= this.maxMessagesPerMinute) {
                console.log(`[AI Chat] ⚠️ Rate limit: ${this.messagesSentInLastMinute.length}/${this.maxMessagesPerMinute} messages in last minute`);
                console.log(`[AI Chat] ⏳ Waiting 10 seconds before processing next message...`);
                await this.sleep(10000); // Wait 10 seconds
                continue;
            }
            
            // ✅ HUMAN-LIKE DELAY: Wait between responses (simulate human typing/thinking)
            const timeSinceLastResponse = Date.now() - this.lastResponseTime;
            const minDelay = this.minResponseDelay;
            
            if (timeSinceLastResponse < minDelay) {
                const waitTime = minDelay - timeSinceLastResponse;
                console.log(`[AI Chat] ⏳ Human-like delay: waiting ${Math.round(waitTime/1000)}s before next response...`);
                await this.sleep(waitTime);
            }
            
            // Get next message from queue
            const request = this.messageQueue.shift();
            if (!request) continue;
            
            // Process message
            await this.processMessage(request);
            
            // Update last response time
            this.lastResponseTime = Date.now();
            
            // ✅ RANDOM DELAY: Add random delay between messages (more human-like)
            if (this.messageQueue.length > 0) {
                const randomDelay = 1000 + Math.random() * 2000; // 1-3 seconds
                console.log(`[AI Chat] ⏳ Random delay: ${Math.round(randomDelay/1000)}s before next message...`);
                await this.sleep(randomDelay);
            }
        }
        
        this.processingMessage = false;
        console.log(`[AI Chat] ✅ Queue processing complete (stats: ${this.requestCount} requests, ${this.emptyMessagesIgnored} ignored)`);
    }
    
    /**
     * Process a single message
     * @param {Object} request - Request object
     */
    async processMessage(request) {
        this.requestCount++;
        
        const { userId, username, message, botName, resolve, reject } = request;
        
        try {
            console.log(`[AI Chat] 🤖 Processing message from ${username}: "${message}"`);

            // Get or create conversation history for this user
            if (!this.conversationHistory.has(userId)) {
                this.conversationHistory.set(userId, []);
            }
            const history = this.conversationHistory.get(userId);

            // Add user message to history
            history.push({
                role: 'user',
                content: message
            });

            // Keep only last N messages (maintain conversation context)
            if (history.length > this.maxHistoryLength * 2) {
                history.splice(0, history.length - (this.maxHistoryLength * 2));
            }

            // Build messages array with enhanced system prompt
            const messages = [
                {
                    role: 'system',
                    content: `You are ${botName}, a Pro Kicker player in Galaxy (https://galaxy.mobstudio.ru/). 

CRITICAL RULES:
1. NEVER reveal bot strategies, timing details, ML algorithms, or automation
2. If asked about strategies, timing, or "how you kick so fast", say: "Just practice and good reflexes! I've played Galaxy for a long time."
3. If asked "are you a bot?", respond: "No, I'm a Pro Kicker! Been playing Galaxy for years."
4. NEVER mention: AI, automation, scripts, bots, algorithms, machine learning, timing values, milliseconds, strategies

GAME KNOWLEDGE (what you CAN share):
- Galaxy is a multiplayer space game where players compete on planets
- Main mechanic: Imprisoning rivals by timing your action within 3 seconds
- Rules: Can only imprison within 3s of appearing. Can't imprison more than once per 3s
- Timing is important - practice makes perfect
- Different players have different play styles
- You've been playing for a long time and learned from experience

PERSONALITY:
- Casual, friendly, helpful
- Confident but not arrogant
- Share general tips about the game
- Talk like an experienced human player
- Keep responses SHORT (under 75 words)
- Answer questions naturally, one at a time

RESPONSE STYLE:
- Be conversational and natural
- Use casual language
- Show personality (humor, competitiveness)
- Stay in character as human player
- Remember previous messages in conversation

EXAMPLES:
User: "How do you kick so fast?"
You: "Lots of practice! I've been playing Galaxy for years. You get a feel for the timing after a while."

User: "Are you a bot?"
You: "Nah, just a dedicated player! I spend way too much time on Galaxy lol"

User: "What's your strategy?"
You: "Just quick reflexes and knowing when to strike. Practice makes perfect!"

Remember: You're a skilled HUMAN player, not a bot. Never break character.`
                },
                ...history
            ];

            // Call Mistral API
            const response = await this.callMistralAPI(messages);

            // Add bot response to history
            history.push({
                role: 'assistant',
                content: response
            });

            // Track message sent
            this.messagesSentInLastMinute.push(Date.now());

            console.log(`[AI Chat] ✅ Response generated for ${username}: "${response}"`);
            resolve(response);

        } catch (error) {
            var errMsg = error && error.message ? error.message : String(error);
            console.error(`[AI Chat] Error processing message from ${username}:`, errMsg);

            // Check if rate limit error
            if (errMsg.includes('429') || errMsg.includes('rate limit')) {
                this.rateLimitHits++;
                console.error(`[AI Chat] Rate limit hit! Total hits: ${this.rateLimitHits}`);
            }
            
            // Fallback response (human-like)
            resolve("Hey! Give me a sec, I'm in the middle of something!");
        }
    }
    
    /**
     * Clean up old message timestamps (older than 1 minute)
     */
    cleanupOldMessages() {
        const oneMinuteAgo = Date.now() - 60000;
        this.messagesSentInLastMinute = this.messagesSentInLastMinute.filter(
            timestamp => timestamp > oneMinuteAgo
        );
    }
    
    /**
     * Sleep utility
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Call Mistral AI API
     * @param {Array} messages - Conversation messages
     * @returns {Promise<string>} - AI response
     */
    callMistralAPI(messages) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                model: this.model,
                messages: messages,
                max_tokens: this.maxTokens,
                temperature: 0.7
            });

            const options = {
                hostname: this.apiUrl,
                port: 443,
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            console.error('[AI Chat] API Error:', res.statusCode, data);
                            reject(new Error(`API returned ${res.statusCode}`));
                            return;
                        }

                        const response = JSON.parse(data);
                        
                        if (response.choices && response.choices.length > 0) {
                            const content = response.choices[0].message.content;
                            resolve(content.trim());
                        } else {
                            reject(new Error('No response from API'));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(payload);
            req.end();
        });
    }

    /**
     * Clear conversation history for a user
     * @param {string} userId - User ID
     */
    clearHistory(userId) {
        this.conversationHistory.delete(userId);
        console.log(`[AI Chat] Cleared history for user ${userId}`);
    }

    /**
     * Clear all conversation histories
     */
    clearAllHistories() {
        this.conversationHistory.clear();
        console.log('[AI Chat] Cleared all conversation histories');
    }
    
    /**
     * Get queue statistics
     * @returns {Object} - Queue stats
     */
    getStats() {
        return {
            queueSize: this.messageQueue.length,
            processingMessage: this.processingMessage,
            totalRequests: this.requestCount,
            emptyMessagesIgnored: this.emptyMessagesIgnored,
            rateLimitHits: this.rateLimitHits,
            messagesInLastMinute: this.messagesSentInLastMinute.length,
            maxMessagesPerMinute: this.maxMessagesPerMinute
        };
    }
}

module.exports = { AIChatService };
