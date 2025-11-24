=== Feeds - Self-Hosted RSS Reader ===
Contributors: bacoords
Tags: rss, feed reader, aggregator, news reader, feeds
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A self-hosted RSS reader living natively inside the WordPress Admin Dashboard.

== Description ==

Feeds is a powerful, self-hosted RSS reader that brings all your favorite content directly into your WordPress admin dashboard. Built with modern React and WordPress components, it provides a beautiful, native reading experience without relying on third-party services.

= Key Features =

* **Feed Management** - Add, delete, and manage RSS feed subscriptions with ease
* **Smart Reading Interface** - Modern React-based UI powered by @wordpress/dataviews
* **Auto-Sync** - Automatic hourly feed fetching keeps your content fresh
* **Read/Unread Tracking** - Mark articles as read or unread with taxonomy-based filtering
* **Favorites** - Star important articles to exclude them from auto-pruning
* **Auto-Pruning** - Automatically delete old items (default: 30 days) while preserving favorites
* **Categories** - Organize feeds with custom categories
* **Full-Text Reading** - Read articles directly in WordPress with a beautiful drawer interface
* **Thumbnail Extraction** - Automatically extracts and displays article images
* **WP-CLI Support** - Manage feeds from the command line

= WP-CLI Commands =

* `wp feeds refresh-all` - Delete all feed items and refetch from all feeds
* `wp feeds delete-all-items` - Delete all feed items only
* `wp feeds fetch-all` - Fetch all feeds without deleting
* `wp feeds create-labels` - Create default label terms

= Developer Features =

**REST API Endpoints:**
* `POST /wp-json/feeds/v1/refresh/{id}` - Manually refresh a specific feed

**Filters & Hooks:**
* `feeds_retention_days` - Filter to change the auto-pruning retention period (default: 30 days)

Example:
`
add_filter( 'feeds_retention_days', function() {
    return 90; // Keep items for 90 days
} );
`

**Background Jobs:**
The plugin uses WordPress Cron to schedule:
* **Hourly**: Fetch all feeds
* **Daily**: Prune old items

== Installation ==

1. Upload the `feeds` folder to the `/wp-content/plugins/` directory
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Navigate to 'Feeds' in the WordPress admin menu
4. Click 'Manage Feeds' to add your first RSS feed subscription
5. Start reading!

== Frequently Asked Questions ==

= How often are feeds updated? =

By default, feeds are fetched automatically every hour. You can also manually refresh individual feeds using the REST API or WP-CLI commands.

= How long are feed items kept? =

Feed items are automatically deleted after 30 days by default. You can customize this using the `feeds_retention_days` filter. Favorited items are never deleted.

= Can I use this without the WordPress admin? =

No, Feeds is designed to work within the WordPress admin dashboard. It's a self-hosted solution for content aggregation and reading.

= Does this work with any RSS feed? =

Yes! Feeds uses WordPress's built-in SimplePie library and supports standard RSS and Atom feeds.

= How do I mark articles as read? =

Articles are automatically marked as read when you close the article drawer after viewing them.

== Screenshots ==

1. Main feed reader interface with DataViews table
2. Article drawer showing full content
3. Feed management screen
4. Category and label filtering

== Changelog ==

= 1.0.0 =
* Initial release
* Feed subscription management
* Read/Unread tracking with taxonomy
* Favorites system
* Auto-sync and auto-pruning
* WP-CLI commands
* REST API endpoints
* Modern React-based interface with @wordpress/dataviews
* Thumbnail extraction from multiple sources

== Upgrade Notice ==

= 1.0.0 =
Initial release of Feeds - Self-Hosted RSS Reader

== Developer Notes ==

This plugin is built with modern WordPress development practices:
* React-based UI using @wordpress/element
* @wordpress/dataviews for the table interface
* @wordpress/core-data for data management
* Custom Post Types for feed sources and items
* Custom Taxonomies for labels and categories
* WP-CLI integration for command-line management

For more information, see the README.md file in the plugin directory.
