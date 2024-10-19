# v1.0.0
Initial release

# v1.1.0
Changelog:
- Added a 15 second cooldown per non-privileged user to the !addmovie and !removemovie commands.
- Updated formatting of all commands to show movie names in bold and usernames in italics.
- Reformatted the movie list into an interactive Discord embed that shows 5 movies per page that the user can control via reactions for up to 60 minutes.
- Updated !removemovie so non-privileged users can only remove movies they have added.
- Fixed bug where a scheduled movie night that has had a change in selected movie will send reminders showing the original selected movie's name.
- Updated the !currentmovie response to show if a movie night has been scheduled.
- Updated the Discord timestamp to show the day as well as the date.
- Implemented a persistent limit of 3 movies in the list per non-admin user.
- Movie night reminders will now send inside the movie-night channel if it exists, or general channel by default
- Added !editmovie command, allowing users to update the name of movies they have added.
- Updated movie poll to randomly select one movie from each user.
- Added !pollclose command to select the movie with the most votes and close the active poll.
- Bustin

# v1.1.1
- Fixed channel names for movie night reminder messages
- Updated !endmovie message to thank attendees for watching.
- Bustin

#v1.1.2
- Refactored code structure ahead of future modules
- Added !bustinhelp command to provide user with help commands for each module
- Updated !moviehelp command to only show commands available to the user based on their roles