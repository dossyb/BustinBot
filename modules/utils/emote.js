let client;

function initialise(clientInstance) {
    client = clientInstance;
}

function getEmoteOrName(emoteName) {
    const emote = client.emojis.cache.find(emoji => emoji.name === emoteName);
    return emote ? emote.toString() : emoteName;
}

// Dynamically declare Bustin emote
function getBustinEmote() {
    return getEmoteOrName('Bustin');
}

// Dynamically declare peepoSad emote
function getSadEmote() {
    return getEmoteOrName('peepoSad');
}

// Dynamically declare Bedge emote
function getBedgeEmote() {
    return getEmoteOrName('Bedge');
}

module.exports = {
    initialise,
    getBustinEmote,
    getSadEmote,
    getBedgeEmote
};