## [2.0.1](https://github.com/dossyb/BustinBot/compare/v2.0.0...v2.0.1) (2025-11-09)

### Bug Fixes

* **core:** adjust Luxon type handling and extension usage ([ae1bfc4](https://github.com/dossyb/BustinBot/commit/ae1bfc41f5bb878a2cbcbb76afcba129136eb8ec))
* **core:** align build to ES2022 modules and silence Luxon types ([8d450e0](https://github.com/dossyb/BustinBot/commit/8d450e04cc58df69406cb3c4620ad0a2424f59cb))
* **core:** extract asset and data folders from src ([d6bbed4](https://github.com/dossyb/BustinBot/commit/d6bbed4f15f131c846799e975e8f752861b20fc6))
* **core:** fix all build issues to compile with Node16 ([604f005](https://github.com/dossyb/BustinBot/commit/604f005708b8f4a8a11498a6420e01d968067ae8))
* **core:** fix CommandService file filter to ignore dist ([75b07ae](https://github.com/dossyb/BustinBot/commit/75b07ae36e3ab41f63ca6d2622262d0fea613829))
* **core:** fix Discord token handling logic ([9e14d39](https://github.com/dossyb/BustinBot/commit/9e14d39078f653027ac884276219ccc5f206a3f1))
* **core:** fix duplicate declare PathUtils error ([b569f82](https://github.com/dossyb/BustinBot/commit/b569f82dbd7e67392d9f27c29746e93288c623f4))
* **core:** fix Firestore credential handling ([8d25f82](https://github.com/dossyb/BustinBot/commit/8d25f82c152b1776691747bf822d91f5d558ff48))
* **core:** fix import.meta.url usage ([c7ee82f](https://github.com/dossyb/BustinBot/commit/c7ee82f2308a9b62e34eae2bb20f9c6a9fa559bd))
* **core:** hotfix DM-guild relationship handling ([b4ae6ca](https://github.com/dossyb/BustinBot/commit/b4ae6ca99f32f21af6fc0feae68ed7fb46c7b7f6))
* **core:** implement hotfixes for production build regression ([95708b9](https://github.com/dossyb/BustinBot/commit/95708b934d0dbc1a0098dec78c1070cb07120976))
* **task:** additional hotfix for task event ID resolution ([7ff43b4](https://github.com/dossyb/BustinBot/commit/7ff43b421ae7d3d4466233227ead16fb4aa62d92))
* **task:** additional production task ID hotfix ([961c8dd](https://github.com/dossyb/BustinBot/commit/961c8dd0493e698697a040e0c688b8dd29531c08))
* **task:** fix prize draw submission filtering logic ([dc13f3a](https://github.com/dossyb/BustinBot/commit/dc13f3ab6dfc675e824b553a3b2a0db988acd594))
* **task:** fix task submission bugs ([6cb2695](https://github.com/dossyb/BustinBot/commit/6cb269516cdbb9e764412197131852ee6f66c6ae))
* **task:** fix taskEvent bug not storing completedUserIds ([23bd38c](https://github.com/dossyb/BustinBot/commit/23bd38c7bdc39c6d320ee983974c62f691cd8f95))
* **task:** hotfix bot crash on vote for 24 hr poll ([2654acc](https://github.com/dossyb/BustinBot/commit/2654acc3e009c17a74bc11f02e5356c1643e41a2))
* **task:** hotfix task event ID resolution ([ad6bd95](https://github.com/dossyb/BustinBot/commit/ad6bd952cc09dad49896e11921159118ebee1a10))
* **task:** hotfix task submission DM reply failure ([a79dd5d](https://github.com/dossyb/BustinBot/commit/a79dd5d9afaa3144de7f9c0b65d2c61673ff550a))

## [2.0.0](https://github.com/dossyb/BustinBot/compare/v1.2.6...v2.0.0) (2025-11-01)

### Features

* **core:** Add set timezone button for guild ([c2fed57](https://github.com/dossyb/BustinBot/commit/c2fed577a5eb4b726513c473b7e97f8007c48746))
* **core:** add support and help commands ([c317cda](https://github.com/dossyb/BustinBot/commit/c317cda470b388931114517bd9b805153ff8d2ca))
* **core:** implement bot channel setup command ([69d60ee](https://github.com/dossyb/BustinBot/commit/69d60eed1fe56429d39665940dd1d53157abf4ec))
* **core:** implement data access layer ([c11e4ad](https://github.com/dossyb/BustinBot/commit/c11e4ad095e9dcaf80b706e41ab2573b57c3d47a))
* **core:** implement dynamic custom emote handling ([58ea0fe](https://github.com/dossyb/BustinBot/commit/58ea0fe9c18b0201394b8335f4a3e88a50cca740))
* **core:** implement schedule reports in console ([d895b04](https://github.com/dossyb/BustinBot/commit/d895b04864b0cb08fc3b74f8147112a0cdc38cef))
* **core:** implement setup validation on commands ([5246f82](https://github.com/dossyb/BustinBot/commit/5246f82725b8a37d01980ae373c679bf4f6efb3a))
* **core:** implement user stats tracking ([a4455e9](https://github.com/dossyb/BustinBot/commit/a4455e9230ea80483adcc3bd440dce1f102f192c))
* **core:** implement version announcement command ([457c5d7](https://github.com/dossyb/BustinBot/commit/457c5d76880b78cb63ba02bba4c2ead7859b353a))
* **core:** rework botstatus command into botinfo ([052544e](https://github.com/dossyb/BustinBot/commit/052544ef7a79e5ed8be3b473250c75a916a74bf2))
* **movie:** add DM notifications for movie submitters ([f72b154](https://github.com/dossyb/BustinBot/commit/f72b154675d88382263e2d8a0b6dd37998d71f99))
* **movie:** implement admin command for testing TMDb API calls ([eff193c](https://github.com/dossyb/BustinBot/commit/eff193c012e3d676b39b1b2e6d182e78f8a5cb84))
* **movie:** implement flow between movie picking and movie night ([5ba873a](https://github.com/dossyb/BustinBot/commit/5ba873a43e2eb101fcf6b7d3d3704a5e26a93104))
* **movie:** implement movie attendance tracking ([cc9209f](https://github.com/dossyb/BustinBot/commit/cc9209fa568a13228b1c9882ffa6e5969603826c))
* **movie:** implement movie channels and roles setup command ([2b33abf](https://github.com/dossyb/BustinBot/commit/2b33abf69d05982efa96db9340ec3503540716e6))
* **movie:** implement movie lifecycle handling ([b3bd877](https://github.com/dossyb/BustinBot/commit/b3bd8773f21d63b496995729541ef618081b4285))
* **movie:** implement movie list functionality ([4216468](https://github.com/dossyb/BustinBot/commit/42164682e2d3e31c3a7017aa726c2b2e431b5a45))
* **movie:** implement movie night scheduling ([1886170](https://github.com/dossyb/BustinBot/commit/1886170a443d7404afdc0f20e3354086b489eff9))
* **movie:** implement pickmovie command for movie night ([35d2ddf](https://github.com/dossyb/BustinBot/commit/35d2ddf86b2b421d4aaf5fe859d3978fb73d0cee))
* **movie:** implement read and delete commands for added movies ([6bb56bb](https://github.com/dossyb/BustinBot/commit/6bb56bbae159b0b47a15752b2ce5549c90780eca))
* **movie:** implement scheduling and reminder logic ([701f778](https://github.com/dossyb/BustinBot/commit/701f77838863c6fef2542fe513b77e03c500c270))
* **movie:** implement user commands for viewing movie data ([3e3a9c0](https://github.com/dossyb/BustinBot/commit/3e3a9c0c2bd88f4097c63a87b17f0c806c4b10ee))
* **task:** add task prize draw DM functionality ([c8f4d89](https://github.com/dossyb/BustinBot/commit/c8f4d89b1f04a172f8fcc3a4a943fe2bc703510a))
* **task:** add tiered submission verification and live task embeds ([d76d25d](https://github.com/dossyb/BustinBot/commit/d76d25df29f7d9cde419093dd3fcd0dd094506a1))
* **task:** add toggle for Leagues tasks ([0b78655](https://github.com/dossyb/BustinBot/commit/0b7865524913f25a462a08a317f0b0bd94c7fe0e))
* **task:** complete task system rework ([033b257](https://github.com/dossyb/BustinBot/commit/033b2570ffcbfc15ee1e76258e4e379df9e86871))
* **task:** implement admin command for task updates ([aa6c680](https://github.com/dossyb/BustinBot/commit/aa6c6808f75b7c4cddfc7fbcd44860bc7102d947))
* **task:** implement admin-level manual task commands ([6e1e4cb](https://github.com/dossyb/BustinBot/commit/6e1e4cbbdcfb982070557d89048e11e518eaa4f7))
* **task:** implement command to add keywords ([1d1f854](https://github.com/dossyb/BustinBot/commit/1d1f854bad2820dcc18426bc0b887843d93e8030))
* **task:** implement new task submission/verification flow ([c6b36b9](https://github.com/dossyb/BustinBot/commit/c6b36b911fed11e4898c074155c3001ecc549bfd))
* **task:** implement task channels and roles setup command ([ff905e0](https://github.com/dossyb/BustinBot/commit/ff905e094914404eda901507760adde4e6d0c171))
* **task:** implement task feedback system ([fb249d3](https://github.com/dossyb/BustinBot/commit/fb249d373ac44da6f469bc2c27d9741eb2b53a7d))
* **task:** implement task import command ([f3851e0](https://github.com/dossyb/BustinBot/commit/f3851e0c1830c153e0f363b35e765a28498efc20))
* **task:** implement task keyword logic ([ab005ba](https://github.com/dossyb/BustinBot/commit/ab005ba5febffdb5287752f1d5ed0e66d6495189))
* **task:** implement task poll functionality ([3f29ad4](https://github.com/dossyb/BustinBot/commit/3f29ad43b21ce022c3226c4803cdc80d1bdb4435))
* **task:** implement task prize draw functionality ([f2ac420](https://github.com/dossyb/BustinBot/commit/f2ac42034d7d1d590bde7708a83b70241ad05939))
* **task:** implement toggleable task scheduler with test timings ([6499d35](https://github.com/dossyb/BustinBot/commit/6499d3522ea121c1a51ed3112f05c0616f16ec8b))
* **task:** persist scheduler toggle state in Firestore ([5009127](https://github.com/dossyb/BustinBot/commit/5009127efc6dde92f9137563717eba19ef9acb5a))
* **task:** update embeds to show completions by tier ([bd2e574](https://github.com/dossyb/BustinBot/commit/bd2e5749ac49955d43469c7bb7eba1ba57822923))

### Bug Fixes

* **core:** fix numerous setup issues ([2dddb2e](https://github.com/dossyb/BustinBot/commit/2dddb2e8b885b2b8e224dd4b6ee061e59b287533))
* **core:** fix slash command registration logic ([eb2e5a0](https://github.com/dossyb/BustinBot/commit/eb2e5a03a5996bf5958953c9a958a2bae25f3cf9))
* **core:** implement minor bug fixes ([cbdae40](https://github.com/dossyb/BustinBot/commit/cbdae400b251cb4a606bb2ed0992387a47c866d7))
* **movie:** fix numerous movie module bugs ([26489fb](https://github.com/dossyb/BustinBot/commit/26489fb00c66f2e58c3c927cc399b882453c0796))
* **movie:** fix regression in movie module from Firestore integration ([9d8ca17](https://github.com/dossyb/BustinBot/commit/9d8ca1725bf2b355985b87a99d3a8d0bf783b82f))
* **movie:** fix several minor movie module bugs ([2e1c0a7](https://github.com/dossyb/BustinBot/commit/2e1c0a7cf609121261a10d597657d14562013d12))
* **task:** fix regression in task module from Firestore integration ([39aad3e](https://github.com/dossyb/BustinBot/commit/39aad3edb044e9d90039df9fbf51ea0275c3d584))
* **task:** fix several minor task module bugs ([3323588](https://github.com/dossyb/BustinBot/commit/3323588f9e1d507ba1c2704892b33084c1d71f8c))
* **task:** improve task submission flow ([7ad46b2](https://github.com/dossyb/BustinBot/commit/7ad46b23741b586c0e91b9bfadc31e3483e31664))

---

## Legacy (Pre-2.0)
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

# v1.2.5a

## Movie Module
- Fixed bug where bot would respond to task commands with movie role permissions error
- Fixed timezone bug by allowing admins to explicitly set bot's timezone.

# v1.2.6

## Movie Module
- Fixed bug where !endmovie would occasionally not update the suggester's movie count
- Fixed bug where the !pollmovie command would return an incorrect error message when no parameters were given
- Introduced the "Movie Admin" role allowing non-BustinBot Admin users to use admin-level movie commands
- Implemented !postponemovie command to allow a scheduled movie night to be postponed by a given number of minutes
- Updated !rollmovie to show who added the rolled movie to the list
- Updated !moviecount to accept an optional parameter for a specific username
- Added !setmoviecount command to manually update a user's movie count
- Updated movie night wording to specify that reminders will only be sent at the listed times if that time has not already passed.

## Task Module
- Added submission validation to prevent duplicate submissions being approved for the same task
- Refined winner roll to only include submissions from closed tasks and ignore the active task
- Added command allowing BustinBot admins to pause weekly task scheduling.