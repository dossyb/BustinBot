# BustinBot

**BustinBot** is a general-purpose Discord bot designed to enhance community engagement through a modular approach. The bot features submodules for specific functionalities, making it easy to expand and customize for various needs. Currently, the bot includes a **Movie Night Manager** to help organize and manage movie nights for your Discord server.

## Features

- **Modular Design**: BustinBot is designed with submodules, allowing easy addition of new features without cluttering the main bot logic.
- **Movie Night Manager**: Schedule and manage movie nights with a comprehensive set of commands, including adding, removing, and polling movies.
- **Custom Role Requirements**: Commands are restricted to users with specific roles, ensuring only authorized members can access certain features.

## Submodules

### 1. **Movie Night Manager**
The Movie Night Manager allows members to suggest, vote on, and schedule movies for the community to watch together.

#### Key Features:
- **Add Movies**: Members can suggest movies for the list.
- **Remove Movies**: Members can remove movies they've added.
- **List Movies**: View the current list of movies.
- **Schedule Movie Nights**: Admins can schedule movie nights for specific dates and times.
- **Poll Movies**: Run polls for members to vote on movies.
- **Reminders**: Automatic reminders are sent before movie night starts.

## Installation

### 1. Clone the Repository
```bash
git clone https://github.com/your-repo/bustinbot.git
cd bustinbot }
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
Create a .env file in the root directory and include the following:
```env
DISCORD_TOKEN_DEV=your_dev_token
DISCORD_TOKEN_LIVE=your_live_token
BOT_MODE=dev_or_live
```

### 4. Run the bot
```bash
node index.js
```
## Usage

### General Commands:
- `!bustin`: A simple ping command to test if the bot is online.
- `!moviehelp`: Lists all available movie commands.

### Movie Night Manager Commands:

#### Standard User Commands:
- `!addmovie <name>`: Add a movie to the list.
- `!removemovie <name|number>`: Remove a movie you’ve added by name or number.
- `!editmovie <number> <new name>`: Edit a movie you’ve added.
- `!movielist`: View the current list of movies.
- `!movie <name|number>`: View details about a specific movie.
- `!currentmovie`: See the currently selected movie and scheduled movie night time.
- `!moviecount`: Check how many movies you have left to add and see the ones you’ve suggested.

#### Admin Commands:
- `!movienight <YYYY-MM-DD HH:mm>`: Schedule a movie night.
- `!selectmovie <name|number>`: Select a movie for movie night.
- `!pollmovie <amount>`: Run a poll to vote on a set number of movies.
- `!pollclose`: Close the active poll and select the winning movie.
- `!cancelmovie`: Cancel the scheduled movie night.
- `!endmovie`: End the movie night and remove the selected movie.
- `!clearlist`: Clear the entire movie list.

## Customization

BustinBot’s modular design allows for easy extension. To add a new feature:
1. Create a new submodule file (e.g., `osrstask.js`).
2. Add specific functionality to your submodule.
3. Update `index.js` to load and handle the new module.

Each submodule should manage its own state and commands to keep the bot maintainable and flexible.

## Contributing

We welcome contributions! If you’d like to add features or improve existing functionality:
1. Fork the repository.
2. Create a feature branch.
3. Make your changes and commit them.
4. Submit a pull request with a detailed description of your changes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
