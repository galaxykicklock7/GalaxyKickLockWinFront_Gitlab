const crypto = require("crypto-js");

// Helper function to parse haaapsi
const parseHaaapsi = (e) => {
    if (!e) return "";
    var temp = crypto.MD5(e).toString(crypto.enc.Hex);
    return (temp = (temp = temp.split("").reverse().join("0")).substr(5, 10));
};

// Helper function to check if user is in blacklist
const isUserBlacklisted = (username, blacklistConfig) => {
    if (!blacklistConfig) return false;
    const blacklist = blacklistConfig.split('\n').map(n => n.trim()).filter(n => n);
    return blacklist.some(blocked => username.includes(blocked));
};

// Helper function to check if gang is blacklisted
const isGangBlacklisted = (username, gangBlacklistConfig) => {
    if (!gangBlacklistConfig) return false;
    const gangblacklist = gangBlacklistConfig.split('\n').map(n => n.trim()).filter(n => n);
    return gangblacklist.some(blocked => username.includes(blocked));
};

// Helper function to count occurrences in array
const countOccurrences = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0);

module.exports = {
    parseHaaapsi,
    isUserBlacklisted,
    isGangBlacklisted,
    countOccurrences
};
