# v1.0.0
Initial release

# v1.1.0
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
- Fixed channel names for movie night reminder messages.
- Updated !endmovie message to thank attendees for watching.
- Bustin

# v1.1.2
- Refactored code structure ahead of future modules.
- Added !bustinhelp command to provide user with help commands for each module.
- Updated !moviehelp command to only show commands available to the user based on their roles.
- Added !bustincount command to track how many times the !bustin command is used.
- Added !moviecount/!countmovie command to show what movies the user has added and how many they have left.

# v1.2.0
- Refactor code into modules for each separate overall function (e.g. movie, task)
- Introduced task module for scheduling and handling weekly tasks

## Task Module
- Added a weekly poll and subsequent task that runs on a schedule
- Added handling of votes on polls
- Added submission handling and monthly winner logic
- Added randomised selection of tasks from a list
- Added persistence for polls, votes and submissions
- Added admin commands for testing and manual execution

## Movie Module
- Fixed bug that caused bot to crash when using !endmovie
- Updated several bot message sends to message replies

# v1.2.1
## Task Module
- Add random keyword functionality for task submissions
- Fixed bug where BustinBot's task module would claim user had no permissions when using a movie command
- Fixed bug where task submission timeout error posts when the task submission is deleted
- Split the !completions command into separate commands for completions for the month and all-time

## Movie Module
- Fixed user movie count logic to return quota when movie is removed by admin
- Fixed crash event when a poll is closed and the poll message has been deleted

# v1.2.2
## Task Module
- Fixed bug where poll would not expire properly and cause two polls to schedule
- Updated task list
- Added new testing features
- Improved poll recovery functionality in the event of a crash

# v1.2.3
## Task Module
- Added Leagues task support.
- Fixed bug with poll schedule not working
- Reworked vote handling to maintain accuracy in the event of a restart

## Movie Module
- Updated movie list command to delete message after react listener times out
- Extended movie list react listener from one hour to 24 hours

# v1.2.4
- Major overhaul of console logging functionality
- Added !goodbot and !badbot commands
- Updated emote use to dynamically fetch from server's emote ID

## Task Module
- Allowed Task Admins use of some commands
- Merged vote data file into poll data file
- Added reroll functionality which prevents approving new submissions until winner is confirmed
- Implemented automated deletion of old polls and keeping record of these in a log file

## Movie Module
- Updated reminders to include info about active movie polls

# v1.2.5
- Added current count to reply of !goodbot/!badbot commands
- Added ability to announce own new version and changelog when update has occurred
- Added !bustinversion command to show current version

## Movie Module
- Fixed bug where older movies in the list would not recognise the user who added them
- Fixed timezone bug that would schedule movie nights for wrong time
- Added auto-close functionality to movie poll after 24 hours or 30 minutes prior to movie night start time
- Adjusted wording of reminders to dynamically show reminder times
- Updated !pollmovie command to allow specific movies to be chosen to poll
- Added reply to users using movie commands without Movie Night role
- Updated poll tiebreak functionality to allow admins to choose or let bot decide
- Prevented movie poll from being created within 30 minutes of movie start time

# v1.2.6

## Movie Module
- Fixed bug where bot would respond to task commands with movie role permissions error
- Fixed timezone bug by allowing admins to explicitly set bot's timezone.