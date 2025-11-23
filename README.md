# Feeds - WordPress RSS Reader Plugin

A self-hosted RSS reader living natively inside the WordPress Admin Dashboard. It aggregates content from external feeds into Custom Post Types and provides a modern React-based reading interface using @wordpress/dataviews.

## Features

- **Feed Management**: Add, delete, and manage RSS feed subscriptions
- **Smart Reading Interface**: Modern React-based UI with DataViews
- **Auto-Sync**: Hourly automatic feed fetching
- **Read/Unread Tracking**: Mark articles as read or unread
- **Favorites**: Star important articles to exclude them from auto-pruning
- **Auto-Pruning**: Automatically delete old items (default: 30 days) while preserving favorites
- **Categories**: Organize feeds with custom categories
- **Full-Text Reading**: Read articles directly in WordPress with a beautiful drawer interface

## Installation

1. **Upload the plugin** to your WordPress site's `/wp-content/plugins/` directory
2. **Navigate to the plugin directory** in your terminal:
   ```bash
   cd wp-content/plugins/feeds
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the React app**:
   ```bash
   npm run build
   ```
5. **Activate the plugin** in WordPress Admin under Plugins → Installed Plugins
6. **Access the reader** via the "Feeds" menu item in the WordPress admin sidebar

## Development

### Build Commands

- `npm run build` - Build for production
- `npm run start` - Start development mode with hot reload
- `npm run format` - Format code
- `npm run lint:js` - Lint JavaScript files

### Project Structure

```
feeds/
├── includes/               # PHP Backend
│   ├── CPT/               # Custom Post Types
│   │   ├── class-feed-source-cpt.php
│   │   └── class-feed-item-cpt.php
│   ├── class-rss-fetcher.php
│   ├── class-scheduler.php
│   └── class-asset-loader.php
├── src/                   # React Frontend
│   ├── components/
│   │   ├── AddFeedModal.js
│   │   └── ArticleDrawer.js
│   ├── views/
│   │   ├── FeedReader.js
│   │   └── FeedManager.js
│   ├── App.js
│   └── index.js
└── feeds.php             # Main plugin file
```

## Usage

### Adding a Feed

1. Go to **Feeds → Manage Feeds**
2. Click **Add New Feed**
3. Enter the RSS feed URL
4. Optionally provide a name
5. Click **Add Feed**

### Reading Articles

1. Go to **Feeds → Reader**
2. Browse articles in the main view
3. Click on an article to open it in the drawer
4. Use actions to mark as read/unread or favorite

### Managing Feeds

1. Go to **Feeds → Manage Feeds**
2. View all your subscribed feeds
3. Use **Refresh Now** to manually fetch updates
4. Use **Delete** to remove a feed

### Categories

Assign categories to your feeds to organize them. Categories will be inherited by all articles from that feed.

## API Endpoints

The plugin exposes the following REST API endpoints:

- `POST /wp-json/feeds/v1/refresh/{id}` - Manually refresh a feed

## Filters & Hooks

- `feeds_retention_days` - Filter to change the auto-pruning retention period (default: 30 days)

Example:
```php
add_filter( 'feeds_retention_days', function() {
    return 90; // Keep items for 90 days
} );
```

## Data Structure

### Custom Post Types

- **feeds_source**: Represents feed subscriptions
- **feeds_item**: Represents individual feed articles

### Taxonomies

- **feeds_category**: Hierarchical taxonomy for organizing feeds

### Meta Fields

#### Feed Source Meta
- `_feeds_source_url` - RSS/XML feed URL
- `_feeds_site_url` - Homepage URL
- `_feeds_last_fetched` - Last fetch timestamp
- `_feeds_fetch_status` - 'success' or 'error'
- `_feeds_error_message` - Error details if fetch failed

#### Feed Item Meta
- `_feeds_item_author` - Author name
- `_feeds_item_thumbnail_url` - Featured image URL
- `_feeds_item_permalink` - Original article URL
- `_feeds_item_source_id` - Parent feed source ID
- `_feeds_item_is_favorite` - Favorite status (boolean)
- `_feeds_item_is_read` - Read status (boolean)
- `_feeds_item_pub_date` - Publication timestamp

## Background Jobs

The plugin uses WordPress cron to schedule:

- **Hourly**: Fetch all feeds (`feeds_fetch_all`)
- **Daily**: Prune old items (`feeds_prune_items`)

## Requirements

- WordPress 5.9 or higher
- PHP 7.4 or higher
- Node.js 14+ and npm (for development)

## License

GPL v2 or later

## Support

For issues and feature requests, please contact the plugin developer.
