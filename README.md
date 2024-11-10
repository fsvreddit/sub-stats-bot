A Devvit app to store subreddit statistics for moderators and users.

This app was heavily inspired by AssistantBOT, but restores metrics that AssistantBOT became unable to report on due to Pushshift restrictions.

Statistics are updated on wiki pages each day at 01:00 UTC. All dates are in UTC.

### Monthly Subreddit Statistics

This app captures the number of posts and comments made per day, the top posters and commenters, and the top posts made in the subreddit. This information is dis on wiki pages on your subreddit, broken down by month. Comments and posts that were filtered to the modqueue and not approved, removed by a mod, Reddit or Automod or deleted by the user are not included in the statistics.

The per-month statistics are stored in the wiki page sub-stats-bot/{year}. [Sample output](https://www.reddit.com/r/fsvapps/wiki/sub-stats-bot/sample/).

### Subscriber Statistics

Subscriber statistics are stored in a separate wiki page at sub-stats-bot, which also provides an index of monthly statistics.

Subscriber milestones show when the subreddit passes certain subscriber increase milestones after the app is installed. Milestones track when the most significant digit rolls over (e.g. 999->1000, 9,999->10,000) and once a subreddit surpasses 1000 subscribers, it also tracks each half way point (e.g. 1,499->1,500, 14,999->15,000). It also predicts when the next milestone will be reached based on recent subscriber growth.

A table of subscriber numbers is also maintained, initially with daily increases. As the table grows larger, it will show weekly or monthly changes instead.

[Sample output](https://www.reddit.com/r/fsvapps/wiki/sub-stats-bot/samplesummary/).

## Source Code and Licence

Subreddit Statistics is open source, the code is available on GitHub [here](https://github.com/fsvreddit/sub-stats-bot).

## Change History

v1.1

* Post votes are now shown correctly on wiki pages for posts made right at the end of a month
* Number of posts/comments and distinct users are now shown on both year summary and per-month summaries
* Fix bug that prevents index wiki page from updating if subscriber counts are unchanged
* Fix bug that will prevent 2024 year wiki page from emptying in early January

v1.0.8

* /u/ tags are correctly added on "top posts of year" section
* Increase number of days that sub stats are reported for before going weekly/monthly
* Prevent "0 posts" from appearing in the "top days" lists when a user deletes the only post of the day

v1.0.5

* Calculate post/comment averages correctly on install month
* Add option to prepend usernames with /u/ on wiki page
* Add navigation back to summary page on each year's wiki page
* Fixes formatting on subscriber counts table after day 20
