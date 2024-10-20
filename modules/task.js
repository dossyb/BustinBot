const fs = require('fs');
const pathTasks = './tasks.json';
const pathTaskUsers = './taskUsers.json';

async function handleTaskCommands(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'tasktest') {
        message.channel.send('Task test successful!');
    }
}

module.exports = { handleTaskCommands };